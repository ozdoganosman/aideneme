import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DAY_SECONDS } from '../../core/data/pack';
import { emptyCandles, type Candles } from '../../core/data/types';
import { inspect } from '../../core/data/health';
import { summarize } from '../../core/stats/summary';
import { FUNDAMENTAL_FIELDS, type FieldId, type Financials } from '../../core/fundamentals/types';

// Grafik canvas istiyor; raporun kendi metnini ölçmek için sahte kondu.
vi.mock('../chart/LineChart', () => ({
  LineChart: ({ series }: { series: { label: string }[] }) => (
    <div data-testid="report-chart">{series.map((s) => s.label).join('|')}</div>
  ),
}));

// useAnalysis sözleşmesi: yüklenene kadar null, sonra SABİT referans.
const symbolFn = vi.fn();
const FAKE_ANALYSIS = {
  client: { size: 2, symbol: (...a: unknown[]) => symbolFn(...a) },
  symbols: ['THYAO', 'GARAN'],
  bars: 250,
  status: 'ready' as const,
  error: null,
};
vi.mock('../useAnalysis', () => ({ useAnalysis: () => FAKE_ANALYSIS }));

const seriesFn = vi.fn();
vi.mock('../../data-client/client', () => ({
  dataClient: { series: (...a: unknown[]) => seriesFn(...a) },
}));

const snapshotFn = vi.fn();
const financialsFn = vi.fn();
vi.mock('../../data-client/fundamentals', () => ({
  fundamentalsClient: {
    snapshot: (...a: unknown[]) => snapshotFn(...a),
    financials: (...a: unknown[]) => financialsFn(...a),
  },
}));

import Report from './Report';

function sample(n: number): Candles {
  const c = emptyCandles(n);
  // 19723 = 1 Ocak 2024 Pazartesi; hafta sonları atlanarak işlem günü üretilir.
  let day = 19723;
  for (let i = 0; i < n; i++) {
    while ([0, 6].includes((day + 4) % 7)) day++;
    const price = 100 + i * 0.1;
    c.time[i] = day * DAY_SECONDS;
    c.open[i] = price;
    c.high[i] = price + 1;
    c.low[i] = price - 1;
    c.close[i] = price + 0.5;
    c.volume[i] = 1_000_000;
    day++;
  }
  return c;
}

function financials(): Financials {
  const fields = {} as Record<FieldId, (number | null)[]>;
  for (const field of FUNDAMENTAL_FIELDS) fields[field] = [null, null, null];
  fields.revenue = [700, 900, 1000];
  fields.netIncome = [100, 150, 200];
  fields.equity = [600, 700, 800];
  fields.operatingCashFlow = [120, 180, 240];
  fields.assets = [1600, 1800, 2000];
  return { symbol: 'THYAO', periods: ['2022/12', '2023/12', '2024/12'], fields, missing: [] };
}

const SNAPSHOT = {
  version: 1,
  generated: 1,
  note: 'Yayım tarihi bilgisi kaynakta yok.',
  symbols: {
    THYAO: {
      period: '2024/12',
      revenueTtm: 1000,
      grossProfitTtm: 400,
      operatingProfitTtm: 250,
      netIncomeTtm: 200,
      operatingCashFlowTtm: 240,
      equity: 800,
      assets: 2000,
      paidCapital: 100,
      currentAssets: 600,
      currentLiabilities: 300,
      longLiabilities: 500,
      inventory: 150,
      cash: 200,
    },
  },
};

const push = vi.fn();
const STATE = { v: 'rapor', m: 'bist', s: 'THYAO', tf: 'D', cmp: '' };
const candles = sample(300);

beforeEach(() => {
  vi.clearAllMocks();
  seriesFn.mockResolvedValue({ candles });
  symbolFn.mockImplementation(async (c: Candles, options: { realReturn: boolean }) => ({
    candles: c,
    metrics: summarize(c, { realReturn: options.realReturn }),
    health: inspect(c, { today: 19723 + 430 }),
    overlayValues: [],
    ms: 4,
  }));
  snapshotFn.mockResolvedValue(SNAPSHOT);
  financialsFn.mockResolvedValue(financials());
});

describe('Rapor', () => {
  it('veri aralığını ve bar sayısını başlıkta yazar', async () => {
    render(<Report state={STATE} push={push} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('THYAO · BIST'),
    );
    expect(screen.getByText(/2024-01-01 – .* · 300 bar/)).toBeInTheDocument();
  });

  it('her metriğin yanında formülünü ve penceresini gösterir', async () => {
    render(<Report state={STATE} push={push} />);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Özet metrikler' })).toBeInTheDocument(),
    );
    const summary = screen.getByRole('region', { name: 'Özet metrikler' });
    expect(summary).toHaveTextContent('Nasıl hesaplandı');
    expect(summary).toHaveTextContent('Pencere');
    // Gerçek summarize çıktısı: her satırda formül metni dolu olmalı.
    const rows = summary.querySelectorAll('tbody tr');
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      expect(cells[1].textContent?.trim().length).toBeGreaterThan(0); // formül
      expect(cells[2].textContent).toMatch(/bar/); // pencere
    }
  });

  it('temel göstergeleri fiyattan hesaplar', async () => {
    render(<Report state={STATE} push={push} />);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Temel göstergeler' })).toBeInTheDocument(),
    );
    const fundamentals = screen.getByRole('region', { name: 'Temel göstergeler' });
    // Son kapanış 130.4 → PD = 100 pay × 130.4 = 13 040; F/K = 13 040 / 200 = 65.2
    expect(fundamentals).toHaveTextContent('65,2');
    expect(fundamentals).toHaveTextContent('2024/12');
  });

  it('veri sağlığı bulgularını ve yatırım tavsiyesi uyarısını taşır', async () => {
    render(<Report state={STATE} push={push} />);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Veri sağlığı' })).toBeInTheDocument(),
    );
    expect(screen.getByText(/yatırım tavsiyesi değildir/)).toBeInTheDocument();
  });

  it('yazdırma ve bağlantı kopyalama eylemleri var', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('print', print);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<Report state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByTestId('report-chart')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Yazdır / PDF' }));
    expect(print).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Bağlantıyı kopyala' }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kopyalandı' })).toBeTruthy());
    vi.unstubAllGlobals();
  });

  it('veri okunamazsa hatayı gösterir, boş rapor basmaz', async () => {
    seriesFn.mockRejectedValue(new Error('paket indirilemedi'));
    render(<Report state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('Rapor hazırlanamadı')).toBeInTheDocument());
    expect(screen.getByText('paket indirilemedi')).toBeInTheDocument();
    expect(screen.queryByTestId('report-chart')).toBeNull();
  });
});

describe('Report — veri gelmezse', () => {
  it('sonsuza kadar iskelet göstermez, nedenini yazar', async () => {
    // Sessiz başarısızlık: ekran "yükleniyor" gibi durup hiç bitmiyordu.
    const prev = { status: FAKE_ANALYSIS.status, error: FAKE_ANALYSIS.error };
    Object.assign(FAKE_ANALYSIS, { status: 'error', error: 'Paket indirilemedi (HTTP 404)' });
    try {
      render(<Report state={STATE} push={push} />);
      expect(await screen.findByText('Rapor verisi yüklenemedi')).toBeInTheDocument();
      expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
    } finally {
      Object.assign(FAKE_ANALYSIS, prev);
    }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeIndicators, type IndicatorParams } from '../../core/indicators/calc';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DAY_SECONDS } from '../../core/data/pack';
import { emptyCandles, type Candles } from '../../core/data/types';
import { resample, type TF } from '../../core/data/resample';
import { summarize } from '../../core/stats/summary';
import { inspect } from '../../core/data/health';
import { emaArr } from '../../core/indicators/calc';

// Grafik ayrı chunk ve canvas gerektiriyor; ekran testinde yerine sahte kondu.
vi.mock('../chart/PriceChart', () => ({
  PriceChart: ({
    candles,
    overlays = [],
  }: {
    candles: Candles;
    overlays?: { key: string; visible: boolean; pane?: number; values: Float64Array }[];
  }) => (
    <div
      data-testid="chart"
      // Görünür VE verisi olan panel serileri: "açık ama boş" durumu
      // (EMA 200 kusurunun aynısı) teste yakalansın.
      data-panes={overlays
        .filter((o) => (o.pane ?? 0) > 0 && o.visible && o.values.length > 0)
        .map((o) => o.key)
        .join(',')}
    >
      {candles.length} bar
    </div>
  ),
}));

// Sembol analizi artık worker'da; sahte istemci aynı çekirdek fonksiyonları
// çağırır, böylece ekranın gösterdiği sayılar gerçek hesapla aynı kalır.
/** Son `symbol()` isteğinin seçenekleri — indikatör isteği sınanacak. */
const sonIstek: { indicators?: IndicatorParams } = {};

const FAKE_ANALYSIS = {
  client: {
    size: 2,
    symbol: async (
      candles: Candles,
      options: {
        tf: TF;
        overlays: { key: string; length: number }[];
        indicators?: IndicatorParams;
        todayDay: number;
        realReturn: boolean;
      },
    ) => {
      sonIstek.indicators = options.indicators;
      const resampled = resample(candles, options.tf);
      return {
        candles: resampled,
        metrics: summarize(resampled, { realReturn: options.realReturn }),
        health: inspect(candles, { today: options.todayDay }),
        overlayValues: options.overlays.map((o) => emaArr(resampled.close, o.length)),
        indicators: options.indicators
          ? computeIndicators(resampled, options.indicators)
          : undefined,
        ms: 3,
      };
    },
  },
  symbols: ['THYAO', 'GARAN'],
  bars: 0,
  status: 'ready' as const,
  error: null,
  progress: null,
};
vi.mock('../useAnalysis', () => ({ useAnalysis: () => FAKE_ANALYSIS }));

const manifest = vi.fn();
const series = vi.fn();
vi.mock('../../data-client/client', () => ({
  dataClient: {
    manifest: (...args: unknown[]) => manifest(...args),
    series: (...args: unknown[]) => series(...args),
  },
}));

import SymbolDesk from './SymbolDesk';

function sample(n: number): Candles {
  const c = emptyCandles(n);
  // 19723 = 1 Ocak 2024 Pazartesi; hafta sonlarını atlayarak işlem günü üret.
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

const push = vi.fn();
const STATE = { v: 'sembol', s: 'THYAO', tf: 'D', m: 'bist' };

beforeEach(() => {
  vi.clearAllMocks();
  manifest.mockResolvedValue({
    version: 1,
    market: 'bist',
    generated: 1_757_800_000,
    symbols: { THYAO: { f: 'THYAO.bin', n: 300, d0: 1, d1: 2, b: 10, h: 'x' }, GARAN: {} },
  });
  series.mockResolvedValue({ candles: sample(300), entry: {}, fromCache: false });
});

describe('SymbolDesk', () => {
  it('veri gelince grafik ve metrikler gösterilir', async () => {
    render(<SymbolDesk state={STATE} push={push} />);

    expect(await screen.findByTestId('chart')).toHaveTextContent('300 bar');
    expect(screen.getByText('Son kapanış')).toBeInTheDocument();
    expect(screen.getByText('Yıllık bileşik (CAGR)')).toBeInTheDocument();
  });

  // Veri sağlığı paneli KALDIRILDI (kullanıcı isteği): grafik bu ekranın asıl
  // işi ve panel dikey alanı yiyordu. Bulgular kayıp değil — paket üretimi
  // sırasında ölçülüyor ve `core/data/health.ts` testleri yerinde duruyor.
  // Eski arayüzün iki indikatörü. Panel KAPALIYKEN worker'a istek gitmemeli:
  // 3650 barlık iki indikatörü kimse bakmıyorken hesaplamak boşa iş.
  it('panel kapalıyken indikatör hesaplanmıyor', async () => {
    render(<SymbolDesk state={STATE} push={push} />);
    await screen.findByTestId('chart');
    expect(sonIstek.indicators).toBeUndefined();
    expect(screen.getByTestId('chart')).toHaveAttribute('data-panes', '');
  });

  it('panel açılınca indikatör isteniyor ve seriler VERİYLE geliyor', async () => {
    const user = userEvent.setup();
    render(<SymbolDesk state={STATE} push={push} />);
    await screen.findByTestId('chart');

    await user.click(screen.getByText('Williams %R'));

    // "Açık ama boş" olmamalı — EMA 200 kusuru tam olarak buydu.
    await waitFor(() =>
      expect(screen.getByTestId('chart')).toHaveAttribute('data-panes', 'wr:r,wr:a,wr:b'),
    );
    expect(sonIstek.indicators?.wr).toBe(260);
  });

  it('parametre değişince yeni değerle yeniden hesaplanıyor', async () => {
    const user = userEvent.setup();
    render(<SymbolDesk state={STATE} push={push} />);
    await screen.findByTestId('chart');
    await user.click(screen.getByText('MACD (NizamiCedid)'));
    await waitFor(() => expect(sonIstek.indicators?.macdFast).toBe(120));

    const alan = screen.getByLabelText('hızlı');
    await user.clear(alan);
    await user.type(alan, '90');

    await waitFor(() => expect(sonIstek.indicators?.macdFast).toBe(90));
  });

  it('veri sağlığı paneli artık ekranda değil', async () => {
    render(<SymbolDesk state={STATE} push={push} />);
    await screen.findByTestId('chart');
    expect(screen.queryByRole('region', { name: 'Veri sağlığı' })).toBeNull();
  });

  it('BIST için reel getiri kartı var, kripto için yok', async () => {
    const { unmount } = render(<SymbolDesk state={STATE} push={push} />);
    expect(await screen.findByText('Reel yıllık getiri')).toBeInTheDocument();
    unmount();

    render(<SymbolDesk state={{ ...STATE, m: 'crypto' }} push={push} />);
    await screen.findByTestId('chart');
    expect(screen.queryByText('Reel yıllık getiri')).toBeNull();
  });

  it('her metrik formülünü ve penceresini açabiliyor (provenance)', async () => {
    const user = userEvent.setup();
    render(<SymbolDesk state={STATE} push={push} />);
    await screen.findByTestId('chart');

    // Etiket metriğin ADINI taşımalı: dokuz özdeş "Bu sayı nereden geliyor?"
    // düğmesi ekran okuyucuda ayırt edilemezdi.
    const buttons = screen.getAllByRole('button', { name: /bu sayı nereden geliyor\?$/i });
    expect(buttons.length).toBeGreaterThan(4);
    expect(
      screen.getByRole('button', { name: 'Son kapanış: bu sayı nereden geliyor?' }),
    ).toBeInTheDocument();

    await user.click(buttons[0]);
    const panel = screen.getByRole('dialog', { name: 'Son kapanış' });
    expect(panel).toHaveTextContent('Formül');
    expect(panel).toHaveTextContent('Pencere');
  });

  it('periyot değiştirmek URL durumunu günceller', async () => {
    const user = userEvent.setup();
    render(<SymbolDesk state={STATE} push={push} />);
    await screen.findByTestId('chart');

    await user.click(screen.getByRole('tab', { name: 'Haftalık' }));
    expect(push).toHaveBeenCalledWith({ tf: 'W' });
  });

  it('veri yoksa ne yapılacağını söyleyen hata durumu gösterir', async () => {
    manifest.mockRejectedValue(new Error('bist: manifest okunamadı (HTTP 404)'));
    series.mockRejectedValue(new Error('bist: manifest okunamadı (HTTP 404)'));
    render(<SymbolDesk state={STATE} push={push} />);

    await waitFor(() =>
      expect(screen.getByText('Bu piyasa için paketlenmiş veri yok')).toBeInTheDocument(),
    );
    expect(screen.getByText(/scripts\/pack_data\.py/)).toBeInTheDocument();
  });

  it('sembol listesi manifest’ten gelir', async () => {
    const user = userEvent.setup();
    render(<SymbolDesk state={STATE} push={push} />);
    await screen.findByTestId('chart');

    await user.click(screen.getByRole('combobox', { name: 'Sembol' }));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options.join(' ')).toContain('GARAN');
  });
});

describe('Sembol Masası — sekmeler', () => {
  it('grafik ayarları yalnızca grafik sekmesinde görünür', async () => {
    const user = userEvent.setup();
    render(<SymbolDesk state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByTestId('chart')).toBeInTheDocument());

    const toggles = screen.getByLabelText('EMA 50').closest('.desk__toggles');
    expect(toggles).not.toHaveAttribute('hidden');

    await user.click(screen.getByRole('tab', { name: 'Sektör' }));
    // hidden özniteliği: CSS'te display kuralı bunu ezmemeli (shell.css).
    await waitFor(() => expect(toggles).toHaveAttribute('hidden'));
  });
});

describe('Sembol Masası — analiz çalışmazsa', () => {
  it('boş ekran bırakmaz, nedenini yazar', async () => {
    // Worker kurulamayan tarayıcıda (katı CSP, eklenti) ekran sessizce BOŞ
    // kalıyordu: grafik yok, metrik yok, hata da yok.
    const gercek = FAKE_ANALYSIS.client.symbol;
    FAKE_ANALYSIS.client.symbol = (async () => {
      throw new Error('Bu tarayıcıda arka plan işçisi (Web Worker) başlatılamadı');
    }) as typeof gercek;
    try {
      render(<SymbolDesk state={STATE} push={push} />);
      expect(await screen.findByText('Analiz çalıştırılamadı')).toBeInTheDocument();
      expect(screen.getByText(/Web Worker/)).toBeInTheDocument();
    } finally {
      FAKE_ANALYSIS.client.symbol = gercek;
    }
  });
});

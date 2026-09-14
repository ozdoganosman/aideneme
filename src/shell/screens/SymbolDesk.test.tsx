import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  PriceChart: ({ candles }: { candles: Candles }) => (
    <div data-testid="chart">{candles.length} bar</div>
  ),
}));

// Sembol analizi artık worker'da; sahte istemci aynı çekirdek fonksiyonları
// çağırır, böylece ekranın gösterdiği sayılar gerçek hesapla aynı kalır.
const FAKE_ANALYSIS = {
  client: {
    size: 2,
    symbol: async (
      candles: Candles,
      options: {
        tf: TF;
        overlays: { key: string; length: number }[];
        todayDay: number;
        realReturn: boolean;
      },
    ) => {
      const resampled = resample(candles, options.tf);
      return {
        candles: resampled,
        metrics: summarize(resampled, { realReturn: options.realReturn }),
        health: inspect(candles, { today: options.todayDay }),
        overlayValues: options.overlays.map((o) => emaArr(resampled.close, o.length)),
        ms: 3,
      };
    },
  },
  symbols: ['THYAO', 'GARAN'],
  bars: 0,
  status: 'ready' as const,
  error: null,
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
  it('veri gelince grafik, metrikler ve veri sağlığı gösterilir', async () => {
    render(<SymbolDesk state={STATE} push={push} />);

    expect(await screen.findByTestId('chart')).toHaveTextContent('300 bar');
    expect(screen.getByText('Son kapanış')).toBeInTheDocument();
    expect(screen.getByText('Yıllık bileşik (CAGR)')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Veri sağlığı' })).toBeInTheDocument();
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

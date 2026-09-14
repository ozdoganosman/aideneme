import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DAY_SECONDS } from '../../core/data/pack';
import { emptyCandles, type Candles } from '../../core/data/types';

const backtestFn = vi.fn();
const FAKE_ANALYSIS = {
  client: { backtest: backtestFn, size: 2 },
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

vi.mock('../chart/LineChart', () => ({
  LineChart: ({ series }: { series: { label: string }[] }) => (
    <div data-testid="equity">{series.map((s) => s.label).join('|')}</div>
  ),
}));

import Lab from './Lab';

function sample(n = 300): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    const v = 100 + i * 0.5;
    c.time[i] = (20000 + i) * DAY_SECONDS;
    c.open[i] = v;
    c.high[i] = v * 1.01;
    c.low[i] = v * 0.99;
    c.close[i] = v;
    c.volume[i] = 1_000_000;
  }
  return c;
}

const metrics = {
  bars: 300,
  years: 1.2,
  trades: 4,
  totalReturnPct: 25,
  cagrPct: 20,
  volatilityPct: 18,
  sharpe: 1.1,
  sortino: 1.6,
  calmar: 1.8,
  ulcer: 6,
  maxDrawdownPct: 11,
  maxDrawdownBars: 40,
  winRatePct: 75,
  profitFactor: 3,
  expectancyPct: 4,
  avgWinPct: 8,
  avgLossPct: -3,
  avgBars: 20,
  avgMaePct: -2,
  avgMfePct: 6,
  exposurePct: 55,
  costDragPct: 0.8,
  buyHoldReturnPct: 30,
  buyHoldCagrPct: 24,
  excessCagrPct: -4,
};

function outcome(badges: { id: string; label: string; level: string; detail: string }[] = []) {
  return {
    metrics,
    trades: [
      {
        entryIndex: 10,
        exitIndex: 30,
        entryTime: 20010 * DAY_SECONDS,
        exitTime: 20030 * DAY_SECONDS,
        entryPrice: 105,
        exitPrice: 115,
        shares: 10,
        grossPct: 9.5,
        netPct: 9.3,
        costPct: 0.2,
        maePct: -1.2,
        mfePct: 11,
        bars: 20,
        reason: 'signal' as const,
      },
    ],
    equity: Float64Array.from({ length: 300 }, (_, i) => 100 + i),
    buyHold: Float64Array.from({ length: 300 }, (_, i) => 100 + i * 1.2),
    time: Float64Array.from({ length: 300 }, (_, i) => (20000 + i) * DAY_SECONDS),
    warmup: 51,
    badges,
    ms: 42,
  };
}

const push = vi.fn();
const STATE = { v: 'laboratuvar', m: 'bist', s: 'THYAO', tf: 'D', cmp: '' };

beforeEach(() => {
  vi.clearAllMocks();
  seriesFn.mockResolvedValue({ candles: sample(), entry: {}, fromCache: true });
  backtestFn.mockResolvedValue(outcome());
});

describe('Strateji Laboratuvarı', () => {
  it('hızlı backtest sonucu metrikleri ve sermaye eğrisini gösterir', async () => {
    render(<Lab state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('Yıllık (CAGR)')).toBeInTheDocument());

    expect(screen.getByText('+20.0%')).toBeInTheDocument();
    expect(screen.getByTestId('equity')).toHaveTextContent('Strateji|Al-tut');
    expect(screen.getByText(/1 işlem/)).toBeInTheDocument();
  });

  it('doğrulama çalıştırılmadan sonucun DOĞRULANMADIĞINI söyler', async () => {
    render(<Lab state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText(/doğrulanmadı/)).toBeInTheDocument());
  });

  it('doğrulama çalıştırınca rozetler gelir ve gerekçesi açılır', async () => {
    const user = userEvent.setup();
    render(<Lab state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('Yıllık (CAGR)')).toBeInTheDocument());

    backtestFn.mockResolvedValue(
      outcome([
        { id: 'cost', label: 'Maliyet', level: 'pass', detail: 'Komisyon 10 bps dahil.' },
        { id: 'chance', label: 'Tesadüf', level: 'fail', detail: 'p = 0.640 — tesadüf olabilir.' },
      ]),
    );
    await user.click(screen.getByRole('button', { name: 'Doğrulamayı çalıştır' }));

    await waitFor(() => expect(screen.getByText('Tesadüf')).toBeInTheDocument());
    await user.click(screen.getByText('Tesadüf'));
    expect(screen.getByRole('dialog', { name: 'Tesadüf' })).toHaveTextContent('p = 0.640');
  });

  it('doğrulama isteği permütasyon ve katman ayarlarıyla gider', async () => {
    const user = userEvent.setup();
    render(<Lab state={STATE} push={push} />);
    await waitFor(() => expect(backtestFn).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Doğrulamayı çalıştır' }));
    await waitFor(() => {
      const last = backtestFn.mock.calls[backtestFn.mock.calls.length - 1];
      expect(last[3]).toMatchObject({ permutationRuns: 150, folds: 4 });
    });
  });

  it('hazır strateji seçmek kuralları değiştirir ve yeniden hesaplatır', async () => {
    const user = userEvent.setup();
    render(<Lab state={STATE} push={push} />);
    await waitFor(() => expect(backtestFn).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText('Hazır strateji'), 'rsi-reversion');
    await waitFor(() => expect(backtestFn.mock.calls.length).toBeGreaterThan(1));

    const strategy = backtestFn.mock.calls[backtestFn.mock.calls.length - 1][1];
    expect(JSON.stringify(strategy)).toContain('rsi');
    expect(strategy.stopLossPct).toBe(10);
  });

  it("URL'den gelen strateji kimliğiyle açılır (sıralamadan gelen bağlantı)", async () => {
    render(<Lab state={{ ...STATE, st: 'breakout-55' }} push={push} />);
    await waitFor(() => expect(backtestFn).toHaveBeenCalledTimes(1));
    const strategy = backtestFn.mock.calls[0][1];
    // 55 bar kırılımı: ATR stopu da taşınmalı, sessizce düşmemeli.
    expect(JSON.stringify(strategy)).toContain('highest');
    expect(strategy.atrStop).toEqual({ length: 14, mult: 3 });
  });

  it('maliyet alanı değişince backtest yeni maliyetle koşar', async () => {
    const user = userEvent.setup();
    render(<Lab state={STATE} push={push} />);
    await waitFor(() => expect(backtestFn).toHaveBeenCalledTimes(1));

    const commission = screen.getByLabelText('Komisyon (bps)');
    await user.clear(commission);
    await user.type(commission, '25');

    await waitFor(() => {
      const last = backtestFn.mock.calls[backtestFn.mock.calls.length - 1];
      expect(last[2].costs.commissionBps).toBe(25);
    });
  });
});

describe('Laboratuvar — paylaşılabilir strateji', () => {
  it('bağlantıdaki kuralı yükler', async () => {
    render(
      <Lab
        state={{ ...STATE, str: '1|c~g~ema200!rsi14~l~k35|rsi14~g~k65|7_0_14_0' }}
        push={push}
      />,
    );
    await waitFor(() => expect(backtestFn).toHaveBeenCalledTimes(1));
    const strategy = backtestFn.mock.calls[0][1];
    expect(strategy.entry.of).toHaveLength(2);
    expect(strategy.stopLossPct).toBe(7);
    expect(JSON.stringify(strategy)).toContain('ema');
  });

  it('kural değişince URL replace ile güncellenir', async () => {
    const user = userEvent.setup();
    const replace = vi.fn();
    render(<Lab state={STATE} push={push} replace={replace} />);
    await waitFor(() => expect(replace).toHaveBeenCalled());

    replace.mockClear();
    const stop = screen.getByLabelText('Stop %');
    await user.clear(stop);
    await user.type(stop, '9');
    await waitFor(() => {
      const last = replace.mock.calls[replace.mock.calls.length - 1]?.[0];
      expect(last?.str).toContain('9_');
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('bozuk bağlantı sessizce başka bir strateji çalıştırmaz', async () => {
    render(<Lab state={{ ...STATE, str: '1|bozuk||' }} push={push} />);
    await waitFor(() =>
      expect(screen.getByText(/Kuralın bir kısmı uygulanamadı/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/giriş kuralı okunamadı/)).toBeInTheDocument();
  });
});

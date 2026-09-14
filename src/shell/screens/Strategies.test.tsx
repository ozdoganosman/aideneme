import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BacktestMetrics } from '../../core/backtest/metrics';
import { emptyCandles, type Candles } from '../../core/data/types';
import { STRATEGY_PRESETS } from '../../core/strategy/presets';
import type { SymbolResult } from '../../core/strategy/rank';

const rankFn = vi.fn();
const backtestFn = vi.fn();
const FAKE_ANALYSIS = {
  client: {
    size: 3,
    rank: (...a: unknown[]) => rankFn(...a),
    backtest: (...a: unknown[]) => backtestFn(...a),
  },
  symbols: ['AAA', 'BBB'],
  bars: 250,
  status: 'ready' as const,
  error: null,
};
vi.mock('../useAnalysis', () => ({ useAnalysis: () => FAKE_ANALYSIS }));

const seriesFn = vi.fn();
vi.mock('../../data-client/client', () => ({
  dataClient: { series: (...a: unknown[]) => seriesFn(...a) },
}));

import Strategies from './Strategies';

function metrics(over: Partial<BacktestMetrics>): BacktestMetrics {
  return {
    bars: 250,
    years: 1,
    trades: 4,
    totalReturnPct: 10,
    cagrPct: 10,
    volatilityPct: 20,
    sharpe: 0.5,
    sortino: 0.7,
    calmar: 0.8,
    ulcer: 5,
    maxDrawdownPct: 12,
    maxDrawdownBars: 30,
    winRatePct: 55,
    profitFactor: 1.4,
    expectancyPct: 1,
    avgWinPct: 4,
    avgLossPct: -3,
    avgBars: 12,
    avgMaePct: -3,
    avgMfePct: 5,
    exposurePct: 40,
    costDragPct: 1.2,
    buyHoldReturnPct: 8,
    buyHoldCagrPct: 8,
    excessCagrPct: 2,
    ...over,
  };
}

/** Kazanan strateji: 20 sembolün hepsinde al-tut'u yeniyor. */
function winners(excess: number): SymbolResult[] {
  return Array.from({ length: 20 }, (_, i) => ({
    symbol: `S${i}`,
    metrics: metrics({ excessCagrPct: excess, cagrPct: 8 + excess }),
  }));
}

function candles(n: number): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    c.time[i] = (19000 + i) * 86400;
    c.open[i] = c.high[i] = c.low[i] = c.close[i] = 100;
    c.volume[i] = 1000;
  }
  return c;
}

const push = vi.fn();
const STATE = { v: 'stratejiler', m: 'bist', s: 'AAA' };

beforeEach(() => {
  vi.clearAllMocks();
  const results: Record<string, SymbolResult[]> = {};
  const skipped: Record<string, number> = {};
  STRATEGY_PRESETS.forEach((preset, i) => {
    // İlk strateji her sembolde yeniyor; ikincisi kaybediyor;
    // üçüncüsü hiç ölçülemiyor (ısınma sığmadı).
    results[preset.id] = i === 0 ? winners(4) : i === 1 ? winners(-3) : i === 2 ? [] : winners(0.1);
    skipped[preset.id] = i === 2 ? 200 : 0;
  });
  rankFn.mockResolvedValue({ results, skipped, symbols: 200, ms: 164.7 });
  seriesFn.mockResolvedValue({ candles: candles(3000) });
  backtestFn.mockResolvedValue({ metrics: metrics({ excessCagrPct: 1.5 }), ms: 12 });
});

describe('Stratejiler', () => {
  it('piyasa kapsamında stratejileri al-tut farkına göre sıralar', async () => {
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const rows = screen.getAllByRole('row').slice(1); // başlık satırı hariç
    expect(within(rows[0]).getByText(STRATEGY_PRESETS[0].name)).toBeInTheDocument();
    expect(within(rows[0]).getByText('anlamlı')).toBeInTheDocument();
  });

  it('ölçülemeyen stratejiyi "zayıf" saymaz, gerekçesini yazar', async () => {
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('ölçülemedi')).toBeInTheDocument());
    expect(screen.getByText(/200 sembolde ısınma barlarına sığmıyor/)).toBeInTheDocument();
  });

  it('bağımsızlık uyarısını tablodan ayırmaz', async () => {
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getByText(/p-değeri gerçekte olduğundan İYİMSERDİR/)).toBeInTheDocument();
  });

  it('maliyet kapatılınca yeniden hesaplanır', async () => {
    const user = userEvent.setup();
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(rankFn).toHaveBeenCalledTimes(1));
    expect(rankFn.mock.calls[0][2].costs.commissionBps).toBeGreaterThan(0);

    await user.click(screen.getByLabelText('Maliyet dahil'));
    await waitFor(() => expect(rankFn).toHaveBeenCalledTimes(2));
    expect(rankFn.mock.calls[1][2].costs.commissionBps).toBe(0);
  });

  it('tek sembol kapsamında tüm geçmişi kullanır ve p-değeri göstermez', async () => {
    const user = userEvent.setup();
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Kapsam'), 'symbol');
    await waitFor(() => expect(backtestFn).toHaveBeenCalledTimes(STRATEGY_PRESETS.length));
    expect(seriesFn).toHaveBeenCalledWith('bist', 'AAA');
    expect(screen.queryByText(/p \(iki yönlü/)).toBeNull();
    expect(screen.getByText(/tek gözlem olduğu için p-değeri hesaplanmaz/i)).toBeInTheDocument();
  });

  it('en iyi sembole tıklamak sembol masasına götürür', async () => {
    const user = userEvent.setup();
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: STRATEGY_PRESETS[0].name }));
    await user.click(screen.getByRole('button', { name: 'S0' }));
    expect(push).toHaveBeenCalledWith({ v: 'sembol', s: 'S0' });
  });
});

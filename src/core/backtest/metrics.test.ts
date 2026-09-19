import { describe, expect, it } from 'vitest';
import { computeMetrics } from './metrics';
import { ZERO_COSTS, runBacktest, type BacktestResult } from './engine';
import { DAY_SECONDS } from '../data/pack';
import { emptyCandles, type Candles } from '../data/types';
import type { Strategy } from '../strategy/dsl';

function candlesFrom(closes: number[]): Candles {
  const c = emptyCandles(closes.length);
  closes.forEach((v, i) => {
    c.time[i] = (20000 + i) * DAY_SECONDS;
    c.open[i] = v;
    c.high[i] = v;
    c.low[i] = v;
    c.close[i] = v;
    c.volume[i] = 1_000_000;
  });
  return c;
}

/** Elle kurulmuş sonuç: metrikleri motordan bağımsız sınamak için. */
function resultFrom(equity: number[], trades: BacktestResult['trades'] = []): BacktestResult {
  const arr = Float64Array.from(equity);
  return {
    equity: arr,
    buyHold: Float64Array.from(equity.map(() => equity[0])),
    inPosition: new Uint8Array(equity.length),
    trades,
    exposurePct: 50,
    costPaid: 0,
    warmup: 0,
    skippedByLiquidity: 0,
    initialCash: equity[0],
  };
}

const trade = (netPct: number, grossPct = netPct, bars = 5) => ({
  entryIndex: 0,
  exitIndex: bars,
  entryTime: 0,
  exitTime: bars * DAY_SECONDS,
  entryPrice: 100,
  exitPrice: 100 * (1 + netPct / 100),
  shares: 1,
  grossPct,
  netPct,
  costPct: grossPct - netPct,
  maePct: -2,
  mfePct: 4,
  bars,
  reason: 'signal' as const,
});

describe('getiri ve düşüş', () => {
  it('toplam getiri ve maks. düşüş elle hesaplananla aynı', () => {
    // 100 → 120 → 60 → 90
    const c = candlesFrom([1, 1, 1, 1]);
    const m = computeMetrics(resultFrom([100, 120, 60, 90]), c);
    expect(m.totalReturnPct).toBeCloseTo(-10, 6);
    expect(m.maxDrawdownPct).toBeCloseTo(50, 6); // 120 → 60
  });

  it('CAGR bilinen büyümeyi doğru yıllıklandırır', () => {
    const days = 366;
    const equity = Array.from({ length: days }, (_, i) => 100 * Math.pow(2, i / (days - 1)));
    const m = computeMetrics(resultFrom(equity), candlesFrom(equity.map(() => 1)));
    expect(m.totalReturnPct).toBeCloseTo(100, 4);
    expect(m.cagrPct).toBeGreaterThan(99);
    expect(m.cagrPct).toBeLessThan(101);
  });

  it('Calmar = CAGR ÷ maks. düşüş', () => {
    const equity = Array.from({ length: 400 }, (_, i) =>
      i < 200 ? 100 + i * 0.2 : 140 - (i - 200) * 0.05,
    );
    const c = candlesFrom(equity.map(() => 1));
    const m = computeMetrics(resultFrom(equity), c);
    expect(m.calmar).toBeCloseTo(m.cagrPct / m.maxDrawdownPct, 6);
  });

  it('Ulcer, düşüşsüz seride 0 ve düşüşlü seride pozitif', () => {
    const rising = Array.from({ length: 50 }, (_, i) => 100 + i);
    const c = candlesFrom(rising.map(() => 1));
    expect(computeMetrics(resultFrom(rising), c).ulcer).toBeCloseTo(0, 6);

    const bumpy = rising.map((v, i) => (i % 10 === 0 ? v * 0.8 : v));
    expect(computeMetrics(resultFrom(bumpy), c).ulcer).toBeGreaterThan(0);
  });
});

describe('risk ayarlı ölçüler', () => {
  const bars = 300;
  const c = candlesFrom(Array.from({ length: bars }, () => 1));
  const steady = Array.from({ length: bars }, (_, i) => 100 * 1.002 ** i);

  it('hiç kayıp barı yoksa Sortino tanımsızdır (sonsuz), sıfır değil', () => {
    const m = computeMetrics(resultFrom(steady), c);
    expect(m.sortino).toBe(Infinity);
    expect(m.sharpe).toBe(Infinity);
  });

  it('aşağı sapma arttıkça Sortino düşer', () => {
    const mild = steady.map((v, i) => (i % 2 === 0 ? v * 0.995 : v));
    const harsh = steady.map((v, i) => (i % 2 === 0 ? v * 0.97 : v));
    const a = computeMetrics(resultFrom(mild), c);
    const b = computeMetrics(resultFrom(harsh), c);
    expect(a.sortino).toBeGreaterThan(b.sortino);
    expect(a.volatilityPct).toBeLessThan(b.volatilityPct);
  });

  it('düz seride oran sıfır (getiri yoksa ödül de yok)', () => {
    const flat = Array.from({ length: bars }, () => 100);
    const m = computeMetrics(resultFrom(flat), c);
    expect(m.sharpe).toBe(0);
    expect(m.sortino).toBe(0);
  });
});

describe('işlem istatistikleri', () => {
  const c = candlesFrom([1, 1, 1, 1]);
  const m = computeMetrics(
    resultFrom([100, 110, 105, 120], [trade(10, 10.2), trade(-5, -4.8), trade(6, 6.2)]),
    c,
  );

  it('kazanma oranı, profit factor ve beklenti', () => {
    expect(m.trades).toBe(3);
    expect(m.winRatePct).toBeCloseTo((2 / 3) * 100, 6);
    expect(m.profitFactor).toBeCloseTo(16 / 5, 6);
    expect(m.expectancyPct).toBeCloseTo((10 - 5 + 6) / 3, 6);
  });

  it('maliyetin getiriden götürdüğü ayrıca raporlanır', () => {
    // (10,2 + −4,8 + 6,2) − (10 + −5 + 6) = 0,6
    expect(m.costDragPct).toBeCloseTo(0.6, 6);
  });

  it('hiç işlem yoksa oranlar sıfırlanır, NaN sızmaz', () => {
    const empty = computeMetrics(resultFrom([100, 100, 100]), candlesFrom([1, 1, 1]));
    expect(empty.trades).toBe(0);
    expect(empty.winRatePct).toBe(0);
    expect(empty.profitFactor).toBe(0);
    expect(Number.isFinite(empty.expectancyPct)).toBe(true);
  });
});

describe('al-tut karşılaştırması', () => {
  it('yükselen piyasada al-tut’u geçmeyen strateji negatif fark verir', () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 * 1.01 ** i);
    const c = candlesFrom(closes);
    // Bir bar içeride bir bar dışarıda: al-tut'un yarısını yakalar.
    const flipFlop: Strategy = {
      entry: { op: 'gt', left: { kind: 'close' }, right: { kind: 'const', value: 0 } },
      exit: { op: 'gt', left: { kind: 'close' }, right: { kind: 'const', value: 0 } },
    };
    const result = runBacktest(c, flipFlop, { costs: ZERO_COSTS, extraWarmup: -1 });
    const m = computeMetrics(result, c);

    expect(m.buyHoldCagrPct).toBeGreaterThan(0);
    expect(m.excessCagrPct).toBeLessThan(0);
    expect(m.exposurePct).toBeLessThan(100);
  });
});

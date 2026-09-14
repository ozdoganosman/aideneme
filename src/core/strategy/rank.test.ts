import { describe, expect, it } from 'vitest';
import type { BacktestMetrics } from '../backtest/metrics';
import { STRATEGY_PRESETS } from './presets';
import { holmAdjust, median, rankStrategies, signTest, type SymbolResult } from './rank';

function metrics(over: Partial<BacktestMetrics>): BacktestMetrics {
  return {
    bars: 250,
    years: 1,
    trades: 5,
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

function results(excesses: number[], trades = 5): SymbolResult[] {
  return excesses.map((excess, i) => ({
    symbol: `S${i}`,
    metrics: metrics({ excessCagrPct: excess, cagrPct: 8 + excess, trades }),
  }));
}

describe('işaret testi', () => {
  it('yazı tura dengesinde p ≈ 1', () => {
    expect(signTest(5, 10)).toBeCloseTo(1, 6);
  });

  it("10'da 10 için tam binom değeri verir", () => {
    // 2 × 0.5^10 = 0.001953125
    expect(signTest(10, 10)).toBeCloseTo(0.001953125, 12);
  });

  it('iki yönlüdür: 0 başarı da 10 başarı kadar aykırıdır', () => {
    expect(signTest(0, 10)).toBeCloseTo(signTest(10, 10), 12);
  });
});

describe('Holm düzeltmesi', () => {
  it("en küçük p'yi test sayısıyla, sonrakileri azalan katsayıyla çarpar", () => {
    const adj = holmAdjust([0.01, 0.04, 0.5]);
    expect(adj[0]).toBeCloseTo(0.03, 12); // 0.01 × 3
    expect(adj[1]).toBeCloseTo(0.08, 12); // 0.04 × 2
    expect(adj[2]).toBeCloseTo(0.5, 12); // 0.5 × 1
  });

  it('monotonluğu korur — düzeltilmiş p sıralamayı bozamaz', () => {
    const adj = holmAdjust([0.02, 0.021, 0.9]);
    expect(adj[1]).toBeGreaterThanOrEqual(adj[0]);
  });

  it("1'i aşmaz ve hesaplanamayan p NaN kalır", () => {
    const adj = holmAdjust([0.9, NaN, 0.8]);
    expect(adj[0]).toBeLessThanOrEqual(1);
    expect(Number.isNaN(adj[1])).toBe(true);
  });
});

describe('medyan', () => {
  it("NaN'ları atar ve çift sayıda elemanda ortalar", () => {
    expect(median([1, NaN, 3, 5])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(Number.isNaN(median([NaN]))).toBe(true);
  });
});

describe('strateji sıralaması', () => {
  const preset = STRATEGY_PRESETS[0];
  const other = STRATEGY_PRESETS[1];

  it("al-tut'u tutarlı biçimde yenen stratejiyi anlamlı sayar", () => {
    const rows = rankStrategies([
      { preset, results: results(Array(30).fill(3)) },
      { preset: other, results: results(Array(30).fill(-1)) },
    ]);
    expect(rows[0].beatPct).toBe(100);
    expect(rows[0].verdict).toBe('anlamlı');
    expect(rows[1].verdict).toBe('zayıf');
  });

  it('yarı yarıya sonuçta "belirsiz" der, anlamlı demez', () => {
    const half = [...Array(15).fill(2), ...Array(14).fill(-2)];
    const rows = rankStrategies([{ preset, results: results(half) }]);
    expect(rows[0].verdict).toBe('belirsiz');
    expect(rows[0].adjustedP).toBeGreaterThan(0.05);
  });

  it('çoklu test düzeltmesi tek testmiş gibi okumayı engeller', () => {
    // 8 stratejinin hepsi 8/10 sembolde yeniyor: ham p ~0.11 zaten anlamsız,
    // düzeltilmiş p daha da büyük olmalı ve hiçbiri "anlamlı" çıkmamalı.
    const eight = [...Array(8).fill(1), ...Array(2).fill(-1)];
    const rows = rankStrategies(
      STRATEGY_PRESETS.map((p) => ({ preset: p, results: results(eight) })),
    );
    for (const row of rows) {
      expect(row.adjustedP).toBeGreaterThanOrEqual(row.pValue);
      expect(row.verdict).not.toBe('anlamlı');
    }
  });

  it('işlem üretmeyen semboller sayıma girmez', () => {
    const mixed: SymbolResult[] = [
      ...results([5, 4, 3]),
      ...results([0, 0], 0), // hiç sinyal üretmemiş
    ];
    const rows = rankStrategies([{ preset, results: mixed }]);
    expect(rows[0].symbols).toBe(5);
    expect(rows[0].withTrades).toBe(3);
    expect(rows[0].medianExcessPct).toBe(4);
  });

  it('hiç ölçüm yoksa "zayıf" değil "ölçülemedi" der', () => {
    const rows = rankStrategies([{ preset, results: [] }]);
    expect(rows[0].verdict).toBe('ölçülemedi');
    expect(Number.isNaN(rows[0].medianExcessPct)).toBe(true);
  });

  it('koştu ama hiç sinyal üretmediyse "sinyal yok" der', () => {
    const rows = rankStrategies([{ preset, results: results([0, 0, 0], 0) }]);
    expect(rows[0].verdict).toBe('sinyal yok');
    expect(rows[0].symbols).toBe(3);
    expect(rows[0].withTrades).toBe(0);
  });

  it('en çok fark yaratan sembolleri sıralı verir', () => {
    const rows = rankStrategies([{ preset, results: results([1, 9, 5, 3, 7, 2]) }], {
      topSymbols: 3,
    });
    expect(rows[0].best.map((b) => b.excessPct)).toEqual([9, 7, 5]);
  });
});

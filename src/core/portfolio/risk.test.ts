import { describe, expect, it } from 'vitest';
import {
  BIST_SCENARIOS,
  concentration,
  portfolioReturns,
  runScenario,
  tailRisk,
  type Holding,
} from './risk';
import { DAY_SECONDS } from '../data/pack';
import { emptyCandles, type Candles } from '../data/types';

function series(startDay: number, closes: number[]): Candles {
  const c = emptyCandles(closes.length);
  closes.forEach((v, i) => {
    c.time[i] = (startDay + i) * DAY_SECONDS;
    c.open[i] = v;
    c.high[i] = v;
    c.low[i] = v;
    c.close[i] = v;
    c.volume[i] = 1000;
  });
  return c;
}

const DAY0 = 19000;

describe('portfolioReturns', () => {
  it('ağırlıklı getiriyi bileşenlerden hesaplar', () => {
    const a = series(DAY0, [100, 110, 121]); // +%10, +%10
    const b = series(DAY0, [100, 100, 100]); // 0, 0
    const holdings: Holding[] = [
      { symbol: 'A', weight: 0.5 },
      { symbol: 'B', weight: 0.5 },
    ];
    const { returns, used } = portfolioReturns(holdings, (s) => (s === 'A' ? a : b));
    expect(used).toEqual(['A', 'B']);
    expect(Array.from(returns)).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.05, 9);
  });

  it('ortak günlerin kesişimini kullanır', () => {
    const a = series(DAY0, [100, 101, 102, 103]);
    const b = series(DAY0 + 2, [50, 51, 52]);
    const { returns, days } = portfolioReturns(
      [
        { symbol: 'A', weight: 0.5 },
        { symbol: 'B', weight: 0.5 },
      ],
      (s) => (s === 'A' ? a : b),
    );
    expect(days.length).toBe(returns.length);
    expect(days.length).toBeGreaterThan(0);
    for (const day of days) expect(day).toBeGreaterThanOrEqual(DAY0 + 3);
  });

  it('verisi olmayan sembolü bildirir ve kalanla devam eder', () => {
    const a = series(DAY0, [100, 105]);
    const { used, missing } = portfolioReturns(
      [
        { symbol: 'A', weight: 0.5 },
        { symbol: 'YOK', weight: 0.5 },
      ],
      (s) => (s === 'A' ? a : undefined),
    );
    expect(used).toEqual(['A']);
    expect(missing).toEqual(['YOK']);
  });
});

describe('tailRisk', () => {
  it('tarihsel VaR gözlemlerin yüzdeliğidir', () => {
    // 100 gözlem: −%1 … +%98 aralığında eşit dağılım.
    const returns = Array.from({ length: 100 }, (_, i) => (i - 1) / 100);
    const risk = tailRisk(returns, 0.95);
    expect(risk.samples).toBe(100);
    // %95 güven → en kötü %5'in sınırı.
    expect(risk.varPct).toBeCloseTo(4, 6);
    expect(risk.cvarPct).toBeLessThan(risk.varPct); // kuyruk ortalaması daha kötü
  });

  it('şişman kuyruk CVaR’ı VaR’dan belirgin ayırır', () => {
    const normalish = Array.from({ length: 500 }, (_, i) => (i % 2 ? 0.01 : -0.01));
    const fat: number[] = [...normalish];
    fat[0] = -0.35; // tek bir çöküş günü
    const a = tailRisk(normalish);
    const b = tailRisk(fat);
    expect(b.cvarPct).toBeLessThan(a.cvarPct);
  });

  it('yetersiz gözlemde NaN (uydurma risk yok)', () => {
    expect(Number.isNaN(tailRisk([0.01, -0.02]).varPct)).toBe(true);
  });
});

describe('concentration', () => {
  it('tek hissede HHI 1, eşit dağılımda 1/n', () => {
    expect(concentration([100]).herfindahl).toBeCloseTo(1, 9);
    const equal = concentration([25, 25, 25, 25]);
    expect(equal.herfindahl).toBeCloseTo(0.25, 9);
    expect(equal.effectivePositions).toBeCloseTo(4, 9);
    expect(equal.top1Pct).toBeCloseTo(25, 9);
  });

  it('yoğunlaşma arttıkça etkin pozisyon sayısı düşer', () => {
    const spread = concentration([20, 20, 20, 20, 20]);
    const concentrated = concentration([80, 5, 5, 5, 5]);
    expect(concentrated.effectivePositions).toBeLessThan(spread.effectivePositions);
    expect(concentrated.top1Pct).toBeCloseTo(80, 9);
  });

  it('boş portföyde NaN', () => {
    expect(Number.isNaN(concentration([]).herfindahl)).toBe(true);
  });
});

describe('runScenario', () => {
  const scenario = BIST_SCENARIOS[1]; // Mart 2020

  function seriesAround(scenarioFrom: number, drop: number): Candles {
    const closes: number[] = [];
    for (let i = 0; i < 60; i++) closes.push(i < 20 ? 100 : 100 * (1 - drop));
    return series(scenarioFrom - 10, closes);
  }

  it('tarihsel pencerede portföy getirisini ölçer', () => {
    const result = runScenario(
      [{ symbol: 'A', weight: 1 }],
      () => seriesAround(scenario.fromDay, 0.3),
      scenario,
    );
    expect(result.covered).toBe(1);
    expect(result.returnPct).toBeCloseTo(-30, 6);
  });

  it('pencerede verisi olmayan portföyde NaN döner', () => {
    const result = runScenario(
      [{ symbol: 'A', weight: 1 }],
      () => series(15000, [1, 2, 3]),
      scenario,
    );
    expect(Number.isNaN(result.returnPct)).toBe(true);
    expect(result.covered).toBe(0);
  });

  it('senaryolar tanımlı ve tutarlı', () => {
    for (const s of BIST_SCENARIOS) {
      expect(s.toDay).toBeGreaterThan(s.fromDay);
      expect(s.label.length).toBeGreaterThan(5);
      expect(s.note.length).toBeGreaterThan(5);
    }
  });
});

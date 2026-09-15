import { describe, expect, it } from 'vitest';
import {
  collectKnobs,
  parameterPlateau,
  permutationTest,
  validateStrategy,
  walkForward,
  withKnob,
} from './validate';
import { DEFAULT_COSTS, ZERO_COSTS } from './engine';
import { DAY_SECONDS } from '../data/pack';
import { emptyCandles, type Candles } from '../data/types';
import type { Strategy } from '../strategy/dsl';
import { rng } from './stats';

function fromCloses(closes: number[]): Candles {
  const c = emptyCandles(closes.length);
  closes.forEach((v, i) => {
    c.time[i] = (20000 + i) * DAY_SECONDS;
    c.open[i] = v;
    c.high[i] = v * 1.005;
    c.low[i] = v * 0.995;
    c.close[i] = v;
    c.volume[i] = 5_000_000;
  });
  return c;
}

/** Güçlü trendli seri: yönü uzun süre korur (momentum stratejisi kazanmalı). */
function trending(n: number, seed = 5): Candles {
  const random = rng(seed);
  const closes: number[] = [];
  let price = 100;
  let drift = 0.004;
  for (let i = 0; i < n; i++) {
    if (i % 120 === 0) drift = -drift; // uzun süren rejimler
    price = Math.max(1, price * (1 + drift + (random() - 0.5) * 0.01));
    closes.push(price);
  }
  return fromCloses(closes);
}

const MOMENTUM: Strategy = {
  entry: {
    op: 'crossAbove',
    left: { kind: 'ema', length: 10 },
    right: { kind: 'ema', length: 40 },
  },
  exit: { op: 'crossBelow', left: { kind: 'ema', length: 10 }, right: { kind: 'ema', length: 40 } },
};

describe('parametre düğmeleri', () => {
  it('pencere uzunluklarını ve stop/hedefi bulur', () => {
    const knobs = collectKnobs({ ...MOMENTUM, stopLossPct: 8, takeProfitPct: 20 });
    const paths = knobs.map((k) => k.path);
    expect(paths).toContain('entry.left.length');
    expect(paths).toContain('entry.right.length');
    expect(paths).toContain('stopLossPct');
    expect(paths).toContain('takeProfitPct');
  });

  it('withKnob orijinal stratejiyi DEĞİŞTİRMEZ', () => {
    const modified = withKnob(MOMENTUM, 'entry.left.length', 99);
    expect(collectKnobs(modified)[0].value).toBe(99);
    expect(collectKnobs(MOMENTUM)[0].value).toBe(10); // orijinal sağlam
  });
});

describe('walkForward', () => {
  it('ileri pencerelerde sonuç üretir ve pencereler örtüşmez', () => {
    const c = trending(900);
    const wf = walkForward(c, MOMENTUM, { costs: ZERO_COSTS, folds: 3 });
    expect(wf.folds.length).toBeGreaterThanOrEqual(2);
    for (const fold of wf.folds) {
      expect(fold.testFrom).toBeGreaterThanOrEqual(fold.trainTo);
      expect(fold.testTo).toBeGreaterThan(fold.testFrom);
    }
    expect(Number.isFinite(wf.meanTestCagrPct)).toBe(true);
  });

  it('kısa seride katman üretmez (uydurma OOS yok)', () => {
    expect(walkForward(fromCloses([1, 2, 3, 4, 5]), MOMENTUM).folds).toHaveLength(0);
  });

  it('düğme verilirse parametreyi GEÇMİŞ pencerede seçer', () => {
    const c = trending(900, 9);
    const wf = walkForward(c, MOMENTUM, {
      costs: ZERO_COSTS,
      folds: 3,
      knob: { path: 'entry.right.length', value: 40, min: 5, max: 200, label: 'EMA uzunluk' },
      candidates: [20, 40, 60, 80],
    });
    const chosen = wf.folds.filter((f) => f.chosen);
    // En az bir katmanda eğitim penceresi farklı bir değeri daha iyi bulmalı.
    expect(chosen.length).toBeGreaterThan(0);
    for (const fold of chosen) expect([20, 60, 80]).toContain(fold.chosen!.value);
  });
});

describe('parameterPlateau', () => {
  it('her düğme için taban + komşu noktalar üretir', () => {
    const c = trending(400);
    const plateau = parameterPlateau(c, MOMENTUM, { costs: ZERO_COSTS });
    const bases = plateau.points.filter((p) => p.base);
    expect(bases).toHaveLength(collectKnobs(MOMENTUM).length);
    expect(plateau.points.length).toBeGreaterThan(bases.length);
    expect(Number.isFinite(plateau.positiveNeighborPct)).toBe(true);
  });

  it('değiştirilecek parametresi olmayan stratejide NaN döner (uydurmaz)', () => {
    const noKnobs: Strategy = {
      entry: { op: 'gt', left: { kind: 'close' }, right: { kind: 'open' } },
    };
    const plateau = parameterPlateau(trending(300), noKnobs, { costs: ZERO_COSTS });
    expect(Number.isNaN(plateau.positiveNeighborPct)).toBe(true);
  });
});

describe('permutationTest', () => {
  it('trendli seride trend stratejisi düşük p-değeri alır', () => {
    const c = trending(600, 11);
    const result = permutationTest(c, MOMENTUM, { costs: ZERO_COSTS, runs: 40, seed: 1 });
    expect(result.runs).toBe(40);
    expect(result.observedCagrPct).toBeGreaterThan(result.medianNullCagrPct);
    expect(result.pValue).toBeLessThan(0.35);
  });

  it('aynı tohum aynı p-değerini verir (tekrarlanabilir)', () => {
    const c = trending(400, 3);
    const a = permutationTest(c, MOMENTUM, { costs: ZERO_COSTS, runs: 20, seed: 7 });
    const b = permutationTest(c, MOMENTUM, { costs: ZERO_COSTS, runs: 20, seed: 7 });
    expect(a.pValue).toBe(b.pValue);
  });

  it('çok kısa seride test yapılmaz', () => {
    const result = permutationTest(fromCloses([1, 2, 3]), MOMENTUM, { runs: 10 });
    expect(result.runs).toBe(0);
    expect(Number.isNaN(result.pValue)).toBe(true);
  });
});

describe('validateStrategy', () => {
  const c = trending(700, 21);

  it('beş rozetin hepsini üretir', () => {
    const report = validateStrategy(c, MOMENTUM, {
      costs: DEFAULT_COSTS,
      permutationRuns: 20,
      folds: 3,
      seed: 4,
    });
    expect(report.badges.map((b) => b.id).sort()).toEqual(
      ['chance', 'cost', 'multiplicity', 'oos', 'robust'].sort(),
    );
    for (const badge of report.badges) {
      expect(badge.detail.length).toBeGreaterThan(10);
      expect(['pass', 'warn', 'fail', 'unknown']).toContain(badge.level);
    }
  });

  it('maliyetsiz çalıştırma rozeti KIRMIZI yapar', () => {
    const report = validateStrategy(c, MOMENTUM, {
      costs: ZERO_COSTS,
      skipPermutation: true,
      skipPlateau: true,
      skipWalkForward: true,
    });
    const cost = report.badges.find((b) => b.id === 'cost')!;
    expect(cost.level).toBe('fail');
    expect(cost.detail).toMatch(/SIFIR/);
  });

  it('çok sayıda deneme çoklu test rozetini düşürür', () => {
    const options = {
      costs: DEFAULT_COSTS,
      skipPermutation: true,
      skipPlateau: true,
      skipWalkForward: true,
    };
    const few = validateStrategy(c, MOMENTUM, { ...options, trials: 1 });
    const many = validateStrategy(c, MOMENTUM, { ...options, trials: 10000 });
    expect(many.deflatedSharpe!.dsr).toBeLessThanOrEqual(few.deflatedSharpe!.dsr);
    expect(many.deflatedSharpe!.threshold).toBeGreaterThan(few.deflatedSharpe!.threshold);
  });

  it('ağır adımlar atlanabilir (hızlı mod)', () => {
    const report = validateStrategy(c, MOMENTUM, {
      skipPermutation: true,
      skipPlateau: true,
      skipWalkForward: true,
    });
    expect(report.permutation).toBeUndefined();
    expect(report.plateau).toBeUndefined();
    expect(report.walkForward).toBeUndefined();
    expect(report.badges).toHaveLength(2); // maliyet + çoklu test
  });
});

import { describe, expect, it } from 'vitest';
import {
  deflatedSharpe,
  expectedMaxSharpe,
  moments,
  normalCdf,
  normalInv,
  rng,
  shuffle,
} from './stats';

describe('normal dağılım', () => {
  it('CDF bilinen değerleri verir', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(5)).toBeGreaterThan(0.9999);
  });

  it('ters CDF, CDF’nin tersidir', () => {
    for (const p of [0.01, 0.1, 0.5, 0.9, 0.975, 0.999]) {
      expect(normalCdf(normalInv(p))).toBeCloseTo(p, 4);
    }
    expect(normalInv(0.975)).toBeCloseTo(1.96, 3);
  });
});

describe('moments', () => {
  it('normal benzeri seride çarpıklık ~0, basıklık ~3', () => {
    const random = rng(7);
    const values: number[] = [];
    for (let i = 0; i < 20000; i++) {
      // Box–Muller
      const u = Math.max(1e-12, random());
      const v = random();
      values.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
    }
    const m = moments(values);
    expect(m.mean).toBeCloseTo(0, 1);
    expect(m.std).toBeCloseTo(1, 1);
    expect(Math.abs(m.skewness)).toBeLessThan(0.1);
    expect(m.kurtosis).toBeGreaterThan(2.7);
    expect(m.kurtosis).toBeLessThan(3.3);
  });

  it('sağa çarpık seride çarpıklık pozitif', () => {
    const values = Array.from({ length: 1000 }, (_, i) => (i < 950 ? 0 : 10));
    expect(moments(values).skewness).toBeGreaterThan(1);
  });
});

describe('expectedMaxSharpe', () => {
  it('deneme sayısı arttıkça şansla beklenen en iyi Sharpe yükselir', () => {
    const a = expectedMaxSharpe(10);
    const b = expectedMaxSharpe(1000);
    expect(b).toBeGreaterThan(a);
    expect(a).toBeGreaterThan(0);
  });
});

describe('deflatedSharpe', () => {
  const base = { bars: 1000, skewness: 0, kurtosis: 3 };

  it('tek denemede yüksek Sharpe güvenilir sayılır', () => {
    const { dsr } = deflatedSharpe({ ...base, sharpePerBar: 0.1, trials: 1 });
    expect(dsr).toBeGreaterThan(0.95);
  });

  it('aynı Sharpe, çok deneme sonrası güvenilirliğini kaybeder', () => {
    const few = deflatedSharpe({ ...base, sharpePerBar: 0.06, trials: 2 }).dsr;
    const many = deflatedSharpe({ ...base, sharpePerBar: 0.06, trials: 5000 }).dsr;
    expect(many).toBeLessThan(few);
  });

  it('negatif çarpıklık ve şişman kuyruk güveni düşürür', () => {
    const normal = deflatedSharpe({ ...base, sharpePerBar: 0.08, trials: 10 }).dsr;
    const fat = deflatedSharpe({
      ...base,
      sharpePerBar: 0.08,
      skewness: -1.5,
      kurtosis: 9,
      trials: 10,
    }).dsr;
    expect(fat).toBeLessThan(normal);
  });
});

describe('rng / shuffle', () => {
  it('aynı tohum aynı diziyi verir (tekrarlanabilirlik)', () => {
    const a = Array.from({ length: 5 }, rng(42));
    const b = Array.from({ length: 5 }, rng(42));
    expect(a).toEqual(b);
  });

  it('karıştırma öğeleri korur', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle([...items], rng(3));
    expect(out.slice().sort((x, y) => x - y)).toEqual(items);
  });
});

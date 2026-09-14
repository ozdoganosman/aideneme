import { describe, expect, it } from 'vitest';
import { atrArr, rsiArr } from './rsi';

const f = (...v: number[]) => Float64Array.from(v);

describe('rsiArr', () => {
  it('kesintisiz yükselişte 100, kesintisiz düşüşte 0', () => {
    const up = rsiArr(f(...Array.from({ length: 40 }, (_, i) => 100 + i)), 14);
    expect(up[39]).toBeCloseTo(100, 6);

    const down = rsiArr(f(...Array.from({ length: 40 }, (_, i) => 200 - i)), 14);
    expect(down[39]).toBeCloseTo(0, 6);
  });

  it('simetrik testere dişinde 50 civarı', () => {
    const saw = Array.from({ length: 200 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
    const out = rsiArr(f(...saw), 14);
    expect(out[199]).toBeGreaterThan(40);
    expect(out[199]).toBeLessThan(60);
  });

  it('ısınma süresince NaN', () => {
    const out = rsiArr(f(...Array.from({ length: 20 }, (_, i) => 100 + i)), 14);
    for (let i = 0; i < 14; i++) expect(Number.isNaN(out[i])).toBe(true);
    expect(Number.isFinite(out[14])).toBe(true);
  });

  it('yetersiz veride tamamı NaN (uydurma değer üretmez)', () => {
    const out = rsiArr(f(1, 2, 3), 14);
    expect(out.every((v) => Number.isNaN(v))).toBe(true);
  });
});

describe('atrArr', () => {
  it('sabit aralıklı barlarda aralığa eşit', () => {
    const n = 40;
    const high = f(...Array.from({ length: n }, () => 102));
    const low = f(...Array.from({ length: n }, () => 98));
    const close = f(...Array.from({ length: n }, () => 100));
    expect(atrArr(high, low, close, 14)[n - 1]).toBeCloseTo(4, 6);
  });

  it('boşluk (gap) gerçek aralığa yansır', () => {
    const n = 40;
    const high = Array.from({ length: n }, () => 102);
    const low = Array.from({ length: n }, () => 98);
    const close = Array.from({ length: n }, () => 100);
    high[20] = 130;
    low[20] = 126;
    close[20] = 128;
    const atr = atrArr(f(...high), f(...low), f(...close), 14);
    expect(atr[20]).toBeGreaterThan(atr[19]);
  });
});

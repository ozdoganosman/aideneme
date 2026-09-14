import { describe, expect, it } from 'vitest';
import { emaArr, rollingHighest, rollingLowest, rollingVWMA, rocArr, adxArr } from './calc';
import { emptyCandles } from '../data/types';

const f = (...v: number[]) => Float64Array.from(v);

describe('emaArr', () => {
  // Altın değerler: alpha = 2/(L+1) = 0.5, ilk değerle tohumlanır.
  it('bilinen seriyi birebir üretir', () => {
    const out = emaArr(f(1, 2, 3, 4, 5), 3);
    expect(Array.from(out)).toEqual([1, 1.5, 2.25, 3.125, 4.0625]);
  });

  it('sabit seride sabit kalır', () => {
    const out = emaArr(f(7, 7, 7, 7), 10);
    // Kayan nokta yuvarlaması birikir; değişmez olan "sabit kalır", "bit-bit eşit" değil.
    for (const v of out) expect(v).toBeCloseTo(7, 12);
  });

  it('NaN barlarda son değeri korur (ısınma boşluğu seriyi bozmaz)', () => {
    const out = emaArr(f(NaN, 2, NaN, 4), 1); // alpha = 1 → son değeri izler
    expect(Array.from(out)).toEqual([NaN, 2, 2, 4]);
  });
});

describe('rollingHighest / rollingLowest', () => {
  it('kayan pencere uçlarını doğru verir', () => {
    expect(Array.from(rollingHighest(f(3, 1, 4, 1, 5), 3))).toEqual([3, 3, 4, 4, 5]);
    expect(Array.from(rollingLowest(f(3, 1, 4, 1, 5), 3))).toEqual([3, 1, 1, 1, 1]);
  });

  it('monotonik deque, kaba kuvvetle aynı sonucu verir', () => {
    const n = 500;
    const arr = new Float64Array(n);
    let seed = 42;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648; // deterministik LCG
      arr[i] = seed / 2147483648;
    }
    const len = 17;
    const fast = rollingHighest(arr, len);
    for (let i = 0; i < n; i++) {
      let brute = -Infinity;
      for (let j = Math.max(0, i - len + 1); j <= i; j++) brute = Math.max(brute, arr[j]);
      expect(fast[i]).toBeCloseTo(brute, 12);
    }
  });
});

describe('rollingVWMA', () => {
  it('hacimle ağırlıklandırır', () => {
    // Pencere = son 2 bar. i=1 → (10*1 + 20*3)/(1+3) = 17.5
    const out = rollingVWMA(f(10, 20), f(1, 3), 2);
    expect(out[1]).toBeCloseTo(17.5, 12);
  });

  it('hacim sıfırken NaN döner (sıfıra bölme sessizce 0 olmaz)', () => {
    const out = rollingVWMA(f(10, 20), f(0, 0), 2);
    expect(Number.isNaN(out[0])).toBe(true);
  });
});

describe('rocArr', () => {
  it('yüzde değişimi verir, ısınmada NaN', () => {
    const out = rocArr(f(100, 110, 121), 1);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(out[1]).toBeCloseTo(10, 12);
    expect(out[2]).toBeCloseTo(10, 12);
  });
});

describe('adxArr', () => {
  it('kesintisiz yükselen trendde yüksek, 0–100 aralığında kalır', () => {
    const n = 120;
    const c = emptyCandles(n);
    for (let i = 0; i < n; i++) {
      const base = 100 + i; // tek yönlü trend
      c.time[i] = i * 86400;
      c.open[i] = base;
      c.high[i] = base + 1;
      c.low[i] = base - 1;
      c.close[i] = base + 0.5;
      c.volume[i] = 1000;
    }
    const adx = adxArr(c, 14);
    const last = adx[n - 1];
    expect(Number.isFinite(last)).toBe(true);
    expect(last).toBeGreaterThan(50);
    expect(last).toBeLessThanOrEqual(100);
  });
});

import { describe, expect, it } from 'vitest';
import { macdArr, macdSignalArr, supertrendArr, willrArr } from './trend';
import { emaArr } from './calc';
import { emptyCandles, type Candles } from '../data/types';

function candles(rows: [number, number, number][]): Candles {
  // [yüksek, düşük, kapanış]
  const c = emptyCandles(rows.length);
  rows.forEach(([h, l, close], i) => {
    c.time[i] = 1_700_000_000 + i * 86_400;
    c.open[i] = close;
    c.high[i] = h;
    c.low[i] = l;
    c.close[i] = close;
    c.volume[i] = 1000;
  });
  return c;
}

describe('willrArr', () => {
  it('pencerenin tepesinde 100, dibinde 0 verir', () => {
    const c = candles([
      [10, 0, 5],
      [10, 0, 10], // pencere tepesi
      [10, 0, 0], // pencere dibi
    ]);
    const w = willrArr(c, 3);
    expect(w[1]).toBeCloseTo(100, 6);
    expect(w[2]).toBeCloseTo(0, 6);
  });

  it('ortada 50 verir — eşiklerin dayandığı ölçek bu', () => {
    // Eski sistemin kuralları "%R 14 > 50" gibi 0..100 ölçeğine yazılmış;
    // klasik −100..0 ölçeğine kayarsa bütün eşikler anlamını yitirir.
    const c = candles([
      [10, 0, 5],
      [10, 0, 5],
    ]);
    expect(willrArr(c, 2)[1]).toBeCloseTo(50, 6);
  });

  it('düz pencerede sayı uydurmaz', () => {
    const c = candles([
      [7, 7, 7],
      [7, 7, 7],
    ]);
    expect(Number.isNaN(willrArr(c, 2)[1])).toBe(true);
  });
});

describe('macdArr', () => {
  it('iki EMA farkıdır', () => {
    const close = Float64Array.from({ length: 60 }, (_, i) => 100 + i);
    const m = macdArr(close, 12, 26);
    const f = emaArr(close, 12);
    const s = emaArr(close, 26);
    expect(m[59]).toBeCloseTo(f[59] - s[59], 10);
  });

  it('yükselen seride pozitif, düşende negatif', () => {
    const up = Float64Array.from({ length: 80 }, (_, i) => 100 * 1.01 ** i);
    const down = Float64Array.from({ length: 80 }, (_, i) => 100 * 0.99 ** i);
    expect(macdArr(up, 12, 26)[79]).toBeGreaterThan(0);
    expect(macdArr(down, 12, 26)[79]).toBeLessThan(0);
  });

  it('sinyal, MACD’nin EMA’sıdır', () => {
    const close = Float64Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const sig = macdSignalArr(close, 12, 26, 9);
    const ref = emaArr(macdArr(close, 12, 26), 9);
    expect(sig[79]).toBeCloseTo(ref[79], 10);
  });
});

describe('supertrendArr', () => {
  it('yükselen trendde fiyatın ALTINDA kalır', () => {
    const rows: [number, number, number][] = Array.from({ length: 60 }, (_, i) => {
      const p = 100 + i * 2;
      return [p + 1, p - 1, p];
    });
    const st = supertrendArr(candles(rows), 10, 3);
    const last = st.length - 1;
    expect(st[last]).toBeLessThan(rows[last][2]);
  });

  it('düşen trendde fiyatın ÜSTÜNDE kalır', () => {
    const rows: [number, number, number][] = Array.from({ length: 60 }, (_, i) => {
      const p = 200 - i * 2;
      return [p + 1, p - 1, p];
    });
    const st = supertrendArr(candles(rows), 10, 3);
    const last = st.length - 1;
    expect(st[last]).toBeGreaterThan(rows[last][2]);
  });

  it('trend dönene kadar bant geri çekilmez', () => {
    // Yükselişte alt bant monoton yükselmeli: her barda yeniden hesaplansaydı
    // çizgi oynar, "kapanış > supertrend" kuralı gürültüye boğulurdu.
    const rows: [number, number, number][] = Array.from({ length: 80 }, (_, i) => {
      const p = 100 + i;
      return [p + 2, p - 2, p];
    });
    const st = supertrendArr(candles(rows), 10, 3);
    for (let i = 30; i < st.length; i++) {
      expect(st[i]).toBeGreaterThanOrEqual(st[i - 1] - 1e-9);
    }
  });

  it('boş seride çökmez', () => {
    expect(supertrendArr(emptyCandles(0), 10, 3).length).toBe(0);
  });
});

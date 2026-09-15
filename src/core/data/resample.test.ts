import { describe, expect, it } from 'vitest';
import { resample } from './resample';
import { emptyCandles, type Candles } from './types';

/** i günlük ardışık bar; fiyatlar tahmin edilebilir olsun diye indeksten türetilir. */
function daily(n: number, startUnix = Date.UTC(2024, 0, 1) / 1000): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    c.time[i] = startUnix + i * 86400;
    c.open[i] = 100 + i;
    c.high[i] = 100 + i + 2;
    c.low[i] = 100 + i - 2;
    c.close[i] = 100 + i + 1;
    c.volume[i] = 10;
  }
  return c;
}

describe('resample', () => {
  it("'D' girdiyi aynen döndürür", () => {
    const d = daily(10);
    expect(resample(d, 'D')).toBe(d);
  });

  it('bar sayısını asla artırmaz (değişmez)', () => {
    const d = daily(400);
    expect(resample(d, 'W').length).toBeLessThanOrEqual(d.length);
    expect(resample(d, 'M').length).toBeLessThanOrEqual(resample(d, 'W').length);
  });

  it('hacmi korur (toplam değişmez)', () => {
    const d = daily(365);
    const sum = (c: Candles) => c.volume.reduce((s, v) => s + v, 0);
    expect(sum(resample(d, 'W'))).toBeCloseTo(sum(d), 6);
    expect(sum(resample(d, 'M'))).toBeCloseTo(sum(d), 6);
  });

  it('OHLC kovalama kuralını uygular: ilk açılış, en yüksek, en düşük, son kapanış', () => {
    const d = daily(31); // Oca 2024, tek ay
    const m = resample(d, 'M');
    expect(m.length).toBe(1);
    expect(m.open[0]).toBe(d.open[0]);
    expect(m.close[0]).toBe(d.close[30]);
    expect(m.high[0]).toBe(Math.max(...Array.from(d.high)));
    expect(m.low[0]).toBe(Math.min(...Array.from(d.low)));
  });

  it('aylık kovalar ay sınırında kopar', () => {
    const d = daily(70); // Oca (31) + Şub (29, artık yıl) + Mart başı
    const m = resample(d, 'M');
    expect(m.length).toBe(3);
    const months = Array.from(m.time).map((t) => new Date(t * 1000).getUTCMonth());
    expect(months).toEqual([0, 1, 2]);
  });

  it('boş seride çökmez', () => {
    const empty = emptyCandles(0);
    expect(resample(empty, 'W').length).toBe(0);
  });
});

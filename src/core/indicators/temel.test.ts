import { describe, expect, it } from 'vitest';
import { emptyCandles, type Candles } from '../data/types';
import { smaArr, wmaArr, stdevArr, stochKArr, obvArr, vwapArr, tipikFiyat } from './temel';

function mumlar(kapanis: number[], hacim?: number[]): Candles {
  const c = emptyCandles(kapanis.length);
  for (let i = 0; i < kapanis.length; i++) {
    c.time[i] = 86_400 * (i + 1);
    c.open[i] = kapanis[i];
    c.high[i] = kapanis[i] + 1;
    c.low[i] = kapanis[i] - 1;
    c.close[i] = kapanis[i];
    c.volume[i] = hacim?.[i] ?? 100;
  }
  return c;
}

describe('temel göstergeler', () => {
  it('SMA: pencere dolmadan sayı üretmiyor', () => {
    const s = smaArr(Float64Array.from([1, 2, 3, 4, 5]), 3);
    expect([...s.slice(0, 2)].every(Number.isNaN)).toBe(true);
    expect(s[2]).toBeCloseTo(2, 10);
    expect(s[4]).toBeCloseTo(4, 10);
  });

  it('SMA kayan toplamı sürükleme biriktirmiyor', () => {
    // Büyük taban + küçük değişim: kayan toplam kullanan bir uygulama burada
    // basamak kaybeder. Referans ORTALAMA ile karşılaştırılıyor.
    const n = 500;
    const a = new Float64Array(n);
    for (let i = 0; i < n; i++) a[i] = 1e6 + (i % 7);
    const s = smaArr(a, 30);
    let beklenen = 0;
    for (let k = 0; k < 30; k++) beklenen += a[n - 1 - k];
    beklenen /= 30;
    expect(s[n - 1]).toBeCloseTo(beklenen, 6);
  });

  it('WMA son barı daha ağır tartıyor', () => {
    const a = Float64Array.from([1, 1, 10]);
    // (1·1 + 1·2 + 10·3) / 6 = 5,5 — düz ortalama 4 olurdu.
    expect(wmaArr(a, 3)[2]).toBeCloseTo(5.5, 10);
  });

  it('stdev sabit seride sıfır', () => {
    const s = stdevArr(Float64Array.from([5, 5, 5, 5]), 3);
    expect(s[3]).toBeCloseTo(0, 12);
  });

  it('stokastik: yatay pencerede sayı UYDURMUYOR', () => {
    const c = emptyCandles(4);
    for (let i = 0; i < 4; i++) {
      c.time[i] = 86_400 * (i + 1);
      c.open[i] = c.high[i] = c.low[i] = c.close[i] = 10;
      c.volume[i] = 1;
    }
    expect(Number.isNaN(stochKArr(c, 3)[3])).toBe(true);
  });

  it('stokastik pencerenin gerçek uçlarını kullanıyor', () => {
    // `mumlar` yüksek = kapanış+1, düşük = kapanış−1 üretiyor. Kapanışlar
    // 10/11/12 iken 3'lük pencerede en yüksek 13, en düşük 9:
    //   100·(12 − 9)/(13 − 9) = 75
    // Eşik yerine TAM değer: "80'den büyük" ilk yazımda yanlış hesaplanmıştı
    // ve testin kendisi kusurluydu, kod değil.
    expect(stochKArr(mumlar([10, 11, 12]), 3)[2]).toBeCloseTo(75, 10);
  });

  it('OBV yönü hacimle biriktiriyor', () => {
    const c = mumlar([10, 11, 10, 12], [5, 7, 3, 9]);
    // 0, +7, −3, +9
    expect([...obvArr(c)]).toEqual([0, 7, 4, 13]);
  });

  it('VWAP hacim sıfırken sayı üretmiyor', () => {
    const c = mumlar([10, 11, 12], [0, 0, 0]);
    expect(Number.isNaN(vwapArr(c, 3)[2])).toBe(true);
  });

  it('VWAP ağırlığı gerçekten uyguluyor', () => {
    const c = mumlar([10, 20], [1, 99]);
    const tp = tipikFiyat(c);
    const beklenen = (tp[0] * 1 + tp[1] * 99) / 100;
    expect(vwapArr(c, 2)[1]).toBeCloseTo(beklenen, 10);
  });
});

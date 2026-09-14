import { describe, expect, it } from 'vitest';
import { computeStats } from './stats';
import { DAY_SECONDS } from '../data/pack';
import { emptyCandles, type Candles } from '../data/types';

/**
 * Eski uygulamanın özet kartlarını besleyen fonksiyon; hiç testi yoktu.
 * Pencereler TAKVİM günü tabanlı (Sembol Masası'yla aynı yaklaşım), bu yüzden
 * testler de tarih üzerinden kuruluyor.
 */
function series(values: number[], startDay = 20000): Candles {
  const c = emptyCandles(values.length);
  values.forEach((v, i) => {
    c.time[i] = (startDay + i) * DAY_SECONDS;
    c.open[i] = v;
    c.close[i] = v;
    c.high[i] = v * 1.02;
    c.low[i] = v * 0.98;
    c.volume[i] = 100 + i;
  });
  return c;
}

describe('computeStats', () => {
  it('veri yoksa sayı uydurmaz', () => {
    expect(computeStats(null)).toBeNull();
    expect(computeStats(emptyCandles(0))).toBeNull();
  });

  it('52 hafta uç değerleri son bir yılın bar içi uçlarından gelir', () => {
    // 500 günlük seri: ilk 100 gün 1 yıllık pencerenin DIŞINDA kalır.
    const values = Array.from({ length: 500 }, (_, i) => (i < 100 ? 500 : 100 + i));
    const s = computeStats(series(values))!;
    // Pencere dışındaki 500'lük zirve hi52'ye girmemeli.
    expect(s.hi52).toBeLessThan(700);
    expect(s.hi52).toBeCloseTo(599 * 1.02, 5);
    expect(s.lo52).toBeGreaterThan(100);
  });

  it('CAGR ve maks. düşüş TÜM geçmiş üzerinden', () => {
    // 2 yılda 100 → 121: yıllık bileşik %10.
    const days = Math.round(2 * 365.25);
    const values = Array.from({ length: days + 1 }, (_, i) => 100 * Math.pow(1.21, i / days));
    const s = computeStats(series(values))!;
    expect(s.cagr).toBeCloseTo(10, 1);
    expect(s.years).toBeCloseTo(2, 2);
    expect(s.maxDD).toBeCloseTo(0, 6); // kesintisiz yükseliş
  });

  it('düşüşü tepe-dip olarak ölçer', () => {
    const s = computeStats(series([100, 200, 100, 150]))!;
    expect(s.maxDD).toBeCloseTo(50, 6);
  });

  it('ortalama hacim son 20 bardan', () => {
    const s = computeStats(series(Array.from({ length: 50 }, () => 10)))!;
    // volume = 100 + i, son 20 bar: i = 30..49 → ortalama 100 + 39.5
    expect(s.avgVol).toBeCloseTo(139.5, 6);
  });

  it('dönem getirileri takvim penceresinden okunur', () => {
    const values = Array.from({ length: 400 }, (_, i) => 100 + i);
    const s = computeStats(series(values))!;
    const last = values[399];
    // 30 takvim günü önce: aynı indeks hesabı (bar = gün olduğu için).
    expect(s.r1m).toBeCloseTo((last / values[369] - 1) * 100, 6);
    expect(s.r1y).toBeCloseTo((last / values[34] - 1) * 100, 6);
  });
});

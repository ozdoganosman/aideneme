import { describe, expect, it } from 'vitest';
import { emptyCandles, type Candles } from '../data/types';
import { classifyRegimes, regimeBreakdown, regimeVerdict, REGIME_CAVEAT } from './regime';

/**
 * Belirli bir bardan sonra oynaklığı ARTAN seri: ilk yarı sakin, ikinci yarı
 * geniş bar aralıklı. Rejim sınıflandırması bu kırılmayı görmeli.
 */
function series(n: number, breakAt: number): Candles {
  const c = emptyCandles(n);
  let price = 100;
  for (let i = 0; i < n; i++) {
    const wide = i >= breakAt;
    const step = wide ? 4 : 0.4;
    price += i % 2 === 0 ? step : -step * 0.9;
    c.time[i] = (19000 + i) * 86400;
    c.open[i] = price;
    c.close[i] = price;
    c.high[i] = price + (wide ? 6 : 0.5);
    c.low[i] = price - (wide ? 6 : 0.5);
    c.volume[i] = 1000;
  }
  return c;
}

describe('Rejim sınıflandırması', () => {
  it('geçmiş yetmeden rejim ATAMAZ', () => {
    const r = classifyRegimes(series(400, 300), { minHistory: 60 });
    // İlk barlarda eşik yok: bilinmiyor (-1).
    expect(r.vol[0]).toBe(-1);
    expect(r.vol[40]).toBe(-1);
    expect(Number.isNaN(r.threshold[10])).toBe(true);
  });

  it('oynaklık kırılmasını yakalar', () => {
    const r = classifyRegimes(series(500, 300), { minHistory: 60, lookback: 200 });
    expect(r.vol[280]).toBe(0); // sakin dönem
    expect(r.vol[340]).toBe(1); // geniş barlar
  });

  it('eşik yalnızca GEÇMİŞTEN kurulur (bugünkü bar dahil değil)', () => {
    // Tek bir barın kendisi eşiğe girseydi, o bar kendi medyanını yukarı
    // çekip "yüksek" olmaktan kurtulabilirdi.
    const c = series(400, 399);
    const r = classifyRegimes(c, { minHistory: 60, lookback: 100 });
    const i = 399;
    expect(r.atrPct[i]).toBeGreaterThan(r.threshold[i]);
    expect(r.vol[i]).toBe(1);
  });
});

describe('Rejim kırılımı', () => {
  const regimes = classifyRegimes(series(500, 300), { minHistory: 60, lookback: 200 });

  it('rejimi bilinmeyen işlemi gizlemez', () => {
    const b = regimeBreakdown([{ entryIndex: 5, netPct: 3 }], regimes);
    expect(b.unknown).toBe(1);
    expect(b.buckets.every((x) => x.trades === 0)).toBe(true);
  });

  it('örnek yetmiyorsa sayı ÜRETMEZ', () => {
    const trades = [
      { entryIndex: 280, netPct: 1 },
      { entryIndex: 281, netPct: 2 },
    ];
    const b = regimeBreakdown(trades, regimes, 5);
    const bucket = b.buckets.find((x) => x.trades === 2)!;
    expect(bucket.enough).toBe(false);
    expect(Number.isNaN(bucket.medianPct)).toBe(true);
    expect(Number.isNaN(bucket.winRatePct)).toBe(true);
  });

  it('yeterli işlemde medyan, ortalama ve isabet oranını verir', () => {
    const trades = Array.from({ length: 6 }, (_, i) => ({
      entryIndex: 270 + i,
      netPct: [3, -1, 5, 2, -2, 4][i],
    }));
    const b = regimeBreakdown(trades, regimes, 5);
    const bucket = b.buckets.find((x) => x.trades === 6)!;
    expect(bucket.enough).toBe(true);
    expect(bucket.medianPct).toBeCloseTo(2.5, 5);
    expect(bucket.meanPct).toBeCloseTo(11 / 6, 5);
    expect(bucket.winRatePct).toBeCloseTo((4 / 6) * 100, 5);
  });

  it('bar payları sınıflandırılmış barlar üzerinden toplam %100', () => {
    const b = regimeBreakdown([], regimes);
    const total = b.buckets.reduce((a, x) => a + x.barsPct, 0);
    expect(total).toBeCloseTo(100, 6);
  });
});

describe('Rejim hükmü', () => {
  it('iki rejim ölçülemediyse hüküm vermez', () => {
    const regimes = classifyRegimes(series(400, 300), { minHistory: 60 });
    const b = regimeBreakdown([{ entryIndex: 280, netPct: 1 }], regimes);
    expect(regimeVerdict(b)).toMatch(/yeterli işlem yok/);
  });

  it('kırılımın strateji olmadığını söyleyen uyarı kaldırılamaz', () => {
    expect(REGIME_CAVEAT).toMatch(/aynı veriye ikinci kez/);
  });
});

import { describe, expect, it } from 'vitest';
import { detectSR, detectFormations } from './patterns';
import { DAY_SECONDS } from '../data/pack';
import { emptyCandles, type Candles } from '../data/types';

/**
 * Bu iki fonksiyon eski uygulamadan devralındı ve HİÇ testi yoktu (kapsam %0).
 * Grafikte çizgi çizdikleri için sessiz bir hata "ekranda bir şey görünmüyor"
 * diye fark edilmeden kalır. Testler kurgu serilerle: şekil biliniyor, cevap
 * da biliniyor.
 */

/** Verilen dönüm noktalarından, aralarını doğrusal dolduran seri kurar. */
function fromPivots(prices: number[], gap = 14): Candles {
  const n = (prices.length - 1) * gap + 1;
  const c = emptyCandles(n);
  for (let seg = 0; seg < prices.length - 1; seg++) {
    const from = prices[seg];
    const to = prices[seg + 1];
    for (let k = 0; k < gap; k++) {
      const i = seg * gap + k;
      const v = from + ((to - from) * k) / gap;
      c.time[i] = (20000 + i) * DAY_SECONDS;
      c.open[i] = v;
      c.close[i] = v;
      c.high[i] = v;
      c.low[i] = v;
      c.volume[i] = 1000;
    }
  }
  const i = n - 1;
  const v = prices[prices.length - 1];
  c.time[i] = (20000 + i) * DAY_SECONDS;
  c.open[i] = c.close[i] = c.high[i] = c.low[i] = v;
  c.volume[i] = 1000;
  return c;
}

describe('detectSR', () => {
  it('aynı seviyeye yapılan dokunuşları tek seviyede toplar', () => {
    // 100 → 120 → 100 → 120 → 100: 120 iki kez tepe, 100 iki kez dip.
    const c = fromPivots([100, 120, 100, 120, 100, 120, 100]);
    const levels = detectSR(c, 400, 5, 6);
    expect(levels.length).toBeGreaterThan(0);
    const top = levels.find((l) => Math.abs(l.price - 120) < 1);
    expect(top?.touches).toBeGreaterThanOrEqual(2);
  });

  it('tek dokunuş seviye SAYILMAZ', () => {
    // Tek tepe: iki dokunuşu olmayan küme eleniyor.
    const c = fromPivots([100, 130, 100]);
    expect(detectSR(c, 400, 5, 6)).toEqual([]);
  });

  it('çok kısa seride hiçbir şey uydurmaz', () => {
    const c = fromPivots([100, 101], 2);
    expect(detectSR(c, 400, 5, 6)).toEqual([]);
  });
});

describe('detectFormations', () => {
  it('omuz-baş-omuz şeklini bulur ve yönünü düşüş verir', () => {
    // omuz 110 · baş 130 · omuz 110, boyun ~100.
    const c = fromPivots([90, 110, 100, 130, 100, 110, 95]);
    const found = detectFormations(c, 6, 340);
    expect(found[0]?.kind).toBe('obo');
    expect(found[0]?.dir).toBe('bear');
  });

  it('ters omuz-baş-omuzu OBO ile karıştırmaz', () => {
    const c = fromPivots([110, 90, 100, 70, 100, 90, 105]);
    const found = detectFormations(c, 6, 340);
    expect(found[0]?.kind).toBe('tobo');
    expect(found[0]?.dir).toBe('bull');
  });

  it('düz seride formasyon UYDURMAZ', () => {
    const c = fromPivots([100, 100, 100, 100, 100, 100, 100]);
    expect(detectFormations(c, 6, 340)).toEqual([]);
  });

  it('yeterli dönüm noktası yoksa boş döner', () => {
    const c = fromPivots([100, 120], 20);
    expect(detectFormations(c, 6, 340)).toEqual([]);
  });
});

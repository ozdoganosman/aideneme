import { describe, expect, it } from 'vitest';
import { emptyCandles, type Candles } from '../data/types';
import { rollingVol, tripleBarrier } from './labels';

/** Verilen kapanışlardan bar üretir; yüksek/düşük varsayılan olarak kapanıştır. */
function make(close: number[], high?: number[], low?: number[]): Candles {
  const c = emptyCandles(close.length);
  for (let i = 0; i < close.length; i++) {
    c.time[i] = (19723 + i) * 86400;
    c.open[i] = close[i];
    c.high[i] = high ? high[i] : close[i];
    c.low[i] = low ? low[i] : close[i];
    c.close[i] = close[i];
    c.volume[i] = 1000;
  }
  return c;
}

/** Küçük dalgalanmalı taban seri: oynaklık sıfır olmasın diye. */
function wobble(n: number, step = 0.002): number[] {
  const out: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p *= 1 + (i % 2 === 0 ? step : -step);
    out.push(p);
  }
  return out;
}

describe('üçlü bariyer', () => {
  it('son bar penceresini etiketlemez — sonucu henüz görülmedi', () => {
    const candles = make(wobble(60));
    const labels = tripleBarrier(candles, {
      horizon: 10,
      upMult: 1.5,
      downMult: 1.5,
      volLength: 20,
    });
    const last = labels.index[labels.index.length - 1];
    expect(last).toBeLessThanOrEqual(60 - 10 - 1);
    // İlk etiket de oynaklık ısınmasından önce olamaz.
    expect(labels.index[0]).toBeGreaterThanOrEqual(20);
  });

  it('üst bariyere değen örneği 1, alt bariyere değeni 0 etiketler', () => {
    const base = wobble(40);
    const up = [...base];
    for (let i = 40; i < 50; i++) up.push(up[i - 1] * 1.05); // güçlü yükseliş
    const upLabels = tripleBarrier(make(up), {
      horizon: 5,
      upMult: 1,
      downMult: 1,
      volLength: 20,
    });
    const atUp = upLabels.index.indexOf(39);
    expect(upLabels.y[atUp]).toBe(1);
    expect(upLabels.hit[atUp]).toBe('up');

    const down = [...base];
    for (let i = 40; i < 50; i++) down.push(down[i - 1] * 0.95);
    const downLabels = tripleBarrier(make(down), {
      horizon: 5,
      upMult: 1,
      downMult: 1,
      volLength: 20,
    });
    const atDown = downLabels.index.indexOf(39);
    expect(downLabels.y[atDown]).toBe(0);
    expect(downLabels.hit[atDown]).toBe('down');
  });

  it('aynı barda iki bariyere de değilirse kötümser davranır (alt bariyer kazanır)', () => {
    // 40. bardan sonra tek bar hem çok yüksek hem çok düşük: gün içi sıra bilinmiyor.
    const close = wobble(50);
    const high = close.map((v) => v);
    const low = close.map((v) => v);
    high[41] = close[40] * 1.5;
    low[41] = close[40] * 0.5;
    const labels = tripleBarrier(make(close, high, low), {
      horizon: 5,
      upMult: 1,
      downMult: 1,
      volLength: 20,
    });
    const at = labels.index.indexOf(40);
    expect(labels.hit[at]).toBe('down');
    expect(labels.y[at]).toBe(0);
  });

  it('zaman bariyerinde getirinin işaretine bakar ve touchedAt ufku aşmaz', () => {
    const close = wobble(60, 0.0005); // bariyerlere değmeyecek kadar sakin
    const labels = tripleBarrier(make(close), {
      horizon: 8,
      upMult: 5,
      downMult: 5,
      volLength: 20,
    });
    for (let s = 0; s < labels.index.length; s++) {
      expect(labels.hit[s]).toBe('time');
      expect(labels.touchedAt[s] - labels.index[s]).toBe(8);
      const entry = close[labels.index[s]];
      const exit = close[labels.touchedAt[s]];
      expect(labels.y[s]).toBe(exit > entry ? 1 : 0);
    }
  });

  it('oynaklık penceresi dolmadan değer üretmez', () => {
    const close = Float64Array.from(wobble(30));
    const vol = rollingVol(close, 20);
    expect(Number.isFinite(vol[19])).toBe(false);
    expect(vol[25]).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { annualizedVolatility, cagr, drawdown, realCagr, summarize } from './summary';
import { DAY_SECONDS } from '../data/pack';
import { emptyCandles, type Candles } from '../data/types';

/** Sabit günlük büyüme oranıyla seri (volatilite sıfır, CAGR analitik). */
function geometric(n: number, start: number, dailyRate: number, startDay = 18262): Candles {
  const c = emptyCandles(n);
  let price = start;
  for (let i = 0; i < n; i++) {
    c.time[i] = (startDay + i) * DAY_SECONDS;
    c.open[i] = price;
    c.high[i] = price;
    c.low[i] = price;
    c.close[i] = price;
    c.volume[i] = 1000;
    price *= 1 + dailyRate;
  }
  return c;
}

describe('cagr', () => {
  it('bilinen büyümeyi doğru yıllıklandırır', () => {
    // 365 günde tam 2 katına çıkan seri → ~%100 CAGR.
    const days = 366;
    const rate = Math.pow(2, 1 / (days - 1)) - 1;
    const c = geometric(days, 100, rate);
    expect(c.close[days - 1] / c.close[0]).toBeCloseTo(2, 6);
    expect(cagr(c)).toBeGreaterThan(99);
    expect(cagr(c)).toBeLessThan(101);
  });

  it('düşen seride negatif', () => {
    expect(cagr(geometric(400, 100, -0.001))).toBeLessThan(0);
  });
});

describe('annualizedVolatility', () => {
  it('sabit oranlı seride ~0', () => {
    expect(annualizedVolatility(geometric(400, 100, 0.0005))).toBeCloseTo(0, 6);
  });

  it('daha oynak seri daha yüksek volatilite verir', () => {
    const make = (amp: number) => {
      const c = geometric(400, 100, 0);
      for (let i = 0; i < c.length; i++) {
        const wiggle = 1 + (i % 2 === 0 ? amp : -amp);
        c.close[i] = 100 * wiggle;
      }
      return c;
    };
    expect(annualizedVolatility(make(0.05))).toBeGreaterThan(annualizedVolatility(make(0.01)));
  });

  it('yetersiz veride NaN', () => {
    expect(Number.isNaN(annualizedVolatility(geometric(2, 100, 0.01)))).toBe(true);
  });
});

describe('drawdown', () => {
  it('tepe → dip düşüşünü ve güncel uzaklığı verir', () => {
    const c = emptyCandles(5);
    [100, 120, 60, 90, 90].forEach((v, i) => {
      c.time[i] = (18262 + i) * DAY_SECONDS;
      c.close[i] = v;
      c.open[i] = v;
      c.high[i] = v;
      c.low[i] = v;
    });
    const dd = drawdown(c);
    expect(dd.max).toBeCloseTo(50, 6); // 120 → 60
    expect(dd.current).toBeCloseTo(25, 6); // 120 → 90
  });
});

describe('realCagr', () => {
  it('enflasyonun altındaki nominal getiri reelde negatiftir', () => {
    // 2022–2023 TL: yüksek enflasyon. Nominal %20/yıl → reel negatif olmalı.
    const start = Math.floor(Date.UTC(2022, 0, 3) / 1000 / DAY_SECONDS);
    const days = 500;
    const rate = Math.pow(1.2, 1 / 365) - 1;
    const c = geometric(days, 100, rate, start);
    expect(cagr(c)).toBeGreaterThan(15);
    expect(realCagr(c)).toBeLessThan(0);
  });
});

describe('summarize', () => {
  const c = geometric(800, 100, 0.0004);

  it('her metrik formülünü ve penceresini taşır', () => {
    for (const m of summarize(c)) {
      expect(m.formula.length).toBeGreaterThan(10);
      expect(m.window).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(m.bars).toBeGreaterThan(0);
    }
  });

  it('reel getiri yalnızca istendiğinde eklenir', () => {
    expect(summarize(c).some((m) => m.key === 'real')).toBe(false);
    expect(summarize(c, { realReturn: true }).some((m) => m.key === 'real')).toBe(true);
  });

  it('çok kısa seride boş döner (uydurma metrik üretmez)', () => {
    expect(summarize(emptyCandles(1))).toEqual([]);
  });

  it('düşüş metrikleri negatif işaretle sunulur', () => {
    const metrics = summarize(c);
    expect(metrics.find((m) => m.key === 'maxdd')!.value).toBeLessThanOrEqual(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCREEN_PARAMS,
  METRIC_DEFS,
  applyScreen,
  metricsFor,
  passes,
  type ScreenRow,
} from './metrics';
import { DAY_SECONDS } from '../data/pack';
import { emptyCandles, type Candles } from '../data/types';
import { summarize } from '../stats/summary';

function series(closes: number[], volumes?: number[]): Candles {
  const c = emptyCandles(closes.length);
  closes.forEach((v, i) => {
    c.time[i] = (20000 + i) * DAY_SECONDS;
    c.open[i] = v;
    c.high[i] = v * 1.01;
    c.low[i] = v * 0.99;
    c.close[i] = v;
    c.volume[i] = volumes?.[i] ?? 1000;
  });
  return c;
}

const rising = series(Array.from({ length: 300 }, (_, i) => 100 * 1.002 ** i));

describe('metricsFor', () => {
  it('yükselen seride beklenen işaretleri üretir', () => {
    const row = metricsFor('AAA', rising)!;
    expect(row.symbol).toBe('AAA');
    expect(row.bars).toBe(300);
    expect(row.values.chg1).toBeGreaterThan(0);
    expect(row.values.chg21).toBeGreaterThan(row.values.chg5);
    expect(row.values.rsi).toBeGreaterThan(70);
    expect(row.values.emaFastGap).toBeGreaterThan(0);
    // Seride her barın yükseği kapanışın %1 üstünde; zirvedeyken "zirveden"
    // metriği bu yüzden ≈ −%0,99 olur (kapanış ÷ en yüksek HIGH).
    expect(row.values.fromHigh).toBeGreaterThan(-1.1);
    expect(row.values.fromHigh).toBeLessThan(-0.9);
  });

  it('hacim oranı son barı ortalamayla kıyaslar', () => {
    const volumes = Array.from({ length: 300 }, (_, i) => (i === 299 ? 5000 : 1000));
    const row = metricsFor('AAA', series(Array.from(rising.close), volumes))!;
    expect(row.values.volRatio).toBeGreaterThan(3);
  });

  it('çok kısa seride null döner', () => {
    expect(metricsFor('AAA', emptyCandles(1))).toBeNull();
  });

  it('ısınmaya yetmeyen seride metrik NaN kalır (uydurmaz)', () => {
    const row = metricsFor('AAA', series([10, 11, 12, 13, 14]))!;
    expect(Number.isNaN(row.values.rsi)).toBe(true);
    expect(Number.isNaN(row.values.chg63)).toBe(true);
    expect(Number.isFinite(row.values.chg1)).toBe(true);
  });

  it('her metriğin tanımı ve formülü var (provenance eksiksiz)', () => {
    const row = metricsFor('AAA', rising)!;
    for (const def of METRIC_DEFS) {
      expect(row.values).toHaveProperty(def.id);
      expect(def.formula(DEFAULT_SCREEN_PARAMS).length).toBeGreaterThan(5);
    }
    expect(Object.keys(row.values).sort()).toEqual(METRIC_DEFS.map((d) => d.id).sort());
  });

  it('parametre değişince sonuç değişir (canlı parametre gerçekten canlı)', () => {
    // Kesintisiz yükselen seride RSI her uzunlukta 100'dür; fark görmek için
    // yön değiştiren bir seri gerekiyor.
    const noisy = series(
      Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 3) * 8 + i * 0.05),
    );
    const a = metricsFor('AAA', noisy, { ...DEFAULT_SCREEN_PARAMS, rsiLength: 2 })!;
    const b = metricsFor('AAA', noisy, { ...DEFAULT_SCREEN_PARAMS, rsiLength: 50 })!;
    expect(Math.abs(a.values.rsi - b.values.rsi)).toBeGreaterThan(1);
  });
});

describe('passes', () => {
  const row: ScreenRow = {
    symbol: 'X',
    bars: 300,
    values: {
      last: 10,
      chg1: 2,
      chg5: 5,
      chg21: -3,
      chg63: 8,
      rsi: 65,
      adx: 30,
      emaFastGap: 1.5,
      emaSlowGap: 4,
      volRatio: 2,
      atrPct: 3,
      fromHigh: -5,
    },
  };

  it('gt/lt/between kurallarını uygular', () => {
    expect(passes(row, [{ metric: 'rsi', op: 'gt', a: 60 }])).toBe(true);
    expect(passes(row, [{ metric: 'rsi', op: 'gt', a: 70 }])).toBe(false);
    expect(passes(row, [{ metric: 'chg21', op: 'lt', a: 0 }])).toBe(true);
    expect(passes(row, [{ metric: 'adx', op: 'between', a: 20, b: 40 }])).toBe(true);
    expect(passes(row, [{ metric: 'adx', op: 'between', a: 40, b: 20 }])).toBe(true); // sınırlar ters verilse de
    expect(passes(row, [{ metric: 'adx', op: 'between', a: 5, b: 15 }])).toBe(false);
  });

  it('kurallar VE ile birleşir', () => {
    expect(
      passes(row, [
        { metric: 'rsi', op: 'gt', a: 60 },
        { metric: 'volRatio', op: 'gt', a: 5 },
      ]),
    ).toBe(false);
  });

  it('NaN metrik hiçbir kuralı geçemez', () => {
    const nan = { ...row, values: { ...row.values, rsi: NaN } };
    expect(passes(nan, [{ metric: 'rsi', op: 'gt', a: 0 }])).toBe(false);
    expect(passes(nan, [{ metric: 'rsi', op: 'lt', a: 1e9 }])).toBe(false);
  });
});

describe('applyScreen', () => {
  const rows: ScreenRow[] = [10, 30, 20, NaN].map((rsi, i) => ({
    symbol: `S${i}`,
    bars: i === 3 ? 5 : 300,
    values: { ...({} as ScreenRow['values']), rsi },
  }));

  it('sıralar ve NaN’ı sona atar', () => {
    const out = applyScreen(rows, { rules: [], sort: { metric: 'rsi', dir: 'desc' } });
    expect(out.map((r) => r.symbol)).toEqual(['S1', 'S2', 'S0', 'S3']);
  });

  it('minBars ile az veriliyi eler', () => {
    const out = applyScreen(rows, { rules: [], minBars: 100 });
    expect(out.map((r) => r.symbol)).not.toContain('S3');
  });

  it('girdi dizisini değiştirmez', () => {
    const before = rows.map((r) => r.symbol);
    applyScreen(rows, { rules: [], sort: { metric: 'rsi', dir: 'asc' } });
    expect(rows.map((r) => r.symbol)).toEqual(before);
  });
});

describe('sektör filtresi', () => {
  const rows: ScreenRow[] = [
    { symbol: 'GARAN', bars: 250, values: { rsi: 50 }, sector: 'Bankacılık' },
    { symbol: 'AKBNK', bars: 250, values: { rsi: 60 }, sector: 'Bankacılık' },
    { symbol: 'EREGL', bars: 250, values: { rsi: 55 }, sector: 'Demir Çelik' },
    { symbol: 'XXXXX', bars: 250, values: { rsi: 52 } },
  ];

  it('seçili sektörlere göre eler', () => {
    const out = applyScreen(rows, { rules: [], sectors: ['Bankacılık'] });
    expect(out.map((r) => r.symbol)).toEqual(['GARAN', 'AKBNK']);
  });

  it('birden çok sektör seçilebilir', () => {
    const out = applyScreen(rows, { rules: [], sectors: ['Bankacılık', 'Demir Çelik'] });
    expect(out).toHaveLength(3);
  });

  it('sektörü bilinmeyen sembol seçili sektöre ait sayılmaz', () => {
    const out = applyScreen(rows, { rules: [], sectors: ['Bankacılık'] });
    expect(out.find((r) => r.symbol === 'XXXXX')).toBeUndefined();
  });

  it('boş liste sektöre göre elemez', () => {
    expect(applyScreen(rows, { rules: [], sectors: [] })).toHaveLength(4);
    expect(applyScreen(rows, { rules: [] })).toHaveLength(4);
  });

  it('sektör filtresi sayısal kurallarla birlikte çalışır', () => {
    const out = applyScreen(rows, {
      rules: [{ metric: 'rsi', op: 'gt', a: 55 }],
      sectors: ['Bankacılık'],
    });
    expect(out.map((r) => r.symbol)).toEqual(['AKBNK']);
  });
});

describe('Ekranlar arası tutarlılık', () => {
  it('1 aylık getiri Sembol Masası ile AYNI sayıyı verir', () => {
    // Aynı ada sahip iki metriğin iki ekranda iki farklı sayı göstermesi,
    // kullanıcının hangisine güveneceğini bilememesi demekti (gerçek kusurdu:
    // tarayıcı 21 BAR, masa 30 GÜN geriye bakıyordu).
    const row = metricsFor('AAA', rising)!;
    const masa = summarize(rising).find((m) => m.key === 'r1m')!;
    expect(row.values.chg21).toBeCloseTo(masa.value, 10);
  });

  it('1 yıllık pencere gibi kapsanmayan dönemde sayı ÜRETMEZ', () => {
    // 20 barlık seri 30 günü kapsamaz: daha dar bir pencereyi "1 aylık getiri"
    // diye sunmak, farklı şeyleri yan yana sıralamak olurdu.
    const kisa = series(Array.from({ length: 20 }, (_, i) => 100 + i));
    const row = metricsFor('BBB', kisa)!;
    expect(Number.isNaN(row.values.chg21)).toBe(true);
    expect(Number.isNaN(row.values.chg63)).toBe(true);
    // 7 günlük pencere kapsanıyor.
    expect(Number.isFinite(row.values.chg5)).toBe(true);
  });
});

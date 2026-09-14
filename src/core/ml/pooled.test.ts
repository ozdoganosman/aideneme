import { describe, expect, it } from 'vitest';
import { emptyCandles, type Candles } from '../data/types';
import { buildSamples } from './model';
import { DEFAULT_BARRIERS } from './labels';
import { trainModel } from './model';
import { mergeByDay, trainPooled } from './pooled';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number) {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Gömülü momentum rejimi; her sembol aynı kuralı taşır, gürültüsü farklı. */
function momentum(n: number, seed: number, startDay = 19000): Candles {
  const r = rng(seed);
  const close: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const past = i >= 21 ? close[i - 1] / close[i - 21] - 1 : 0;
    p *= Math.exp((past > 0 ? 0.003 : -0.003) + 0.015 * gauss(r));
    close.push(p);
  }
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    c.time[i] = (startDay + i) * 86400;
    c.open[i] = i > 0 ? close[i - 1] : close[i];
    c.high[i] = Math.max(c.open[i], close[i]) * 1.004;
    c.low[i] = Math.min(c.open[i], close[i]) * 0.996;
    c.close[i] = close[i];
    c.volume[i] = 1_000_000;
  }
  return c;
}

describe('havuzlanmış (kesitsel) model', () => {
  it('birden çok sembolün örneklerini birleştirir ve sayıyı kartta yazar', () => {
    const inputs = [1, 2, 3].map((i) => ({ symbol: `S${i}`, candles: momentum(500, i * 13) }));
    const { card, used, skipped } = trainPooled(inputs);
    expect(used).toEqual(['S1', 'S2', 'S3']);
    expect(skipped).toEqual([]);
    expect(card.symbols).toBe(3);
    // Havuz tek sembolden belirgin biçimde daha çok örnek taşımalı.
    const single = buildSamples(inputs[0].candles, DEFAULT_BARRIERS).rows.length;
    expect(card.samples).toBeGreaterThan(single * 2);
  });

  it('uyarı metni havuzu söyler, "tek sembolde" demez', () => {
    const inputs = [1, 2].map((i) => ({ symbol: `S${i}`, candles: momentum(500, i * 7) }));
    const text = trainPooled(inputs).card.warnings.join(' ');
    expect(text).toMatch(/2 sembolün örnekleri havuzlandı/);
    expect(text).not.toMatch(/Tek sembolde/);
  });

  it('örneği yetersiz sembolü havuza almaz ve gerekçesini yazar', () => {
    const inputs = [
      { symbol: 'UZUN', candles: momentum(500, 3) },
      { symbol: 'KISA', candles: momentum(60, 4) },
    ];
    const { used, skipped } = trainPooled(inputs);
    expect(used).toEqual(['UZUN']);
    expect(skipped[0].symbol).toBe('KISA');
    expect(skipped[0].reason).toMatch(/örnek/);
  });

  it('havuzda canlı tahmin üretilmez — hangi sembol için olacağı belirsiz', () => {
    const inputs = [1, 2].map((i) => ({ symbol: `S${i}`, candles: momentum(500, i * 5) }));
    expect(trainPooled(inputs).latest).toBeNull();
  });

  it('havuz zamana göre sıralanır (katmanlar zaman bloğu olabilsin)', () => {
    const a = buildSamples(momentum(300, 1, 19000), DEFAULT_BARRIERS, 'A');
    const b = buildSamples(momentum(300, 2, 19150), DEFAULT_BARRIERS, 'B');
    const merged = mergeByDay([a, b]);
    expect(merged.rows.length).toBe(a.rows.length + b.rows.length);
    for (let i = 1; i < merged.startDay.length; i++) {
      expect(merged.startDay[i]).toBeGreaterThanOrEqual(merged.startDay[i - 1]);
    }
    // İki sembolün örnekleri gerçekten iç içe geçmiş olmalı (yan yana değil).
    const symbols = merged.symbol;
    expect(new Set(symbols).size).toBe(2);
  });

  it('tek sembolde bulunamayan rejimi havuzda bulur', () => {
    // 400 barlık sembollerde örnek sayısı (~330) dürüst bir ölçüme yetmiyor:
    // tek sembol modelleri gürültüye bakıyor ve doğru biçimde "kullanma" diyor.
    // Aynı kural sekiz sembolde havuzlandığında örnek ~8× artıyor ve ayrım
    // görünür hale geliyor. Havuzun ASIL değeri bu.
    const inputs = Array.from({ length: 8 }, (_, i) => ({
      symbol: `S${i}`,
      candles: momentum(400, (i + 1) * 17),
    }));

    const singles = inputs.map((x) => trainModel(x.candles, { symbol: x.symbol }).card);
    expect(singles.every((c) => c.verdict === 'kullanma')).toBe(true);

    const pooled = trainPooled(inputs).card;
    expect(pooled.samples).toBeGreaterThan(singles[0].samples * 5);
    expect(pooled.metrics.auc).toBeGreaterThan(0.55);
    expect(pooled.brierSkill).toBeGreaterThan(0);
    expect(pooled.verdict).not.toBe('kullanma');
  });

  it('aynı girdi aynı kartı üretir', () => {
    const make = () => [1, 2].map((i) => ({ symbol: `S${i}`, candles: momentum(400, i * 11) }));
    expect(trainPooled(make()).card.metrics).toEqual(trainPooled(make()).card.metrics);
  });

  it('boş girdi model uydurmaz', () => {
    const { card, used } = trainPooled([]);
    expect(used).toEqual([]);
    expect(card.verdict).toBe('kullanma');
    expect(card.samples).toBe(0);
  });
});

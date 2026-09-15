import { describe, expect, it } from 'vitest';
import { emptyCandles, type Candles } from '../data/types';
import { trainModel } from './model';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(random: () => number): number {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function fromCloses(close: number[]): Candles {
  const c = emptyCandles(close.length);
  for (let i = 0; i < close.length; i++) {
    c.time[i] = (19000 + i) * 86400;
    c.open[i] = i > 0 ? close[i - 1] : close[i];
    c.high[i] = Math.max(c.open[i], close[i]) * 1.004;
    c.low[i] = Math.min(c.open[i], close[i]) * 0.996;
    c.close[i] = close[i];
    c.volume[i] = 1_000_000 * (0.8 + (i % 7) / 10);
  }
  return c;
}

/** Saf rastgele yürüyüş: içinde öğrenilecek hiçbir şey YOKTUR. */
function randomWalk(n: number, seed = 7): Candles {
  const random = rng(seed);
  const close: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p *= Math.exp(0.012 * gauss(random));
    close.push(p);
  }
  return fromCloses(close);
}

/**
 * Momentum kuralı GERÇEKTEN gömülü bir seri: son 20 barın getirisi pozitifse
 * sonraki barların sürüklenmesi yukarı. Model bunu bulabilmeli.
 */
function momentumRegime(n: number, seed = 11, drift = 0.003, vol = 0.015): Candles {
  const random = rng(seed);
  const close: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const past = i >= 21 ? close[i - 1] / close[i - 21] - 1 : 0;
    p *= Math.exp((past > 0 ? drift : -drift) + vol * gauss(random));
    close.push(p);
  }
  return fromCloses(close);
}

describe('model kartı', () => {
  it('rastgele yürüyüşte "kullanma" der ve tahmin üretmez', () => {
    const { card, latest } = trainModel(randomWalk(900), { symbol: 'RND' });
    expect(card.samples).toBeGreaterThan(500);
    // Rastgele seride AUC 0.5 civarında olmalı; "kullanılabilir" demek yalan olur.
    expect(card.metrics.auc).toBeLessThan(0.6);
    if (card.verdict === 'kullanma') expect(latest).toBeNull();
  });

  it('gömülü momentum rejimini bulur ve ayrımı taban modeli yener', () => {
    const { card } = trainModel(momentumRegime(1400), { symbol: 'MOM' });
    expect(card.metrics.auc).toBeGreaterThan(0.55);
    expect(card.brierSkill).toBeGreaterThan(0);
    expect(card.metrics.brier).toBeLessThan(card.baseline.brier);
    expect(card.verdict).not.toBe('kullanma');
    // Momentum özelliğinin katsayısı pozitif ve katmanlar arası tutarlı olmalı.
    const mom = card.features.find((f) => f.key === 'mom');
    expect(mom?.weight).toBeGreaterThan(0);
    expect(mom?.stable).toBe(true);
  });

  it('sınıf dengesizse yüksek doğruluğa kanmaz, beceri skoruna bakar', () => {
    // Güçlü yukarı sürüklenme: üst bariyer neredeyse her zaman önce vuruluyor,
    // pozitif oranı %80'in üstünde. Doğruluk %75'in üstünde çıkar ama bu, "hep
    // yükselecek de" demenin doğruluğudur — beceri değil.
    const { card } = trainModel(momentumRegime(1400, 11, 0.006, 0.01));
    expect(card.positiveRate).toBeGreaterThan(0.75);
    expect(card.metrics.accuracy).toBeGreaterThan(0.7);
    expect(card.brierSkill).toBeLessThan(0);
    expect(card.verdict).toBe('kullanma');
    expect(card.warnings.join(' ')).toMatch(/Sınıflar dengesiz/);
    expect(card.warnings.join(' ')).toMatch(/Brier beceri skoru/);
  });

  it('örnek azsa model eğitmez, gerekçesini yazar', () => {
    const { card, latest } = trainModel(randomWalk(120), { symbol: 'KISA' });
    expect(card.verdict).toBe('kullanma');
    expect(card.folds).toBe(0);
    expect(latest).toBeNull();
    expect(card.warnings.join(' ')).toMatch(/en az 200/);
  });

  it('tüm ölçümler katman-dışı tahminlerden gelir; sızıntı temizliği sayılır', () => {
    const { card } = trainModel(momentumRegime(1200), { folds: 5, embargoDays: 14 });
    expect(card.folds).toBeGreaterThan(1);
    // Etiketler 10 bar sürdüğü için her katmanda atılan örnek olmalı.
    expect(card.purged).toBeGreaterThan(0);
    expect(card.embargoDays).toBe(14);
  });

  it('kart her zaman sınırlarını yazar ve kalibrasyon kovalarını taşır', () => {
    const { card } = trainModel(momentumRegime(1200));
    expect(card.calibration).toHaveLength(5);
    expect(card.warnings.join(' ')).toMatch(/işlem maliyeti/);
    expect(card.baseline.label).toMatch(/Taban oran/);
    const counted = card.calibration.reduce((a, b) => a + b.count, 0);
    expect(counted).toBeGreaterThan(0);
  });

  it('aynı veri aynı kartı üretir', () => {
    const a = trainModel(momentumRegime(900));
    const b = trainModel(momentumRegime(900));
    expect(a.card.metrics).toEqual(b.card.metrics);
    expect(a.latest?.probability).toBe(b.latest?.probability);
  });
});

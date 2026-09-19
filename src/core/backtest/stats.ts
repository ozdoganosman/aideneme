/**
 * Doğrulama katmanının ihtiyaç duyduğu istatistik yardımcıları.
 * Saf ve bağımlılıksız: normal dağılım fonksiyonları, çarpıklık/basıklık.
 */

/** Standart normal birikimli dağılım (Abramowitz–Stegun 7.1.26, ~1e-7 hata). */
export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/** Ters normal (Acklam yaklaşımı, ~1e-9 hata). */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [
    -39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472,
    2.50662827745924,
  ];
  const b = [
    -54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857,
  ];
  const c = [
    -0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373,
    4.37466414146497, 2.93816398269878,
  ];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

export interface Moments {
  mean: number;
  std: number;
  skewness: number;
  /** Fazla değil, ham basıklık (normal = 3). */
  kurtosis: number;
  count: number;
}

export function moments(values: ArrayLike<number>): Moments {
  const n = values.length;
  if (n < 2) return { mean: NaN, std: NaN, skewness: NaN, kurtosis: NaN, count: n };

  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n;

  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;

  const std = Math.sqrt(m2);
  return {
    mean,
    std,
    skewness: std > 0 ? m3 / std ** 3 : 0,
    kurtosis: std > 0 ? m4 / (m2 * m2) : 3,
    count: n,
  };
}

/** Euler–Mascheroni sabiti (beklenen maksimum Sharpe için). */
const EULER = 0.5772156649015329;

/**
 * N bağımsız denemede, gerçek yeteneği sıfır olan bir stratejiden beklenen
 * EN YÜKSEK Sharpe. "100 kombinasyon denedim, en iyisi 1,4 çıktı" ifadesinin
 * neden tek başına anlamsız olduğunu gösteren sayı.
 */
export function expectedMaxSharpe(trials: number, sharpeStd = 1): number {
  const n = Math.max(2, trials);
  return sharpeStd * ((1 - EULER) * normalInv(1 - 1 / n) + EULER * normalInv(1 - 1 / (n * Math.E)));
}

/**
 * Deflated Sharpe Ratio (Bailey & López de Prado).
 * Gözlenen Sharpe'ın, kaç kombinasyon denendiği ve getirilerin çarpıklık/
 * basıklığı hesaba katıldığında gerçek olma olasılığı.
 */
export function deflatedSharpe(params: {
  /** Bar başına Sharpe (yıllıklandırılmamış). */
  sharpePerBar: number;
  bars: number;
  skewness: number;
  kurtosis: number;
  /** Denenen bağımsız kombinasyon sayısı. */
  trials: number;
  /**
   * Denemeler arası Sharpe tahminlerinin standart sapması. Verilmezse Sharpe
   * tahmininin standart hatası kullanılır: sqrt((1 + SR²/2) / T).
   * ÖLÇEK KRİTİK: eşik, gözlenen Sharpe ile AYNI birimde (bar başına) olmalı;
   * birim uyuşmazlığı her stratejiyi "şansa bağlı" gösterirdi.
   */
  sharpeStd?: number;
}): { dsr: number; threshold: number } {
  const { sharpePerBar, bars, skewness, kurtosis, trials } = params;
  if (!(bars > 1) || !Number.isFinite(sharpePerBar)) return { dsr: NaN, threshold: NaN };

  const sharpeStd = params.sharpeStd ?? Math.sqrt((1 + (sharpePerBar * sharpePerBar) / 2) / bars);
  const threshold = expectedMaxSharpe(trials, sharpeStd);
  const denom = Math.sqrt(
    Math.max(1e-12, 1 - skewness * sharpePerBar + ((kurtosis - 1) / 4) * sharpePerBar ** 2),
  );
  const z = ((sharpePerBar - threshold) * Math.sqrt(bars - 1)) / denom;
  return { dsr: normalCdf(z), threshold };
}

/** Tekrarlanabilir sözde rastgele üreteç (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Yerinde Fisher–Yates karıştırma. */
export function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

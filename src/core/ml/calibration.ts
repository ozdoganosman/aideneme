/**
 * Olasılık kalitesi — "ne kadar doğru" değil, "ne kadar dürüst".
 *
 * Bir model %70 dediğinde uzun vadede gerçekten 100 vakanın ~70'i gerçekleşmeli.
 * Doğruluk (accuracy) bunu ölçmez; ayrım (AUC) da ölçmez. Kalibrasyon eğrisi ve
 * Brier skoru ölçer. Ürün ilkesi: kalibrasyonu gösterilmeyen olasılık ekrana
 * çıkmaz.
 */

export interface ReliabilityBin {
  /** Kova sınırları (olasılık). */
  from: number;
  to: number;
  count: number;
  /** Kovadaki ortalama tahmin. */
  predicted: number;
  /** Kovadaki gerçekleşme oranı. */
  observed: number;
}

export function brier(p: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = p.length;
  if (n === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (p[i] - y[i]) ** 2;
  return sum / n;
}

export function logLoss(p: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = p.length;
  if (n === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const c = Math.min(Math.max(p[i], 1e-12), 1 - 1e-12);
    sum += y[i] === 1 ? -Math.log(c) : -Math.log(1 - c);
  }
  return sum / n;
}

/** Mann–Whitney U üzerinden AUC; beraberliklere 0.5 pay verilir. */
export function auc(p: ArrayLike<number>, y: ArrayLike<number>): number {
  const pos: number[] = [];
  const neg: number[] = [];
  for (let i = 0; i < p.length; i++) (y[i] === 1 ? pos : neg).push(p[i]);
  if (pos.length === 0 || neg.length === 0) return NaN;

  const all = [...pos.map((v) => ({ v, pos: true })), ...neg.map((v) => ({ v, pos: false }))];
  all.sort((a, b) => a.v - b.v);

  // Ortalama sıra (tie) ataması.
  const ranks = new Float64Array(all.length);
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) ranks[t] = avg;
    i = j + 1;
  }

  let rankSumPos = 0;
  for (let t = 0; t < all.length; t++) if (all[t].pos) rankSumPos += ranks[t];
  const nPos = pos.length;
  const nNeg = neg.length;
  return (rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export function reliability(
  p: ArrayLike<number>,
  y: ArrayLike<number>,
  bins = 5,
): ReliabilityBin[] {
  const out: ReliabilityBin[] = [];
  for (let b = 0; b < bins; b++) {
    const from = b / bins;
    const to = (b + 1) / bins;
    let count = 0;
    let sumP = 0;
    let sumY = 0;
    for (let i = 0; i < p.length; i++) {
      const inBin = b === bins - 1 ? p[i] >= from && p[i] <= to : p[i] >= from && p[i] < to;
      if (!inBin) continue;
      count++;
      sumP += p[i];
      sumY += y[i];
    }
    out.push({
      from,
      to,
      count,
      predicted: count > 0 ? sumP / count : NaN,
      observed: count > 0 ? sumY / count : NaN,
    });
  }
  return out;
}

/**
 * Beklenen kalibrasyon hatası: kovaların |tahmin − gerçekleşme| farkının
 * örnek sayısıyla ağırlıklı ortalaması. 0 = kusursuz.
 */
export function expectedCalibrationError(binsOut: ReliabilityBin[]): number {
  let total = 0;
  let weighted = 0;
  for (const bin of binsOut) {
    if (bin.count === 0) continue;
    total += bin.count;
    weighted += bin.count * Math.abs(bin.predicted - bin.observed);
  }
  return total > 0 ? weighted / total : NaN;
}

/**
 * Platt ölçekleme: ham skoru tek boyutlu lojistik regresyonla olasılığa çevirir.
 * Kalibrasyon YALNIZCA eğitim katmanında öğrenilir — test katmanına uygulanır.
 */
export interface PlattScaler {
  a: number;
  b: number;
}

export function fitPlatt(
  scores: ArrayLike<number>,
  y: ArrayLike<number>,
  iterations = 300,
  lr = 0.5,
): PlattScaler {
  let a = 1;
  let b = 0;
  const n = scores.length;
  if (n === 0) return { a, b };
  for (let it = 0; it < iterations; it++) {
    let ga = 0;
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const z = a * scores[i] + b;
      const p = 1 / (1 + Math.exp(-z));
      const err = p - y[i];
      ga += err * scores[i];
      gb += err;
    }
    a -= lr * (ga / n);
    b -= lr * (gb / n);
  }
  return { a, b };
}

export function applyPlatt(scaler: PlattScaler, score: number): number {
  return 1 / (1 + Math.exp(-(scaler.a * score + scaler.b)));
}

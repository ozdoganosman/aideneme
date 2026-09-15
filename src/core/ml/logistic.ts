/**
 * L2 cezalı lojistik regresyon — kasıtlı olarak BASİT model.
 *
 * Gradyan iniş, sabit adım sayısı, rastgelelik yok: aynı girdi her zaman aynı
 * katsayıları verir (test edilebilirlik ve model kartının tekrar üretilebilirliği
 * bunu gerektirir). Özellikler eğitim kümesinin ortalama/std'siyle ölçeklenir;
 * ölçek test kümesinden ÖĞRENİLMEZ (bu da bir sızıntı biçimidir).
 *
 * Derin bir ağ değil çünkü buradaki iddia "daha iyi tahmin" değil, "dürüst
 * ölçüm": elimizdeki örnek sayısı (birkaç bin bar) karmaşık modelin
 * doğrulanmasına yetmez.
 */

export interface Standardizer {
  mean: Float64Array;
  std: Float64Array;
}

export interface LogisticModel {
  weights: Float64Array;
  bias: number;
  scaler: Standardizer;
  /** Eğitimde ulaşılan ortalama log-kayıp. */
  loss: number;
  iterations: number;
}

export interface TrainOptions {
  iterations?: number;
  learningRate?: number;
  /** L2 ceza katsayısı. */
  l2?: number;
}

export function fitStandardizer(rows: Float64Array[], dim: number): Standardizer {
  const mean = new Float64Array(dim);
  const std = new Float64Array(dim).fill(1);
  if (rows.length === 0) return { mean, std };
  for (const row of rows) for (let d = 0; d < dim; d++) mean[d] += row[d];
  for (let d = 0; d < dim; d++) mean[d] /= rows.length;
  const sq = new Float64Array(dim);
  for (const row of rows) for (let d = 0; d < dim; d++) sq[d] += (row[d] - mean[d]) ** 2;
  for (let d = 0; d < dim; d++) {
    const variance = rows.length > 1 ? sq[d] / (rows.length - 1) : 0;
    // Sabit sütun: 1'e sabitlenir, bölme patlamaz ve katkısı sıfır kalır.
    std[d] = variance > 1e-12 ? Math.sqrt(variance) : 1;
  }
  return { mean, std };
}

export function standardize(row: Float64Array, scaler: Standardizer): Float64Array {
  const out = new Float64Array(row.length);
  for (let d = 0; d < row.length; d++) out[d] = (row[d] - scaler.mean[d]) / scaler.std[d];
  return out;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

export function trainLogistic(
  rows: Float64Array[],
  y: ArrayLike<number>,
  options: TrainOptions = {},
): LogisticModel {
  const iterations = options.iterations ?? 400;
  const lr = options.learningRate ?? 0.2;
  const l2 = options.l2 ?? 1e-3;
  const dim = rows.length > 0 ? rows[0].length : 0;

  const scaler = fitStandardizer(rows, dim);
  const x = rows.map((row) => standardize(row, scaler));
  const weights = new Float64Array(dim);
  let bias = 0;
  let loss = NaN;

  const n = x.length;
  if (n === 0) return { weights, bias, scaler, loss, iterations: 0 };

  for (let it = 0; it < iterations; it++) {
    const grad = new Float64Array(dim);
    let gradBias = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      let z = bias;
      for (let d = 0; d < dim; d++) z += weights[d] * x[i][d];
      const p = sigmoid(z);
      const err = p - y[i];
      for (let d = 0; d < dim; d++) grad[d] += err * x[i][d];
      gradBias += err;
      const clipped = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
      total += y[i] === 1 ? -Math.log(clipped) : -Math.log(1 - clipped);
    }
    for (let d = 0; d < dim; d++) weights[d] -= lr * (grad[d] / n + l2 * weights[d]);
    bias -= lr * (gradBias / n);
    loss = total / n;
  }

  return { weights, bias, scaler, loss, iterations };
}

export function predictProba(model: LogisticModel, row: Float64Array): number {
  const x = standardize(row, model.scaler);
  let z = model.bias;
  for (let d = 0; d < x.length; d++) z += model.weights[d] * x[d];
  return sigmoid(z);
}

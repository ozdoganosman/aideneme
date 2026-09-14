import type { Candles } from '../data/types';
import {
  applyPlatt,
  auc,
  brier,
  expectedCalibrationError,
  fitPlatt,
  logLoss,
  reliability,
  type ReliabilityBin,
} from './calibration';
import { purgedFolds } from './cv';
import { buildFeatures, isComplete, type FeatureDef } from './features';
import { DEFAULT_BARRIERS, tripleBarrier, type BarrierOptions } from './labels';
import { predictProba, trainLogistic } from './logistic';

/**
 * Model kartı — bu katmanın ASIL ürünü.
 *
 * Referans projede "AI tahmini %73" gibi bir sayı tek başına gösteriliyor.
 * Burada kural şudur: **model kartı olmadan tahmin gösterilmez.** Kart,
 * tahminin yanında şunları taşır:
 *
 *   - kaç örnekten, hangi etiketleme ile, hangi çapraz doğrulama ile
 *   - ayrım (AUC), kalibrasyon (Brier, ECE, güvenilirlik eğrisi)
 *   - aynı veriye "her zaman taban oran" diyen APTAL modelle karşılaştırma
 *   - modelin işe yaramadığı durumda açıkça "kullanma" hükmü
 *
 * Tüm ölçümler katman-dışı (out-of-fold) tahminlerden gelir; hiçbir sayı
 * modelin gördüğü veriden hesaplanmaz.
 */

export interface ModelMetrics {
  auc: number;
  brier: number;
  logLoss: number;
  accuracy: number;
  /** Beklenen kalibrasyon hatası (0 = kusursuz). */
  ece: number;
}

export interface FeatureWeight extends FeatureDef {
  /** Katmanlar arası ortalama katsayı (standartlaştırılmış ölçekte). */
  weight: number;
  /** Katsayının işareti katmanlar arasında tutarlı mı. */
  stable: boolean;
}

export type ModelVerdict = 'kullanılabilir' | 'zayıf' | 'kullanma';

export interface ModelCard {
  symbol: string;
  /** Etiketleme kuralı (üçlü bariyer parametreleri). */
  barriers: BarrierOptions;
  samples: number;
  positiveRate: number;
  folds: number;
  embargoBars: number;
  /** Sızıntı riski nedeniyle eğitimden atılan örnek sayısı (tüm katmanlar). */
  purged: number;
  firstDay: number;
  lastDay: number;
  metrics: ModelMetrics;
  /** "Her zaman taban oranı söyle" modeli — yenilmesi gereken alt sınır. */
  baseline: { label: string; brier: number; logLoss: number; auc: number; accuracy: number };
  /** Brier beceri skoru: 1 − brier ÷ baseBrier. ≤ 0 ise model işe yaramıyor. */
  brierSkill: number;
  calibration: ReliabilityBin[];
  features: FeatureWeight[];
  /** Yüksek olasılıklı sinyallerin getiri ayrımı (yüzde puan). */
  edge: { threshold: number; signals: number; meanRetPct: number; allMeanRetPct: number };
  warnings: string[];
  verdict: ModelVerdict;
}

export interface ModelResult {
  card: ModelCard;
  /** Son bar için olasılık — kart 'kullanma' derse UI bunu GÖSTERMEZ. */
  latest: { day: number; probability: number } | null;
}

export interface TrainRequest {
  symbol?: string;
  barriers?: BarrierOptions;
  folds?: number;
  embargoBars?: number;
  /** Sinyal sayılacak olasılık eşiği. */
  threshold?: number;
}

const MIN_SAMPLES = 200;

export function trainModel(candles: Candles, request: TrainRequest = {}): ModelResult {
  const barriers = request.barriers ?? DEFAULT_BARRIERS;
  const k = request.folds ?? 5;
  const embargoBars = request.embargoBars ?? barriers.horizon;
  const threshold = request.threshold ?? 0.55;
  const symbol = request.symbol ?? '';

  const labels = tripleBarrier(candles, barriers);
  const features = buildFeatures(candles);

  // Yalnızca hem etiketi hem TAM özellik vektörü olan barlar.
  const rows: Float64Array[] = [];
  const y: number[] = [];
  const start: number[] = [];
  const end: number[] = [];
  const ret: number[] = [];
  for (let s = 0; s < labels.index.length; s++) {
    const i = labels.index[s];
    if (!isComplete(features.rows[i])) continue;
    rows.push(features.rows[i]);
    y.push(labels.y[s]);
    start.push(i);
    end.push(labels.touchedAt[s]);
    ret.push(labels.retPct[s]);
  }

  const n = rows.length;
  const positives = y.reduce((a, b) => a + b, 0);
  const positiveRate = n > 0 ? positives / n : NaN;

  const folds = n >= MIN_SAMPLES ? purgedFolds(start, end, { k, embargoBars }) : [];

  const oof = new Float64Array(n).fill(NaN);
  const weightSums = new Float64Array(features.defs.length);
  const signCounts = new Int32Array(features.defs.length);
  let purged = 0;
  let usedFolds = 0;

  for (const fold of folds) {
    purged += fold.purged;
    if (fold.train.length < 50 || fold.test.length === 0) continue;
    const trainRows = fold.train.map((i) => rows[i]);
    const trainY = fold.train.map((i) => y[i]);
    // Tek sınıflı eğitim kümesi model üretemez; katman atlanır (kartta görünür).
    const trainPositives = trainY.reduce((a, b) => a + b, 0);
    if (trainPositives === 0 || trainPositives === trainY.length) continue;

    const model = trainLogistic(trainRows, trainY);
    // Kalibrasyon YALNIZCA eğitim katmanından öğrenilir; test katmanı görülmez.
    const trainScores = trainRows.map((row) => logit(predictProba(model, row)));
    const platt = fitPlatt(trainScores, trainY);

    for (const i of fold.test) {
      oof[i] = applyPlatt(platt, logit(predictProba(model, rows[i])));
    }
    for (let d = 0; d < weightSums.length; d++) {
      weightSums[d] += model.weights[d];
      signCounts[d] += model.weights[d] >= 0 ? 1 : -1;
    }
    usedFolds++;
  }

  const evalP: number[] = [];
  const evalY: number[] = [];
  const evalRet: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(oof[i])) continue;
    evalP.push(oof[i]);
    evalY.push(y[i]);
    evalRet.push(ret[i]);
  }

  const base = evalY.length > 0 ? evalY.reduce((a, b) => a + b, 0) / evalY.length : NaN;
  const baseP = evalY.map(() => base);
  const bins = reliability(evalP, evalY, 5);

  const metrics: ModelMetrics = {
    auc: auc(evalP, evalY),
    brier: brier(evalP, evalY),
    logLoss: logLoss(evalP, evalY),
    accuracy: accuracyAt(evalP, evalY, 0.5),
    ece: expectedCalibrationError(bins),
  };
  const baseline = {
    label: 'Taban oran (her zaman aynı olasılık)',
    brier: brier(baseP, evalY),
    logLoss: logLoss(baseP, evalY),
    auc: 0.5,
    accuracy: Number.isFinite(base) ? Math.max(base, 1 - base) : NaN,
  };
  const brierSkill =
    Number.isFinite(metrics.brier) && baseline.brier > 0 ? 1 - metrics.brier / baseline.brier : NaN;

  let signals = 0;
  let signalRet = 0;
  let allRet = 0;
  for (let i = 0; i < evalP.length; i++) {
    allRet += evalRet[i];
    if (evalP[i] >= threshold) {
      signals++;
      signalRet += evalRet[i];
    }
  }

  const featureWeights: FeatureWeight[] = features.defs.map((def, d) => ({
    ...def,
    weight: usedFolds > 0 ? weightSums[d] / usedFolds : NaN,
    stable: usedFolds > 0 && Math.abs(signCounts[d]) === usedFolds,
  }));

  const warnings: string[] = [];
  if (n < MIN_SAMPLES) {
    warnings.push(
      `Örnek sayısı ${n}; dürüst bir ölçüm için en az ${MIN_SAMPLES} gerekiyor. Model eğitilmedi.`,
    );
  }
  if (usedFolds > 0 && usedFolds < (folds.length || k)) {
    warnings.push(
      `${folds.length - usedFolds} katman atlandı (eğitim kümesi çok küçük ya da tek sınıflı).`,
    );
  }
  if (Number.isFinite(metrics.auc) && metrics.auc <= 0.52) {
    warnings.push('AUC yazı-tura seviyesinde: model yön ayırt edemiyor.');
  }
  if (Number.isFinite(brierSkill) && brierSkill <= 0) {
    warnings.push('Brier beceri skoru ≤ 0: taban oranı söylemek bu modelden daha iyi.');
  }
  if (Number.isFinite(metrics.ece) && metrics.ece > 0.1) {
    warnings.push(
      `Kalibrasyon hatası %${(metrics.ece * 100).toFixed(1)}: olasılıklar olduğu gibi okunmamalı.`,
    );
  }
  if (Number.isFinite(positiveRate) && (positiveRate < 0.35 || positiveRate > 0.65)) {
    warnings.push(
      `Sınıflar dengesiz (pozitif oranı %${(positiveRate * 100).toFixed(0)}); doğruluk yanıltıcıdır.`,
    );
  }
  warnings.push(
    'Tek sembolde, tek dönemde ölçüldü; işlem maliyeti ve emir gerçekleşmesi modele dahil değil.',
  );

  const verdict: ModelVerdict =
    n < MIN_SAMPLES || usedFolds === 0 || !Number.isFinite(metrics.auc)
      ? 'kullanma'
      : metrics.auc <= 0.52 || !(brierSkill > 0)
        ? 'kullanma'
        : metrics.auc < 0.55 || metrics.ece > 0.1
          ? 'zayıf'
          : 'kullanılabilir';

  const card: ModelCard = {
    symbol,
    barriers,
    samples: n,
    positiveRate,
    folds: usedFolds,
    embargoBars,
    purged,
    firstDay: n > 0 ? Math.floor(candles.time[start[0]] / 86400) : NaN,
    lastDay: n > 0 ? Math.floor(candles.time[end[n - 1]] / 86400) : NaN,
    metrics,
    baseline,
    brierSkill,
    calibration: bins,
    features: featureWeights,
    edge: {
      threshold,
      signals,
      meanRetPct: signals > 0 ? signalRet / signals : NaN,
      allMeanRetPct: evalP.length > 0 ? allRet / evalP.length : NaN,
    },
    warnings,
    verdict,
  };

  // Canlı tahmin yalnızca kart "kullanma" demiyorsa üretilir; üretilse bile
  // UI sözleşmesi kartı yanında göstermeye mecburdur.
  let latest: ModelResult['latest'] = null;
  if (verdict !== 'kullanma') {
    const lastIndex = candles.length - 1;
    const row = features.rows[lastIndex];
    if (isComplete(row)) {
      const model = trainLogistic(rows, y);
      const scores = rows.map((r) => logit(predictProba(model, r)));
      const platt = fitPlatt(scores, y);
      latest = {
        day: Math.floor(candles.time[lastIndex] / 86400),
        probability: applyPlatt(platt, logit(predictProba(model, row))),
      };
    }
  }

  return { card, latest };
}

function logit(p: number): number {
  const c = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  return Math.log(c / (1 - c));
}

function accuracyAt(p: ArrayLike<number>, y: ArrayLike<number>, cut: number): number {
  if (p.length === 0) return NaN;
  let hits = 0;
  for (let i = 0; i < p.length; i++) if ((p[i] >= cut ? 1 : 0) === y[i]) hits++;
  return hits / p.length;
}

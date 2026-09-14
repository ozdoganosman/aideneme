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
import { FEATURE_DEFS, buildFeatures, isComplete, type FeatureDef } from './features';
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
  /** Kaç sembolün örnekleri havuzlandı (1 = tek sembol). */
  symbols: number;
  /** Etiketleme kuralı (üçlü bariyer parametreleri). */
  barriers: BarrierOptions;
  samples: number;
  positiveRate: number;
  folds: number;
  /** Karantina penceresi (takvim günü). */
  embargoDays: number;
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
  /**
   * Testten sonra karantinaya alınacak TAKVİM GÜNÜ sayısı.
   *
   * Bar değil gün: sızıntı temizliği takvim ekseninde çalışıyor (havuzlanmış
   * eğitimde bar indeksleri semboller arasında kıyaslanamaz). 10 işlem günü
   * ≈ 14 takvim günü olduğu için varsayılan, ufku 1,4 ile ölçekliyor; bar
   * sayısı olduğu gibi kullanılsaydı embargo olması gerekenden KISA olurdu.
   */
  embargoDays?: number;
  /** Sinyal sayılacak olasılık eşiği. */
  threshold?: number;
}

const MIN_SAMPLES = 200;

export interface Samples {
  rows: Float64Array[];
  y: number[];
  /**
   * Örneğin başladığı ve kesinleştiği GÜN (epoch gün) — bar indeksi değil.
   *
   * Havuzlanmış (çok sembollü) eğitimde bar indeksleri semboller arasında
   * kıyaslanamaz; sızıntı temizliği ortak bir TAKVİM ekseni ister. Tek sembolde
   * de aynı eksen kullanılıyor ki iki yol aynı kodu paylaşsın.
   */
  startDay: number[];
  endDay: number[];
  ret: number[];
  /** Havuzda hangi sembolden geldiği; tek sembolde hepsi aynı. */
  symbol: string[];
  /** Son barın özellik vektörü tamsa canlı tahmin için. */
  latest: { day: number; row: Float64Array } | null;
}

/** Bir sembolden etiketli, tam özellikli örnekler üretir. */
export function buildSamples(candles: Candles, barriers: BarrierOptions, symbol = ''): Samples {
  const labels = tripleBarrier(candles, barriers);
  const features = buildFeatures(candles);
  const day = (i: number) => Math.floor(candles.time[i] / 86400);

  const out: Samples = {
    rows: [],
    y: [],
    startDay: [],
    endDay: [],
    ret: [],
    symbol: [],
    latest: null,
  };

  // Yalnızca hem etiketi hem TAM özellik vektörü olan barlar.
  for (let s = 0; s < labels.index.length; s++) {
    const i = labels.index[s];
    if (!isComplete(features.rows[i])) continue;
    out.rows.push(features.rows[i]);
    out.y.push(labels.y[s]);
    out.startDay.push(day(i));
    out.endDay.push(day(labels.touchedAt[s]));
    out.ret.push(labels.retPct[s]);
    out.symbol.push(symbol);
  }

  const lastIndex = candles.length - 1;
  if (lastIndex >= 0 && isComplete(features.rows[lastIndex])) {
    out.latest = { day: day(lastIndex), row: features.rows[lastIndex] };
  }
  return out;
}

export function trainModel(candles: Candles, request: TrainRequest = {}): ModelResult {
  const barriers = request.barriers ?? DEFAULT_BARRIERS;
  return evaluateSamples(buildSamples(candles, barriers, request.symbol ?? ''), {
    ...request,
    barriers,
    symbols: 1,
  });
}

/**
 * Çekirdek: örnek havuzunu alır, purged CV ile katman-dışı tahminler üretir ve
 * model kartını kurar. Tek sembol de çok sembol de buradan geçer — ölçüm
 * yöntemi ikisinde AYNI olsun diye.
 */
export function evaluateSamples(
  samples: Samples,
  request: TrainRequest & { barriers: BarrierOptions; symbols: number },
): ModelResult {
  const barriers = request.barriers;
  const k = request.folds ?? 5;
  const embargoDays = request.embargoDays ?? Math.ceil(barriers.horizon * 1.4);
  const threshold = request.threshold ?? 0.55;
  const symbol = request.symbol ?? '';

  const rows = samples.rows;
  const y = samples.y;
  const start = samples.startDay;
  const end = samples.endDay;
  const ret = samples.ret;
  const pooled = request.symbols > 1;

  const n = rows.length;
  const positives = y.reduce((a, b) => a + b, 0);
  const positiveRate = n > 0 ? positives / n : NaN;

  const folds = n >= MIN_SAMPLES ? purgedFolds(start, end, { k, embargoBars: embargoDays }) : [];

  const oof = new Float64Array(n).fill(NaN);
  const weightSums = new Float64Array(FEATURE_DEFS.length);
  const signCounts = new Int32Array(FEATURE_DEFS.length);
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

  const featureWeights: FeatureWeight[] = FEATURE_DEFS.map((def, d) => ({
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
    pooled
      ? `${request.symbols} sembolün örnekleri havuzlandı; tek bir dönemde ölçüldü ve işlem ` +
          'maliyeti ile emir gerçekleşmesi modele dahil değil.'
      : 'Tek sembolde, tek dönemde ölçüldü; işlem maliyeti ve emir gerçekleşmesi modele dahil değil.',
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
    symbols: request.symbols,
    barriers,
    samples: n,
    positiveRate,
    folds: usedFolds,
    embargoDays,
    purged,
    firstDay: n > 0 ? Math.min(...start) : NaN,
    lastDay: n > 0 ? Math.max(...end) : NaN,
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
  if (verdict !== 'kullanma' && samples.latest) {
    const model = trainLogistic(rows, y);
    const scores = rows.map((r) => logit(predictProba(model, r)));
    const platt = fitPlatt(scores, y);
    latest = {
      day: samples.latest.day,
      probability: applyPlatt(platt, logit(predictProba(model, samples.latest.row))),
    };
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

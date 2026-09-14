import type { Candles } from '../data/types';
import { emptyCandles } from '../data/types';
import type { Operand, Strategy } from '../strategy/dsl';
import { DEFAULT_COSTS, ZERO_COSTS, runBacktest, type BacktestOptions } from './engine';
import { computeMetrics, type BacktestMetrics } from './metrics';
import { deflatedSharpe, moments, rng, shuffle } from './stats';

/**
 * Doğrulama katmanı — ürünün ayırt edici parçası.
 *
 * Bir backtest sonucu tek başına bir iddiadır. Bu katman o iddiayı beş ayrı
 * soruyla sınar ve her birine ROZET verir:
 *
 *   OOS         — parametreler geçmişte seçildi, sonuç ileride mi ölçüldü?
 *   Maliyet     — komisyon ve slipaj dahil mi?
 *   Sağlamlık   — komşu parametreler de kazanıyor mu, yoksa tek tepe mi?
 *   Tesadüf     — aynı sonucu rastgele bir seri de üretir miydi?
 *   Çoklu test  — kaç kombinasyon denendi, Sharpe buna göre şişmiş mi?
 *
 * Hepsi saf fonksiyon: worker'da çalışır, testte tekrarlanabilir (sabit tohum).
 */

export type BadgeLevel = 'pass' | 'warn' | 'fail' | 'unknown';

export interface Badge {
  id: 'oos' | 'cost' | 'robust' | 'chance' | 'multiplicity';
  label: string;
  level: BadgeLevel;
  /** Tek cümlelik gerekçe — UI bunu olduğu gibi gösterir. */
  detail: string;
  value?: number;
}

// ── Parametre düğmeleri ──────────────────────────────────────────────────────

export interface Knob {
  /** Düğmenin yolu: strateji nesnesinde nereye yazılacağı. */
  path: string;
  value: number;
  min: number;
  max: number;
  label: string;
}

/** Stratejideki sayısal parametreleri (pencere uzunlukları, stop/hedef) çıkarır. */
export function collectKnobs(strategy: Strategy): Knob[] {
  const knobs: Knob[] = [];

  const visitOperand = (operand: Operand, path: string) => {
    if (operand.kind === 'scale') {
      knobs.push({
        path: `${path}.factor`,
        value: operand.factor,
        min: 0.1,
        max: 5,
        label: 'çarpan',
      });
      visitOperand(operand.of, `${path}.of`);
    } else if ('length' in operand) {
      knobs.push({
        path: `${path}.length`,
        value: operand.length,
        min: 2,
        max: 1000,
        label: `${operand.kind.toUpperCase()} uzunluk`,
      });
    }
  };

  const visit = (condition: Strategy['entry'], path: string) => {
    switch (condition.op) {
      case 'all':
      case 'any':
        condition.of.forEach((sub, i) => visit(sub, `${path}.of.${i}`));
        break;
      case 'not':
        visit(condition.of, `${path}.of`);
        break;
      default:
        visitOperand(condition.left, `${path}.left`);
        visitOperand(condition.right, `${path}.right`);
    }
  };

  visit(strategy.entry, 'entry');
  if (strategy.exit) visit(strategy.exit, 'exit');
  if (strategy.stopLossPct !== undefined) {
    knobs.push({
      path: 'stopLossPct',
      value: strategy.stopLossPct,
      min: 0.5,
      max: 50,
      label: 'stop %',
    });
  }
  if (strategy.takeProfitPct !== undefined) {
    knobs.push({
      path: 'takeProfitPct',
      value: strategy.takeProfitPct,
      min: 0.5,
      max: 200,
      label: 'hedef %',
    });
  }
  return knobs;
}

/** Bir düğmeyi değiştirip stratejinin kopyasını döndürür. */
export function withKnob(strategy: Strategy, path: string, value: number): Strategy {
  const clone = structuredClone(strategy) as unknown as Record<string, unknown>;
  const parts = path.split('.');
  let node: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    node = node[parts[i]] as Record<string, unknown>;
    if (!node) return strategy;
  }
  node[parts[parts.length - 1]] = value;
  return clone as unknown as Strategy;
}

// ── Yardımcı: tek koşu ───────────────────────────────────────────────────────

function evaluate(c: Candles, strategy: Strategy, options: BacktestOptions): BacktestMetrics {
  return computeMetrics(runBacktest(c, strategy, options), c);
}

function slice(c: Candles, from: number, to: number): Candles {
  const n = Math.max(0, to - from);
  const out = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    out.time[i] = c.time[from + i];
    out.open[i] = c.open[from + i];
    out.high[i] = c.high[from + i];
    out.low[i] = c.low[from + i];
    out.close[i] = c.close[from + i];
    out.volume[i] = c.volume[from + i];
  }
  return out;
}

// ── 1) Walk-forward (OOS) ────────────────────────────────────────────────────

export interface WalkForwardFold {
  trainFrom: number;
  trainTo: number;
  testFrom: number;
  testTo: number;
  /** Eğitim penceresinde seçilen düğme değeri (varsa). */
  chosen?: { path: string; value: number };
  trainCagrPct: number;
  testCagrPct: number;
  testTrades: number;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  /** İleri pencerelerin ortalama yıllık getirisi (%). */
  meanTestCagrPct: number;
  /** Kaç ileri pencerede pozitif sonuç alındı. */
  positiveFolds: number;
}

/**
 * Yürüyen doğrulama: her katmanda parametre GEÇMİŞ pencerede seçilir, sonuç
 * İLERİ pencerede ölçülür. Optimize edilecek düğme verilmezse sonuç yine de
 * out-of-sample'dır (sabit parametre, görülmemiş dönem).
 */
export function walkForward(
  c: Candles,
  strategy: Strategy,
  options: BacktestOptions & { folds?: number; knob?: Knob; candidates?: number[] } = {},
): WalkForwardResult {
  const folds = Math.max(2, options.folds ?? 4);
  const n = c.length;
  const result: WalkForwardResult = { folds: [], meanTestCagrPct: NaN, positiveFolds: 0 };
  if (n < folds * 60) return result;

  const testSize = Math.floor(n / (folds + 1));

  for (let k = 0; k < folds; k++) {
    const trainFrom = 0;
    const trainTo = testSize * (k + 1);
    const testFrom = trainTo;
    const testTo = Math.min(n, testFrom + testSize);
    if (testTo - testFrom < 30) break;

    const train = slice(c, trainFrom, trainTo);
    const test = slice(c, testFrom, testTo);

    let best = strategy;
    let chosen: { path: string; value: number } | undefined;
    let trainCagr = evaluate(train, strategy, options).cagrPct;

    if (options.knob && options.candidates?.length) {
      for (const candidate of options.candidates) {
        const trial = withKnob(strategy, options.knob.path, candidate);
        const metrics = evaluate(train, trial, options);
        if (metrics.cagrPct > trainCagr) {
          trainCagr = metrics.cagrPct;
          best = trial;
          chosen = { path: options.knob.path, value: candidate };
        }
      }
    }

    const testMetrics = evaluate(test, best, options);
    result.folds.push({
      trainFrom,
      trainTo,
      testFrom,
      testTo,
      chosen,
      trainCagrPct: trainCagr,
      testCagrPct: testMetrics.cagrPct,
      testTrades: testMetrics.trades,
    });
  }

  if (result.folds.length) {
    result.meanTestCagrPct =
      result.folds.reduce((s, f) => s + f.testCagrPct, 0) / result.folds.length;
    result.positiveFolds = result.folds.filter((f) => f.testCagrPct > 0).length;
  }
  return result;
}

// ── 2) Parametre platosu ─────────────────────────────────────────────────────

export interface PlateauPoint {
  path: string;
  label: string;
  value: number;
  cagrPct: number;
  trades: number;
  /** Bu nokta orijinal (seçilen) parametre mi? */
  base: boolean;
}

export interface PlateauResult {
  points: PlateauPoint[];
  /** Komşuların yüzde kaçı da kârlı? */
  positiveNeighborPct: number;
  /** Komşuların medyan yıllık getirisi (%). */
  medianNeighborCagrPct: number;
  baseCagrPct: number;
}

/**
 * Her düğme ±%20 ve ±%40 kaydırılıp yeniden çalıştırılır. Tek bir tepe
 * noktasında duran strateji (komşuları zarar eden) parametreye uydurulmuş
 * demektir; plato ise sonucun tesadüfe daha az bağlı olduğunu gösterir.
 */
export function parameterPlateau(
  c: Candles,
  strategy: Strategy,
  options: BacktestOptions & { steps?: number[] } = {},
): PlateauResult {
  const steps = options.steps ?? [-0.4, -0.2, 0.2, 0.4];
  const knobs = collectKnobs(strategy);
  const baseCagr = evaluate(c, strategy, options).cagrPct;

  const points: PlateauPoint[] = [];
  for (const knob of knobs) {
    points.push({
      path: knob.path,
      label: knob.label,
      value: knob.value,
      cagrPct: baseCagr,
      trades: 0,
      base: true,
    });
    for (const step of steps) {
      const raw = knob.value * (1 + step);
      const value = Math.round(Math.min(knob.max, Math.max(knob.min, raw)) * 100) / 100;
      if (value === knob.value) continue;
      const metrics = evaluate(c, withKnob(strategy, knob.path, value), options);
      points.push({
        path: knob.path,
        label: knob.label,
        value,
        cagrPct: metrics.cagrPct,
        trades: metrics.trades,
        base: false,
      });
    }
  }

  const neighbors = points.filter((p) => !p.base).map((p) => p.cagrPct);
  neighbors.sort((a, b) => a - b);
  const mid = neighbors.length >> 1;

  return {
    points,
    positiveNeighborPct: neighbors.length
      ? (neighbors.filter((v) => v > 0).length / neighbors.length) * 100
      : NaN,
    medianNeighborCagrPct: neighbors.length
      ? neighbors.length % 2
        ? neighbors[mid]
        : (neighbors[mid - 1] + neighbors[mid]) / 2
      : NaN,
    baseCagrPct: baseCagr,
  };
}

// ── 3) Permütasyon testi ─────────────────────────────────────────────────────

export interface PermutationResult {
  observedCagrPct: number;
  /** Karıştırılmış serilerde elde edilen sonuçların medyanı. */
  medianNullCagrPct: number;
  /** p = (1 + gözlenene eşit veya üstü) / (B + 1). */
  pValue: number;
  runs: number;
}

/**
 * Bar getirilerini karıştırıp aynı stratejiyi yeniden çalıştırır.
 *
 * Karıştırma trendi ve otokorelasyonu yok eder ama getiri DAĞILIMINI korur:
 * strateji hâlâ kazanıyorsa, kazancı piyasa yapısından değil dağılımdan
 * geliyordur — yani tesadüf.
 */
export function permutationTest(
  c: Candles,
  strategy: Strategy,
  options: BacktestOptions & { runs?: number; seed?: number } = {},
): PermutationResult {
  const runs = Math.max(10, options.runs ?? 200);
  const random = rng(options.seed ?? 12345);
  const observed = evaluate(c, strategy, options).cagrPct;
  const n = c.length;

  if (n < 30) {
    return { observedCagrPct: observed, medianNullCagrPct: NaN, pValue: NaN, runs: 0 };
  }

  // Bar başına: getiri + bar içi şekil (O/H/L'nin kapanışa oranı) korunur.
  const steps: { ret: number; o: number; h: number; l: number; v: number }[] = [];
  for (let i = 1; i < n; i++) {
    const prev = c.close[i - 1];
    const cur = c.close[i];
    if (!(prev > 0) || !(cur > 0)) continue;
    steps.push({
      ret: cur / prev,
      o: c.open[i] / cur,
      h: c.high[i] / cur,
      l: c.low[i] / cur,
      v: c.volume[i],
    });
  }

  const nulls: number[] = [];
  let atLeastAsGood = 0;

  for (let run = 0; run < runs; run++) {
    const order = shuffle([...steps], random);
    const synthetic = emptyCandles(order.length + 1);
    synthetic.time[0] = c.time[0];
    synthetic.open[0] = c.open[0];
    synthetic.high[0] = c.high[0];
    synthetic.low[0] = c.low[0];
    synthetic.close[0] = c.close[0];
    synthetic.volume[0] = c.volume[0];

    let price = c.close[0];
    for (let i = 0; i < order.length; i++) {
      const step = order[i];
      price *= step.ret;
      const k = i + 1;
      synthetic.time[k] = c.time[Math.min(k, n - 1)];
      synthetic.close[k] = price;
      synthetic.open[k] = price * step.o;
      synthetic.high[k] = price * step.h;
      synthetic.low[k] = price * step.l;
      synthetic.volume[k] = step.v;
    }

    const value = evaluate(synthetic, strategy, options).cagrPct;
    nulls.push(value);
    if (value >= observed) atLeastAsGood++;
  }

  nulls.sort((a, b) => a - b);
  const mid = nulls.length >> 1;

  return {
    observedCagrPct: observed,
    medianNullCagrPct: nulls.length % 2 ? nulls[mid] : (nulls[mid - 1] + nulls[mid]) / 2,
    pValue: (1 + atLeastAsGood) / (runs + 1),
    runs,
  };
}

// ── 4) Rozetler ──────────────────────────────────────────────────────────────

export interface ValidationOptions extends BacktestOptions {
  /** Denenen kombinasyon sayısı (çoklu test düzeltmesi için). */
  trials?: number;
  permutationRuns?: number;
  folds?: number;
  seed?: number;
  /** Ağır adımları atla (hızlı mod). */
  skipPermutation?: boolean;
  skipPlateau?: boolean;
  skipWalkForward?: boolean;
}

export interface ValidationReport {
  badges: Badge[];
  metrics: BacktestMetrics;
  walkForward?: WalkForwardResult;
  plateau?: PlateauResult;
  permutation?: PermutationResult;
  deflatedSharpe?: { dsr: number; threshold: number; trials: number };
}

export function validateStrategy(
  c: Candles,
  strategy: Strategy,
  options: ValidationOptions = {},
): ValidationReport {
  const costs = options.costs ?? DEFAULT_COSTS;
  const runOptions: BacktestOptions = { ...options, costs };

  const result = runBacktest(c, strategy, runOptions);
  const metrics = computeMetrics(result, c);
  const badges: Badge[] = [];

  // Maliyet
  const free = costs.commissionBps === 0 && costs.slippageBps === 0;
  badges.push({
    id: 'cost',
    label: 'Maliyet',
    level: free ? 'fail' : 'pass',
    value: metrics.costDragPct,
    detail: free
      ? 'Komisyon ve slipaj SIFIR — bu sonuç gerçek hayatta elde edilemez.'
      : `Komisyon ${costs.commissionBps} bps + slipaj ${costs.slippageBps} bps dahil; maliyet ${metrics.costDragPct.toFixed(1)} puan götürdü.`,
  });

  // OOS
  let wf: WalkForwardResult | undefined;
  if (!options.skipWalkForward) {
    wf = walkForward(c, strategy, { ...runOptions, folds: options.folds });
    const usable = wf.folds.length > 0;
    const ratio = usable ? wf.positiveFolds / wf.folds.length : 0;
    badges.push({
      id: 'oos',
      label: 'OOS',
      level: !usable ? 'unknown' : ratio >= 0.6 ? 'pass' : ratio >= 0.4 ? 'warn' : 'fail',
      value: wf.meanTestCagrPct,
      detail: !usable
        ? 'Yürüyen doğrulama için yeterli veri yok (en az ~240 bar).'
        : `${wf.folds.length} ileri pencerenin ${wf.positiveFolds} tanesi pozitif; ortalama yıllık ${wf.meanTestCagrPct.toFixed(1)}%.`,
    });
  }

  // Sağlamlık
  let plateau: PlateauResult | undefined;
  if (!options.skipPlateau) {
    plateau = parameterPlateau(c, strategy, runOptions);
    const pct = plateau.positiveNeighborPct;
    badges.push({
      id: 'robust',
      label: 'Sağlamlık',
      level: !Number.isFinite(pct) ? 'unknown' : pct >= 70 ? 'pass' : pct >= 40 ? 'warn' : 'fail',
      value: pct,
      detail: !Number.isFinite(pct)
        ? 'Değiştirilecek parametre bulunamadı.'
        : `Komşu parametrelerin %${pct.toFixed(0)}'i de kârlı; komşu medyanı yıllık ${plateau.medianNeighborCagrPct.toFixed(1)}% (seçilen: ${plateau.baseCagrPct.toFixed(1)}%).`,
    });
  }

  // Tesadüf
  let permutation: PermutationResult | undefined;
  if (!options.skipPermutation) {
    permutation = permutationTest(c, strategy, {
      ...runOptions,
      runs: options.permutationRuns,
      seed: options.seed,
    });
    const p = permutation.pValue;
    badges.push({
      id: 'chance',
      label: 'Tesadüf',
      level: !Number.isFinite(p) ? 'unknown' : p <= 0.05 ? 'pass' : p <= 0.2 ? 'warn' : 'fail',
      value: p,
      detail: !Number.isFinite(p)
        ? 'Permütasyon testi için yeterli bar yok.'
        : `Karıştırılmış ${permutation.runs} seride aynı sonuca ulaşma olasılığı p = ${p.toFixed(3)} (medyan yıllık ${permutation.medianNullCagrPct.toFixed(1)}%).`,
    });
  }

  // Çoklu test
  const trials = Math.max(1, options.trials ?? 1);
  const rets: number[] = [];
  for (let i = result.warmup + 1; i < result.equity.length; i++) {
    const prev = result.equity[i - 1];
    if (prev > 0 && result.equity[i] > 0) rets.push(result.equity[i] / prev - 1);
  }
  const m = moments(rets);
  const sharpePerBar = m.std > 0 ? m.mean / m.std : 0;
  const { dsr, threshold } = deflatedSharpe({
    sharpePerBar,
    bars: rets.length,
    skewness: m.skewness,
    kurtosis: m.kurtosis,
    trials,
  });
  badges.push({
    id: 'multiplicity',
    label: 'Çoklu test',
    level: !Number.isFinite(dsr) ? 'unknown' : dsr >= 0.95 ? 'pass' : dsr >= 0.8 ? 'warn' : 'fail',
    value: dsr,
    detail: !Number.isFinite(dsr)
      ? 'Deflated Sharpe için yeterli veri yok.'
      : `${trials} kombinasyon denendi; bu sayıda denemede şansla beklenen Sharpe ${(threshold * Math.sqrt(252)).toFixed(2)}. Deflated Sharpe = ${(dsr * 100).toFixed(0)}%.`,
  });

  return {
    badges,
    metrics,
    walkForward: wf,
    plateau,
    permutation,
    deflatedSharpe: { dsr, threshold, trials },
  };
}

export { ZERO_COSTS };

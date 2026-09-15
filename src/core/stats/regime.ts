import type { Candles } from '../data/types';
import { atrArr } from '../indicators/rsi';
import { adxArr } from '../indicators/calc';

/**
 * Piyasa rejimi: oynaklık (düşük/yüksek) × yön (yatay/trend).
 *
 * Bir stratejinin ortalama getirisi tek başına eksik bir cümledir: yalnızca
 * düşük oynaklıkta kazanan bir strateji, piyasa sertleştiğinde kullanıcının
 * beklediğinden başka bir şey yapar. Bu dosya işlemleri GİRİŞ BARINDAKİ
 * rejime göre ayırmayı sağlıyor.
 *
 * Sınıflandırma NEDENSEL: oynaklık eşiği, o bara kadarki geçmişin medyanı —
 * bugünkü barı ve geleceği içermez. Tam örneklem medyanı kullansaydık, "bu
 * strateji yüksek oynaklıkta iyi" cümlesi geleceği bilerek kurulmuş olurdu.
 */

export interface RegimeOptions {
  atrLength?: number;
  adxLength?: number;
  /** Oynaklık eşiği için geriye dönük pencere (bar). */
  lookback?: number;
  /** ADX bu eşiğin üstündeyse "trend". */
  adxTrend?: number;
  /** Eşik hesabı için gereken en az geçmiş bar. */
  minHistory?: number;
}

export const DEFAULT_REGIME: Required<RegimeOptions> = {
  atrLength: 14,
  adxLength: 14,
  lookback: 250,
  adxTrend: 25,
  minHistory: 60,
};

/** -1 bilinmiyor · 0 düşük/yatay · 1 yüksek/trend. */
export interface Regimes {
  vol: Int8Array;
  trend: Int8Array;
  atrPct: Float64Array;
  adx: Float64Array;
  /** O bardaki oynaklık eşiği (geçmişin medyanı) — ekranda gösterilebilir. */
  threshold: Float64Array;
  options: Required<RegimeOptions>;
}

/** Sıralı diziye ikili aramayla ekleme noktası. */
function lowerBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function classifyRegimes(c: Candles, options: RegimeOptions = {}): Regimes {
  const opt = { ...DEFAULT_REGIME, ...options };
  const n = c.length;
  const atr = atrArr(c.high, c.low, c.close, opt.atrLength);
  const adx = adxArr(c, opt.adxLength);

  const atrPct = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(atr[i]) && c.close[i] > 0) atrPct[i] = (atr[i] / c.close[i]) * 100;
  }

  const vol = new Int8Array(n).fill(-1);
  const trend = new Int8Array(n).fill(-1);
  const threshold = new Float64Array(n).fill(NaN);

  // Kayan medyan: pencere sıralı tutuluyor, her barda bir ekleme + bir çıkarma.
  const window: number[] = [];
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (window.length >= opt.minHistory) {
      const mid = window.length >> 1;
      const median = window.length % 2 ? window[mid] : (window[mid - 1] + window[mid]) / 2;
      threshold[i] = median;
      if (Number.isFinite(atrPct[i])) vol[i] = atrPct[i] > median ? 1 : 0;
    }
    if (Number.isFinite(adx[i])) trend[i] = adx[i] >= opt.adxTrend ? 1 : 0;

    // ÖNCE sınıflandır, SONRA bu barı pencereye al: eşik yalnızca geçmişten.
    if (Number.isFinite(atrPct[i])) {
      window.splice(lowerBound(window, atrPct[i]), 0, atrPct[i]);
      queue.push(atrPct[i]);
      if (queue.length > opt.lookback) {
        const old = queue.shift()!;
        window.splice(lowerBound(window, old), 1);
      }
    }
  }

  return { vol, trend, atrPct, adx, threshold, options: opt };
}

export type RegimeKey = 'dusuk-yatay' | 'dusuk-trend' | 'yuksek-yatay' | 'yuksek-trend';

const KEYS: { key: RegimeKey; vol: 0 | 1; trend: 0 | 1; label: string }[] = [
  { key: 'dusuk-yatay', vol: 0, trend: 0, label: 'Düşük oynaklık · yatay' },
  { key: 'dusuk-trend', vol: 0, trend: 1, label: 'Düşük oynaklık · trend' },
  { key: 'yuksek-yatay', vol: 1, trend: 0, label: 'Yüksek oynaklık · yatay' },
  { key: 'yuksek-trend', vol: 1, trend: 1, label: 'Yüksek oynaklık · trend' },
];

export interface RegimeBucket {
  key: RegimeKey;
  label: string;
  trades: number;
  /** Net getiri medyanı (%); örnek yetmezse NaN. */
  medianPct: number;
  meanPct: number;
  winRatePct: number;
  /** Örneklemin bu rejimde geçirdiği bar oranı (%). */
  barsPct: number;
  /** Sayı taşıyacak kadar işlem var mı — yoksa ekran sayı GÖSTERMEZ. */
  enough: boolean;
}

export interface RegimeBreakdown {
  buckets: RegimeBucket[];
  /** Rejimi bilinmeyen (ısınma barında açılan) işlem sayısı — gizlenmez. */
  unknown: number;
  minTrades: number;
}

const median = (values: number[]): number => {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * İşlemleri giriş barındaki rejime göre ayırır.
 *
 * Kırılım bir strateji DEĞİL, bir teşhis: "yalnızca şu rejimde işlem yap"
 * kuralı bu tablodan çıkarılırsa aynı veriye iki kez bakılmış olur. Ekran
 * bunu yazıyor.
 */
export function regimeBreakdown(
  trades: { entryIndex: number; netPct: number }[],
  regimes: Regimes,
  minTrades = 5,
): RegimeBreakdown {
  const groups = new Map<RegimeKey, number[]>();
  let unknown = 0;
  for (const trade of trades) {
    const v = regimes.vol[trade.entryIndex];
    const t = regimes.trend[trade.entryIndex];
    if (v < 0 || t < 0) {
      unknown++;
      continue;
    }
    const entry = KEYS.find((k) => k.vol === v && k.trend === t)!;
    const list = groups.get(entry.key);
    if (list) list.push(trade.netPct);
    else groups.set(entry.key, [trade.netPct]);
  }

  let classified = 0;
  const barCount = new Map<RegimeKey, number>();
  for (let i = 0; i < regimes.vol.length; i++) {
    const v = regimes.vol[i];
    const t = regimes.trend[i];
    if (v < 0 || t < 0) continue;
    classified++;
    const entry = KEYS.find((k) => k.vol === v && k.trend === t)!;
    barCount.set(entry.key, (barCount.get(entry.key) ?? 0) + 1);
  }

  const buckets = KEYS.map(({ key, label }) => {
    const values = groups.get(key) ?? [];
    const enough = values.length >= minTrades;
    const wins = values.filter((v) => v > 0).length;
    return {
      key,
      label,
      trades: values.length,
      medianPct: enough ? median(values) : NaN,
      meanPct: enough ? values.reduce((a, b) => a + b, 0) / values.length : NaN,
      winRatePct: enough ? (wins / values.length) * 100 : NaN,
      barsPct: classified ? ((barCount.get(key) ?? 0) / classified) * 100 : NaN,
      enough,
    };
  });

  return { buckets, unknown, minTrades };
}

/**
 * Kırılımın taşıdığı tek cümlelik hüküm. Bir rejimde işlem yoksa ya da
 * örnek yetmiyorsa hüküm VERİLMEZ.
 */
export function regimeVerdict(breakdown: RegimeBreakdown): string {
  const measured = breakdown.buckets.filter((b) => b.enough);
  if (measured.length < 2) {
    return 'Rejim karşılaştırması için yeterli işlem yok; kırılım bilgi amaçlı.';
  }
  const best = measured.reduce((a, b) => (b.medianPct > a.medianPct ? b : a));
  const worst = measured.reduce((a, b) => (b.medianPct < a.medianPct ? b : a));
  if (best.key === worst.key) return 'Rejimler arasında ayrışma ölçülemedi.';
  const positive = measured.filter((b) => b.medianPct > 0).length;
  if (positive === measured.length) {
    return `Ölçülen ${measured.length} rejimin hepsinde medyan işlem pozitif; en iyisi ${best.label}.`;
  }
  // Türkçe yazım: yüzde işareti sayıdan ÖNCE, ondalık virgül (bkz. ui/format).
  const pct = (v: number) => `${v < 0 ? '-' : ''}%${Math.abs(v).toFixed(2).replace('.', ',')}`;
  return `En iyi ${best.label} (medyan ${pct(best.medianPct)}), en kötü ${worst.label} (${pct(worst.medianPct)}).`;
}

export const REGIME_CAVEAT =
  'Kırılım bir teşhistir, strateji değil: "yalnızca şu rejimde işlem yap" kuralını bu tablodan çıkarmak aynı veriye ikinci kez bakmak olur ve buradaki sayıları geçersiz kılar.';

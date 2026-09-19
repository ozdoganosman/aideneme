import type { Candles } from '../data/types';
import { emaArr, rocArr, adxArr, rollingHighest } from '../indicators/calc';
import { rsiArr, atrArr } from '../indicators/rsi';
import { rollingVol } from './labels';

/**
 * Özellik matrisi — hepsi NEDENSEL: i barındaki değer yalnızca ≤ i barlarından
 * hesaplanır. Tek bir ileri bakış (ör. "bugünün kapanışına göre normalize
 * edilmiş gelecek hacim") tüm doğrulamayı çöpe atar, bu yüzden özellikler
 * mevcut indikatör çekirdeğinden türetilir ve kaydırma yapılmaz.
 *
 * Özellikler kasıtlı olarak az ve yorumlanabilir: katsayıların işareti model
 * kartında gösterilecek; anlaşılmayan bir katsayı güven vermez.
 */

export interface FeatureDef {
  key: string;
  label: string;
  /** Modelin hangi soruyu sorduğunu tek cümlede anlatır. */
  detail: string;
}

export const FEATURE_DEFS: FeatureDef[] = [
  { key: 'rsi', label: 'RSI (14)', detail: 'Aşırı alım/satım — 50 çevresine göre' },
  { key: 'emaGap', label: 'EMA(20) farkı %', detail: 'Fiyatın kısa ortalamaya uzaklığı' },
  { key: 'emaSlope', label: 'EMA(50) eğimi %', detail: 'Orta vadeli trendin yönü' },
  { key: 'mom', label: 'Momentum (20) %', detail: '20 barlık getiri' },
  { key: 'atrPct', label: 'ATR %', detail: 'Oynaklık rejimi' },
  { key: 'volRatio', label: 'Hacim oranı', detail: 'Son hacim ÷ 20 bar ortalaması' },
  { key: 'fromHigh', label: 'Zirveye uzaklık %', detail: '250 barlık zirveye göre konum' },
  { key: 'adx', label: 'ADX (14)', detail: 'Trend gücü (yönsüz)' },
  { key: 'volZ', label: 'Oynaklık z', detail: 'Kısa oynaklığın uzun oynaklığa oranı' },
];

export interface FeatureMatrix {
  defs: FeatureDef[];
  /** rows[i] → i. bara ait özellik vektörü; NaN içerenler kullanılamaz. */
  rows: Float64Array[];
  /** Isınma: bu bardan önce hiçbir satır tam değildir. */
  warmup: number;
}

export function buildFeatures(candles: Candles): FeatureMatrix {
  const n = candles.length;
  const { close, high, volume } = candles;

  const rsi = rsiArr(close, 14);
  const ema20 = emaArr(close, 20);
  const ema50 = emaArr(close, 50);
  const mom = rocArr(close, 20);
  const atr = atrArr(high, candles.low, close, 14);
  const adx = adxArr(candles, 14);
  const hi250 = rollingHighest(close, 250);
  const volShort = rollingVol(close, 10);
  const volLong = rollingVol(close, 60);

  const volAvg = new Float64Array(n).fill(NaN);
  for (let i = 19; i < n; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) sum += volume[j];
    volAvg[i] = sum / 20;
  }

  const rows: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(FEATURE_DEFS.length);
    row[0] = rsi[i] - 50;
    row[1] = ema20[i] > 0 ? (close[i] / ema20[i] - 1) * 100 : NaN;
    row[2] = i >= 5 && ema50[i - 5] > 0 ? (ema50[i] / ema50[i - 5] - 1) * 100 : NaN;
    row[3] = mom[i];
    row[4] = close[i] > 0 ? (atr[i] / close[i]) * 100 : NaN;
    row[5] = volAvg[i] > 0 ? volume[i] / volAvg[i] : NaN;
    row[6] = hi250[i] > 0 ? (close[i] / hi250[i] - 1) * 100 : NaN;
    row[7] = adx[i];
    row[8] = volLong[i] > 0 ? volShort[i] / volLong[i] : NaN;
    rows.push(row);
  }

  let warmup = n;
  for (let i = 0; i < n; i++) {
    if (rows[i].every((v) => Number.isFinite(v))) {
      warmup = i;
      break;
    }
  }

  return { defs: FEATURE_DEFS, rows, warmup };
}

export function isComplete(row: Float64Array): boolean {
  for (let d = 0; d < row.length; d++) if (!Number.isFinite(row[d])) return false;
  return true;
}

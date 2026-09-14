import type { Candles } from '../data/types';

/**
 * Üçlü bariyer etiketleme (López de Prado).
 *
 * "Yarın yükselecek mi?" sorusu kötü bir sorudur: eşiği yok, riski yok, süresi
 * yok. Üçlü bariyer bunun yerine **işlem gibi** sorar:
 *
 *   - üst bariyer  (kâr al)  → etiket 1
 *   - alt bariyer  (zarar kes) → etiket 0
 *   - zaman bariyeri (süre doldu) → getiriye göre 1/0
 *
 * Bariyerler sabit yüzde değil, o günkü oynaklıkla ÖLÇEKLENİR; yoksa sakin ve
 * çalkantılı dönemler aynı eşikle etiketlenir ve model sadece rejimi öğrenir.
 *
 * Her etiket bir ZAMAN ARALIĞI kaplar (giriş → bariyere değme). Bu aralık
 * `touchedAt` ile dışarı verilir; çapraz doğrulama bunu kullanarak sızıntıyı
 * temizler (bkz. cv.ts). Saf fonksiyon: girdi dışında hiçbir şeye bakmaz.
 */

export interface BarrierOptions {
  /** Zaman bariyeri (bar). */
  horizon: number;
  /** Üst bariyer = oynaklık × bu katsayı. */
  upMult: number;
  /** Alt bariyer = oynaklık × bu katsayı. */
  downMult: number;
  /** Oynaklık penceresi (bar) — günlük getirilerin std. sapması. */
  volLength: number;
}

export const DEFAULT_BARRIERS: BarrierOptions = {
  horizon: 10,
  upMult: 1.5,
  downMult: 1.5,
  volLength: 20,
};

export interface Labels {
  /** Etiketlenen barların indeksleri (giriş barı). */
  index: Int32Array;
  /** 1 = üst bariyer / pozitif kapanış, 0 = alt bariyer / negatif kapanış. */
  y: Int8Array;
  /** Etiketin kesinleştiği bar — sızıntı temizliği bunu kullanır. */
  touchedAt: Int32Array;
  /** Girişten çıkışa yüzde getiri (maliyetsiz; burada amaç yön). */
  retPct: Float64Array;
  /** Hangi bariyere değdi: 'up' | 'down' | 'time'. */
  hit: ('up' | 'down' | 'time')[];
}

/** Günlük log getirilerin kayan std. sapması (yüzde değil, oran). */
export function rollingVol(close: Float64Array, length: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NaN);
  if (n < 2 || length < 2) return out;
  const ret = new Float64Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    if (close[i - 1] > 0 && close[i] > 0) ret[i] = Math.log(close[i] / close[i - 1]);
  }
  for (let i = length; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - length + 1; j <= i; j++) {
      if (Number.isFinite(ret[j])) {
        sum += ret[j];
        count++;
      }
    }
    if (count < 2) continue;
    const mean = sum / count;
    let sq = 0;
    for (let j = i - length + 1; j <= i; j++) {
      if (Number.isFinite(ret[j])) sq += (ret[j] - mean) ** 2;
    }
    out[i] = Math.sqrt(sq / (count - 1));
  }
  return out;
}

export function tripleBarrier(
  candles: Candles,
  options: BarrierOptions = DEFAULT_BARRIERS,
): Labels {
  const { horizon, upMult, downMult, volLength } = options;
  const n = candles.length;
  const vol = rollingVol(candles.close, volLength);

  const index: number[] = [];
  const y: number[] = [];
  const touchedAt: number[] = [];
  const retPct: number[] = [];
  const hit: ('up' | 'down' | 'time')[] = [];

  // Son `horizon` bar etiketlenemez: sonucu henüz görülmedi. Bunları etiketleyip
  // "yaklaşık" bir sonuç uydurmak, modelin geleceği bilmesi demektir.
  for (let i = volLength; i + horizon < n; i++) {
    const sigma = vol[i];
    if (!Number.isFinite(sigma) || sigma <= 0) continue;
    const entry = candles.close[i];
    if (!(entry > 0)) continue;

    const upper = entry * (1 + upMult * sigma);
    const lower = entry * (1 - downMult * sigma);

    let end = i + horizon;
    let label: 0 | 1 = 0;
    let which: 'up' | 'down' | 'time' = 'time';

    for (let j = i + 1; j <= i + horizon; j++) {
      const touchUp = candles.high[j] >= upper;
      const touchDown = candles.low[j] <= lower;
      // Aynı barda iki bariyere de değdiyse KÖTÜ olanı seçilir: bar içi sırayı
      // günlük veriden bilemeyiz, iyimser varsayım sonucu şişirir.
      if (touchDown) {
        end = j;
        label = 0;
        which = 'down';
        break;
      }
      if (touchUp) {
        end = j;
        label = 1;
        which = 'up';
        break;
      }
    }
    if (which === 'time') label = candles.close[end] > entry ? 1 : 0;

    index.push(i);
    y.push(label);
    touchedAt.push(end);
    retPct.push((candles.close[end] / entry - 1) * 100);
    hit.push(which);
  }

  return {
    index: Int32Array.from(index),
    y: Int8Array.from(y),
    touchedAt: Int32Array.from(touchedAt),
    retPct: Float64Array.from(retPct),
    hit,
  };
}

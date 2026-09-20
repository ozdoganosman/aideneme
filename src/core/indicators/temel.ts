import type { Candles } from '../data/types';
import { emaArr, rollingHighest, rollingLowest } from './calc';

/**
 * Kayıt defterinin ihtiyaç duyduğu ama çekirdekte henüz olmayan temel
 * göstergeler.
 *
 * `calc.ts` devralınan (dondurulmuş) dosya; yeni göstergeler ayrı modüllere
 * yazılıyor ki taşıma diff'i temiz kalsın (bkz. rsi.ts'in başı).
 *
 * Hepsi SAF: takvim, DOM, ağ yok; yalnızca girdiden türetiliyor. Veri
 * yetmediğinde sayı UYDURULMUYOR, NaN bırakılıyor — uygulamanın her yerinde
 * "ölçülemedi ≠ uymadı" ayrımı buna dayanıyor.
 */

/** Basit hareketli ortalama. */
export function smaArr(src: Float64Array, length: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  if (length < 1 || n < length) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += src[i];
    if (i >= length) sum -= src[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

/** Ağırlıklı hareketli ortalama (son bar en ağır). */
export function wmaArr(src: Float64Array, length: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  if (length < 1 || n < length) return out;
  const agirlikToplam = (length * (length + 1)) / 2;
  for (let i = length - 1; i < n; i++) {
    let toplam = 0;
    for (let k = 0; k < length; k++) toplam += src[i - k] * (length - k);
    out[i] = toplam / agirlikToplam;
  }
  return out;
}

/**
 * Kayan standart sapma (popülasyon).
 *
 * Toplam-kare yerine iki geçiş: kayan toplamlarla tek geçiş sayısal olarak
 * kararsız (büyük fiyatlarda kayıp anlamlı basamak üretiyor). Pencere küçük
 * olduğu için maliyet kabul edilebilir.
 */
export function stdevArr(src: Float64Array, length: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  if (length < 2 || n < length) return out;
  for (let i = length - 1; i < n; i++) {
    let ort = 0;
    for (let k = 0; k < length; k++) ort += src[i - k];
    ort /= length;
    let kare = 0;
    for (let k = 0; k < length; k++) {
      const d = src[i - k] - ort;
      kare += d * d;
    }
    out[i] = Math.sqrt(kare / length);
  }
  return out;
}

/** Stokastik %K — 0..100. */
export function stochKArr(c: Candles, length: number): Float64Array {
  const n = c.length;
  const hh = rollingHighest(c.high, length);
  const ll = rollingLowest(c.low, length);
  const out = new Float64Array(n).fill(NaN);
  // Pencere dolmadan sayı üretilmiyor (bkz. willrArr'daki ölçüm).
  for (let i = length - 1; i < n; i++) {
    const den = hh[i] - ll[i];
    // Aralık sıfırsa oran tanımsız: NaN, sıfır DEĞİL.
    out[i] = den !== 0 ? (100 * (c.close[i] - ll[i])) / den : NaN;
  }
  return out;
}

/** Denge hacmi (OBV): yön hacmi biriktirir. */
export function obvArr(c: Candles): Float64Array {
  const n = c.length;
  const out = new Float64Array(n).fill(NaN);
  if (n === 0) return out;
  let toplam = 0;
  out[0] = 0;
  for (let i = 1; i < n; i++) {
    const d = c.close[i] - c.close[i - 1];
    if (d > 0) toplam += c.volume[i];
    else if (d < 0) toplam -= c.volume[i];
    out[i] = toplam;
  }
  return out;
}

/**
 * Bar başına tipik fiyat — VWAP ve CCI gibi göstergelerin kaynağı.
 * `(yüksek + düşük + kapanış) / 3`.
 */
export function tipikFiyat(c: Candles): Float64Array {
  const n = c.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (c.high[i] + c.low[i] + c.close[i]) / 3;
  return out;
}

/**
 * Kayan VWAP: hacim ağırlıklı ortalama fiyat.
 *
 * Klasik VWAP seans başına sıfırlanır; günlük barlarda "seans" yok, bu yüzden
 * pencereli hâli kullanılıyor ve adı da bunu söylüyor.
 */
export function vwapArr(c: Candles, length: number): Float64Array {
  const n = c.length;
  const out = new Float64Array(n).fill(NaN);
  if (length < 1 || n < length) return out;
  const tp = tipikFiyat(c);
  let pv = 0;
  let v = 0;
  for (let i = 0; i < n; i++) {
    pv += tp[i] * c.volume[i];
    v += c.volume[i];
    if (i >= length) {
      pv -= tp[i - length] * c.volume[i - length];
      v -= c.volume[i - length];
    }
    // Hacim sıfırsa ağırlıklı ortalama tanımsız: NaN.
    if (i >= length - 1) out[i] = v > 0 ? pv / v : NaN;
  }
  return out;
}

/** İki diziyi çıkar (histogram gibi türevler için). */
export function farkArr(a: Float64Array, b: Float64Array): Float64Array {
  const n = Math.min(a.length, b.length);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] - b[i];
  return out;
}

/** Diziyi sabit bir katsayıyla ölçekle ve kaydır (bant hesapları için). */
export function bantArr(orta: Float64Array, sapma: Float64Array, kat: number): Float64Array {
  const n = Math.min(orta.length, sapma.length);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = orta[i] + kat * sapma[i];
  return out;
}

/** EMA'yı dışarıya da aç: kayıt defteri tek yerden okusun. */
export { emaArr };

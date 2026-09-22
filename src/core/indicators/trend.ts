import { emaArr, rollingHighest, rollingLowest } from './calc';
import { atrArr } from './rsi';
import type { Candles } from '../data/types';

/**
 * Eski sistemin taramasında kullanılan üç indikatör.
 *
 * Yeni kuralda (DSL) yoktular; bu yüzden yeni kabuğun hazır strateji listesi
 * sekiz generic kuraldan ibaretti. Oysa yayındaki tarama 27 stratejiyi 651
 * sembolde ölçüyor ve en iyisi (%R 14 > 50) sembollerin %45,8'inde al-tut'u
 * yeniyor. Eksik olan fikirler değil, bu üç indikatördü.
 *
 * Hepsi saf: takvim/DOM/ağ yok, girdiden türetiliyor.
 */

/**
 * Williams %R — 0..100 aralığına taşınmış hâli.
 *
 * Klasik %R −100..0 arasındadır; eski sistem +100 ekleyerek 0..100'e taşıyor
 * ve "%R 14 > 50" gibi kurallar bu ölçeğe göre yazılmış. Aynı ölçeği
 * koruyoruz, yoksa taşınan kuralların eşikleri anlamını yitirirdi.
 *
 * `100·(kapanış − enYüksek)/(enYüksek − enDüşük) + 100`, sadeleşince
 * `100·(kapanış − enDüşük)/(enYüksek − enDüşük)`.
 */
export function willrArr(c: Candles, length: number): Float64Array {
  const n = c.length;
  const hh = rollingHighest(c.high, length);
  const ll = rollingLowest(c.low, length);
  const out = new Float64Array(n).fill(NaN);
  /*
    PENCERE DOLMADAN sayı üretilmiyor.

    `rollingHighest`/`rollingLowest` ellerindeki kadarıyla çalışıyor ve ilk
    bardan itibaren değer veriyor — bu bir kusur değil, o ilkellerin
    sözleşmesi (eski arayüzün taraması buna dayanıyor). Ama GÖSTERGE olarak
    "%R 260" etiketiyle çizilen çizginin 260 barlık bir %R olması gerekir.

    Ölçüldü: 133 barlık bir sembolde (GENKM) SMA 260 hiç çizilmezken
    "%R 260" 133 barın HEPSİNDE sayı üretiyordu. Aynı grafikte biri
    "ölçemiyorum" derken öteki uyduruyordu; kullanıcı ikisini karşılaştırınca
    yanılırdı.
  */
  for (let i = length - 1; i < n; i++) {
    const den = hh[i] - ll[i];
    // Aralık sıfırsa (tamamen yatay pencere) oran tanımsız: sayı uydurmuyoruz.
    out[i] = den !== 0 ? (100 * (c.close[i] - ll[i])) / den : NaN;
  }
  return out;
}

/** MACD çizgisi: EMA(hızlı) − EMA(yavaş). */
export function macdArr(close: Float64Array, fast: number, slow: number): Float64Array {
  const f = emaArr(close, fast);
  const s = emaArr(close, slow);
  const out = new Float64Array(close.length);
  for (let i = 0; i < close.length; i++) out[i] = f[i] - s[i];
  return out;
}

/** MACD sinyal çizgisi: MACD'nin EMA'sı. */
export function macdSignalArr(
  close: Float64Array,
  fast: number,
  slow: number,
  signal: number,
): Float64Array {
  return emaArr(macdArr(close, fast, slow), signal);
}

/**
 * Supertrend çizgisi.
 *
 * Yükseliş trendinde fiyatın ALTINDA, düşüşte ÜSTÜNDE durur; dolayısıyla
 * "kapanış > supertrend" doğrudan "trend yukarı" demektir. Bant, trend
 * yönü değişene kadar geri çekilmez (final band mantığı) — aksi hâlde
 * çizgi her barda oynar ve sinyal gürültüye boğulurdu.
 */
export function supertrendArr(c: Candles, length: number, mult: number): Float64Array {
  const n = c.length;
  const atr = atrArr(c.high, c.low, c.close, length);
  const out = new Float64Array(n).fill(NaN);
  if (n === 0) return out;

  let finalUpper = NaN;
  let finalLower = NaN;
  let up = true; // trend yönü

  for (let i = 0; i < n; i++) {
    const mid = (c.high[i] + c.low[i]) / 2;
    const band = mult * atr[i];
    const basicUpper = mid + band;
    const basicLower = mid - band;

    if (!Number.isFinite(basicUpper) || !Number.isFinite(basicLower)) {
      out[i] = NaN;
      continue;
    }

    const prevClose = i > 0 ? c.close[i - 1] : NaN;
    finalUpper =
      !Number.isFinite(finalUpper) || basicUpper < finalUpper || prevClose > finalUpper
        ? basicUpper
        : finalUpper;
    finalLower =
      !Number.isFinite(finalLower) || basicLower > finalLower || prevClose < finalLower
        ? basicLower
        : finalLower;

    if (c.close[i] > finalUpper) up = true;
    else if (c.close[i] < finalLower) up = false;

    out[i] = up ? finalLower : finalUpper;
  }
  return out;
}

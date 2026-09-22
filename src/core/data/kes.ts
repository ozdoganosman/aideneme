import type { Candles } from './types';

/**
 * SERİYİ BİR ZAMANA KADAR KES — zaman makinesinin ilkeli.
 *
 * "N gün öncesine git" demek, seriyi o güne kadar olan barlarla sınırlamak
 * demek; sonrası hesaba GİRMEMELİ, yoksa geçmişe bakarken geleceği görmüş
 * oluruz (look-ahead).
 *
 * BAR İNDEKSİYLE DEĞİL ZAMANLA kesiliyor ve bu bir tercih değil, zorunluluk:
 * paket her sembolü kendi sonlu kapanışlarına sıkıştırıyor, yani "sondan k.
 * bar" boşluğu olan sembolde başka bir takvim gününe düşer. Ölçüldü: ISKUR
 * son 250 günde 33 bar işlem görmüş; onun "50 bar öncesi" yok bile, THYAO'nun
 * "50 bar öncesi" ise iki ay önce. Aynı "gün" tüm sembollerde aynı tarih
 * olmalı ki karşılaştırma anlamlı olsun.
 *
 * Kopya yok: `subarray` aynı belleğe bakan görünüm veriyor. 600 sembolü her
 * kaydırıcı adımında kopyalamak zayıf makinede bedelini hissettirirdi.
 */

/** `time <= tCut` olan son barın indeksi (+1 = uzunluk); hiç yoksa 0. */
export function kesimIndeksi(c: Candles, tCut: number): number {
  let lo = 0;
  let hi = c.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (c.time[mid] <= tCut) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Seriyi `tCut` dahil o ana kadar olan barlarla sınırlar. Bar yoksa uzunluk 0. */
export function kesZaman(c: Candles, tCut: number): Candles {
  const n = kesimIndeksi(c, tCut);
  if (n === c.length) return c;
  return {
    time: c.time.subarray(0, n),
    open: c.open.subarray(0, n),
    high: c.high.subarray(0, n),
    low: c.low.subarray(0, n),
    close: c.close.subarray(0, n),
    volume: c.volume.subarray(0, n),
    length: n,
  };
}

/**
 * Kesim anından serinin SON barına yüzde getiri.
 *
 * "Son bar" sembolün kendi son sonlu kapanışı — bugünün ekseni değil. Bayat
 * bir sembolde bu tarih bugünden eski olur ve bu dürüst bir sayıdır: o
 * sembol o günden sonra işlem görmemiş, "bugüne" getirisi tanımsız.
 *
 * Kesim barı yoksa ya da fiyat pozitif değilse NaN — sayı uydurulmuyor.
 */
export function ileriGetiri(c: Candles, tCut: number): number {
  const n = kesimIndeksi(c, tCut);
  if (n === 0 || n >= c.length) return Number.NaN;
  const taban = c.close[n - 1];
  const son = c.close[c.length - 1];
  if (!(taban > 0) || !Number.isFinite(son)) return Number.NaN;
  return (son / taban - 1) * 100;
}

/**
 * Türkçe sayı biçimleri — tek kaynak.
 *
 * Uygulama karışık konuşuyordu: fiyat `127,63` (Türkçe, virgül) ama yüzde
 * `+3.61%` (İngilizce, nokta ve sondan işaret). Aynı satırda iki farklı
 * yazım, kullanıcıya "bu ekran yarım kalmış" dedirtir; dahası ondalık virgülle
 * noktanın karışması gerçek bir yanlış okuma riskidir.
 *
 * Türkçe kurallar: ondalık ayırıcı virgül, binlik nokta, yüzde işareti sayının
 * ÖNÜNDE (%3,61). İşaret yüzde işaretinden de önce gelir: +%3,61 / -%3,61.
 */

const nf = (digits: number) =>
  new Intl.NumberFormat('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Düz sayı: 1234.5 → "1.234,50" (digits = 2). */
export function trNum(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return value === Infinity ? '∞' : '—';
  return nf(digits).format(value);
}

/**
 * Yüzde. `signed` ile artı işareti de yazılır (getiri gibi yönü olan
 * değerlerde); oran/pay gibi işaretsiz değerlerde kapalı bırakılır.
 */
export function trPct(value: number, digits = 2, signed = false): string {
  if (!Number.isFinite(value)) return value === Infinity ? '∞' : '—';
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : '';
  return `${sign}%${nf(digits).format(Math.abs(value))}`;
}

/** Para/hacim: kısaltmasız, binlik ayırıcılı. */
export function trAmount(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return nf(digits).format(value);
}

/**
 * Kısaltılmış para/hacim: 16.600.000.000 → "16,6 mlr".
 *
 * Nabız ekranının içinde yerel bir kopyası vardı; tarayıcıya işlem değeri
 * sütunu gelince ikinci bir kopya gerekecekti. İki kopya iki farklı eşik
 * demektir — biçim kurallarının tek kaynakta durması gerekiyor.
 *
 * Negatifi de doğru kısaltıyor: yerel kopya negatif değerde kısaltmayı
 * atlayıp tam sayıya düşüyordu (para akışı farkı gibi işaretli bir değer
 * geldiğinde aynı sütunda iki ayrı biçim görünürdü).
 */
export function trCompact(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return value === Infinity ? '∞' : '—';
  const sign = value < 0 ? '-' : '';
  const v = Math.abs(value);
  if (v >= 1e9) return `${sign}${nf(digits).format(v / 1e9)} mlr`;
  if (v >= 1e6) return `${sign}${nf(digits).format(v / 1e6)} mn`;
  if (v >= 1e3) return `${sign}${nf(digits).format(v / 1e3)} b`;
  return `${sign}${nf(0).format(v)}`;
}

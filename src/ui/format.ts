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

/**
 * Biçimlendirici ÖNBELLEKTE.
 *
 * `new Intl.NumberFormat(...)` her çağrıda kurulmak zorunda değil ve kurulumu
 * biçimlendirmenin yanında çok pahalı. Ölçüldü (6× yavaşlatılmış işlemci,
 * 2000 çağrı): her çağrıda yeniden kurmak 490 ms, önbellekli 12 ms — 41 kat.
 *
 * Bu fonksiyon uygulamanın HER sayısını yazıyor: tarayıcı tablosunda tek
 * çizimde 346 hücre, ısı haritasında 582 etiket, radar ve finansallar
 * tablolarında yüzlerce daha. Basamak sayısı küçük bir küme (0–3), yani
 * önbellek de küçük kalıyor.
 */
const bicimler = new Map<number, Intl.NumberFormat>();

const nf = (digits: number): Intl.NumberFormat => {
  let f = bicimler.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    bicimler.set(digits, f);
  }
  return f;
};

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

/**
 * Eksen etiketi: birim BÜYÜKLÜKTEN, ondalık basamak ARALIKTAN.
 *
 * `trCompact` tek bir sayıyı biçimlendirmek için doğru ama eksende yanlış
 * sonuç veriyordu. Ölçüldü: satış serisi 1.900–2.500 b aralığındayken beş
 * ızgara çizgisinin BEŞİ de "2 b" yazıyordu — aynı şeyi yazan bir eksen
 * hiçbir şey söylemez, hatta serinin yatay olduğu izlenimini verir.
 *
 * Basamak sayısı iki komşu çizginin FARKINDAN türetiliyor: adım birimin
 * onda birinden küçükse bir, yüzde birinden küçükse iki basamak. Böylece
 * etiketler birbirinden ayrılıyor ve gereksiz sıfır da eklenmiyor.
 *
 * Sınır: üç basamakta duruluyor. Aralık bundan da darsa (örneğin 2 milyarda
 * 4 bin) etiketler yine aynı çıkar — o oranda bir seriyi ayırmak dokuz
 * basamak isterdi ve finansal tabloda böyle bir seri yok. Sınır kabul
 * ediliyor, gizlenmiyor.
 */
export function axisLabel(value: number, span: number): string {
  if (!Number.isFinite(value)) return '—';
  const v = Math.abs(value);
  const bolen = v >= 1e9 ? 1e9 : v >= 1e6 ? 1e6 : v >= 1e3 ? 1e3 : 1;
  // Adım = dört aralıklı ızgarada iki komşu çizgi arası.
  const adim = Math.abs(span) / 4 / bolen;
  const basamak = adim === 0 ? 0 : adim < 0.01 ? 3 : adim < 0.1 ? 2 : adim < 1 ? 1 : 0;
  return trCompact(value, Math.min(3, basamak));
}

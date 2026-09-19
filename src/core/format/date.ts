/**
 * Türkçe tarih biçimi — TEK kaynak.
 *
 * Üründe iki tarih biçimi yan yana duruyordu: tazelik rozeti "11 Eyl 2026"
 * derken rapor, portföy, laboratuvar, model ve grafik ekseni "2026-09-11"
 * yazıyordu. Ölçüldü: on ayrı yerde ISO, bir yerde Türkçe. Bu, ondalık
 * virgül kusurunun aynısı — sayılar tek kaynağa toplanmıştı, tarihler
 * atlanmıştı.
 *
 * ISO okunamaz değil ama Türkçe bir arayüzde makine çıktısı gibi durur ve
 * aynı ekranda iki biçim görmek ürünün kendi içinde tutarsız olduğunu
 * söyler.
 *
 * NEREDE KULLANILMAZ: `<input type="date">` değeri ISO olmak ZORUNDA
 * (HTML sözleşmesi) ve kayıt anahtarları da biçim değiştiremez. O
 * kullanımlar bilerek ISO kalıyor.
 *
 * `timeZone: 'UTC'` şart: barlar UTC gün sınırında saklanıyor, yerel saate
 * çevirmek Türkiye'nin doğusunda bir günlük kayma üretirdi.
 */

const TR_GUN = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Unix SANİYE → "28 Eyl 2025". */
export function trDay(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  return TR_GUN.format(new Date(seconds * 1000));
}

/** Epoch'tan beri GÜN sayısı → "28 Eyl 2025". */
export function trDayIndex(days: number): string {
  if (!Number.isFinite(days)) return '—';
  return TR_GUN.format(new Date(days * 86_400_000));
}

/**
 * Unix SANİYE → "2025-09-28".
 *
 * Makineye giden tarihler için: `<input type="date">` değeri, kayıt
 * anahtarı, paylaşılan bağlantı. Görüntü için `trDay` kullanılmalı.
 */
export function isoDay(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

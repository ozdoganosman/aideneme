/**
 * Tarayıcıda saklanan kullanıcı tercihleri.
 *
 * Neden sarmalayıcı: `localStorage` erişimi İSTİSNA ATABİLİR — Safari özel
 * sekmesinde yazma `QuotaExceededError` veriyor ve korumasız bir çağrı
 * uygulamayı hiç açılmaz hâle getiriyordu (yayındaki uygulamada ölçüldü:
 * 0 canvas, boş sayfa). Tercih kaydedilemeyebilir; ekran çalışmaya devam
 * etmek zorunda.
 *
 * Okunan değer KULLANICI VERİSİDİR, doğrulanması çağıranın işi: eski bir
 * sürümden kalan bozuk kayıt tipi tutmayabilir.
 */
export function tercihOku<T>(anahtar: string, varsayilan: T): T {
  try {
    const ham = localStorage.getItem(anahtar);
    if (!ham) return varsayilan;
    return JSON.parse(ham) as T;
  } catch {
    return varsayilan;
  }
}

export function tercihYaz(anahtar: string, deger: unknown): void {
  try {
    localStorage.setItem(anahtar, JSON.stringify(deger));
  } catch {
    // Depolama kapalı ya da dolu: tercih kaydedilmiyor, ekran çalışmaya devam.
  }
}

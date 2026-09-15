/**
 * localStorage sarmalayıcısı.
 *
 * Depolama HER ZAMAN çalışmaz: Safari özel sekmesinde `setItem` istisna
 * fırlatır, kota dolabilir, gizlilik eklentisi erişimi kesebilir. Yayındaki
 * uygulama bu durumda BOŞ SAYFA açıyordu — ilk yazma render sırasında patlıyor
 * ve React ağacı çöküyordu (ölçüldü: 0 canvas, 0 araç çubuğu).
 *
 * Kural: tercih saklamak bir KOLAYLIKTIR, uygulamanın çalışma şartı değil.
 * Yazma başarısızsa sessizce vazgeçilir; okuma başarısızsa varsayılan döner.
 */

export function lsRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Ham metin okuma (JSON değil). */
export function lsReadRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsWrite(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    /* depolama yoksa tercih saklanmaz; uygulama çalışmaya devam eder */
  }
}

export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* yukarıdaki gerekçe */
  }
}

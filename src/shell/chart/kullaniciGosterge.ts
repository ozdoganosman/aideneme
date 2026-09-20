import type { SayiParametresi } from '../../core/indicators/kayit';
import { tercihOku, tercihYaz } from '../tercih';

/**
 * Kullanıcının kendi yazdığı göstergeler — kayıt ve kimlik.
 *
 * Barındırılan göstergelerle AYNI listede görünüyorlar ama kimlikleri önekli:
 * bir örneğin hangi kaynaktan hesaplanacağı (analiz worker'ı mı, yalıtılmış
 * gösterge worker'ı mı) kimliğe bakılarak anlaşılıyor. Ayrı bir alan
 * tutmak, kayıtlı örneklerin göç etmesini gerektirirdi.
 */

export const KULLANICI_ONEK = 'kul:';

export interface KullaniciGostergesi {
  /** `kul:` önekli benzersiz kimlik. */
  id: string;
  ad: string;
  kisa: string;
  panel: 'fiyat' | 'ayri';
  parametreler: SayiParametresi[];
  /** Kullanıcının yazdığı JavaScript kaynağı. */
  kaynak: string;
}

export function kullaniciMi(id: string): boolean {
  return id.startsWith(KULLANICI_ONEK);
}

export function yeniKullaniciId(): string {
  return `${KULLANICI_ONEK}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const ANAHTAR = 'gosterge.kullanici.v1';

export function kullaniciGostergeleriOku(): KullaniciGostergesi[] {
  const ham = tercihOku<KullaniciGostergesi[]>(ANAHTAR, []);
  // Kayıt bozuksa (elle düzenlenmiş, eski sürüm) ekran çökmesin: şekli
  // tutmayan girdiler sessizce elenmiyor, AYIKLANIYOR — kullanıcı kalanını
  // görmeye devam ediyor.
  if (!Array.isArray(ham)) return [];
  return ham.filter(
    (g): g is KullaniciGostergesi =>
      !!g &&
      typeof g.id === 'string' &&
      kullaniciMi(g.id) &&
      typeof g.kaynak === 'string' &&
      typeof g.ad === 'string' &&
      Array.isArray(g.parametreler),
  );
}

export function kullaniciGostergeleriYaz(liste: KullaniciGostergesi[]): void {
  tercihYaz(ANAHTAR, liste);
}

/** Yeni bir gösterge yazmaya başlayan kullanıcıya verilen iskelet. */
export const ORNEK_KAYNAK = `({
  ad: 'Benim Ortalamam',
  kisa: 'BO',
  // 'fiyat' → mumların üstüne çizilir, 'ayri' → kendi paneline.
  panel: 'fiyat',
  parametreler: [
    { ad: 'uzunluk', etiket: 'Uzunluk', varsayilan: 20, min: 2, max: 400 },
  ],
  // Çizgilerin adı, rengi ve türü. token: accent | warn | up | down | muted
  ciktilar: (p) => [
    { ad: 'orta', etiket: 'BO ' + p.uzunluk, tur: 'cizgi', token: 'accent' },
  ],
  // c: { open, high, low, close, volume, time, length } — hepsi Float64Array
  // lib: ema, sma, wma, rsi, atr, adx, roc, macd, vwma, vwap, stdev, stoch,
  //      obv, willr, supertrend, enYuksek, enDusuk, tipikFiyat, fark, bant
  hesapla: (c, p, lib) => [lib.sma(c.close, p.uzunluk)],
})`;

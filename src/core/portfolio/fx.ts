/**
 * Kur serisi ve döviz bazlı getiri.
 *
 * Türkiye'de "TL'de %40 kazandım" tek başına eksik bir cümledir: aynı dönemde
 * kur %60 arttıysa dolar bazında kaybedilmiştir. Reel (TÜFE) getiri bunun bir
 * cevabı, döviz bazı ikinci bir cevabı — ikisi farklı soruları yanıtlar ve
 * biri diğerinin yerine geçmez.
 *
 * Kur serisi UYDURULMAZ: veri hattından gelir (`public/data/<piyasa>/fx.json`).
 * Dosya yoksa bu katman boş döner ve arayüz "kur serisi yok" der — hafızadan
 * yazılmış bir kur tablosu, yanlış olduğunda sessizce yanlış bir getiri
 * gösterirdi.
 */

export interface FxSeries {
  /** Kur kaynağı (ör. "TCMB") ve üretim zamanı — ekranda gösterilir. */
  source: string;
  generated: number;
  /** Para birimi kodu; şimdilik tek seri (ör. "USD"). */
  currency: string;
  /** Artan epoch gün ekseni. */
  days: number[];
  /** 1 birim dövizin TL karşılığı (days ile aynı uzunlukta). */
  rates: number[];
}

export function isFxSeries(value: unknown): value is FxSeries {
  if (!value || typeof value !== 'object') return false;
  const f = value as Partial<FxSeries>;
  return (
    typeof f.source === 'string' &&
    typeof f.currency === 'string' &&
    Array.isArray(f.days) &&
    Array.isArray(f.rates) &&
    f.days.length === f.rates.length &&
    f.days.length > 0
  );
}

/**
 * Verilen güne ait kur. Tam eşleşme yoksa SON BİLİNEN kur kullanılır (ileri
 * doğru taşıma); enterpolasyon YAPILMAZ çünkü kur, iki gün arasında düz bir
 * çizgi izlemez ve ara değer uydurmak olmayan bir fiyat üretir.
 *
 * Serinin başlangıcından önceki günler için NaN döner: o tarihte kuru
 * bilmiyoruz ve "en eski kuru" kullanmak geçmişi çarpıtır.
 */
export function rateAt(fx: FxSeries, day: number): number {
  if (day < fx.days[0]) return NaN;
  // İkili arama: seri uzun olabilir ve bu fonksiyon bar başına çağrılır.
  let lo = 0;
  let hi = fx.days.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fx.days[mid] <= day) lo = mid;
    else hi = mid - 1;
  }
  return fx.rates[lo];
}

export interface BasisReturn {
  /** Başlangıç ve bitiş değeri, seçilen para biriminde. */
  from: number;
  to: number;
  returnPct: number;
  /** Kullanılan kurlar — ekranda gösterilir ki sayı denetlenebilsin. */
  rateFrom: number;
  rateTo: number;
}

/**
 * TL tutarları döviz bazına çevirip getiriyi hesaplar.
 *
 * @param valueFrom başlangıç değeri (TL)
 * @param valueTo   bitiş değeri (TL)
 */
export function returnInCurrency(
  fx: FxSeries | null,
  dayFrom: number,
  dayTo: number,
  valueFrom: number,
  valueTo: number,
): BasisReturn | null {
  if (!fx) return null;
  // Başlangıç, bitişten SONRA olamaz. Bayat fiyat verisinde bugün girilen bir
  // işlem bu durumu yaratıyor; iki uçta da son bilinen kur kullanılırsa kur
  // etkisi sıfırlanır ve TL getirisi "döviz getirisi" diye gösterilirdi.
  if (dayFrom > dayTo) return null;
  const rateFrom = rateAt(fx, dayFrom);
  const rateTo = rateAt(fx, dayTo);
  if (!Number.isFinite(rateFrom) || !Number.isFinite(rateTo)) return null;
  if (!(rateFrom > 0) || !(rateTo > 0)) return null;

  const from = valueFrom / rateFrom;
  const to = valueTo / rateTo;
  return {
    from,
    to,
    returnPct: from > 0 ? (to / from - 1) * 100 : NaN,
    rateFrom,
    rateTo,
  };
}

/** Serinin kapsadığı gün aralığı — "kur bu tarihten önce bilinmiyor" demek için. */
export function fxRange(fx: FxSeries | null): { first: number; last: number } | null {
  if (!fx) return null;
  return { first: fx.days[0], last: fx.days[fx.days.length - 1] };
}

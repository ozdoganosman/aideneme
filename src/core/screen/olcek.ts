/**
 * KARŞILAŞTIRMA ÖLÇEĞİ.
 *
 * Kullanıcı isteği "göstergeler birbirleriyle kıyaslanıp da filtrelenebilsin"
 * idi. Ama iki sayıyı karşılaştırabilmek onları karşılaştırmaya DEĞER
 * kılmıyor: "%R 260 > EMA 200" ifadesi tip olarak geçerli (iki sayı), anlam
 * olarak saçma — biri 0..100 arası bir konum, öteki lira cinsinden bir fiyat.
 * Böyle bir filtre hata vermez, sessizce ya hep ya hiç sonuç döndürür ve
 * kullanıcı yanlış olduğunu ANLAYAMAZ.
 *
 * Bu yüzden her ölçüt bir ölçek etiketi taşıyor ve kıyas yalnızca AYNI ölçek
 * içinde kuruluyor. Arayüz de B tarafına yalnızca uyumlu ölçütleri listeliyor;
 * yani saçma kıyas kurulamıyor, "kurulduktan sonra uyarılmıyor".
 *
 * Ölçek birimle aynı şey değil: ATR ile EMA'nın ikisi de liradır ama biri
 * MESAFE öteki SEVİYEDİR; "ATR > EMA" anlamsızdır. Bu yüzden ayrı ölçekler.
 */
export type Olcek =
  /** Fiyat seviyesi (lira): kapanış, EMA, SMA, VWAP, Bollinger, Supertrend. */
  | 'fiyat'
  /** Fiyat farkı/mesafesi (lira): ATR, MACD ve dalları. */
  | 'fiyatFarki'
  /** Yüzde değişim, sınırsız: ROC, dönemsel getiriler, EMA uzaklığı. */
  | 'yuzde'
  /** 0..100 arası bağlı salınım: RSI, %R, Stokastik, ADX. */
  | 'yuzde0100'
  /** Katsayı: hacim oranı gibi birimsiz oranlar. */
  | 'oran'
  /** Para hacmi (işlem tutarı). */
  | 'para'
  /** Pay adedi biriktiren seriler: OBV. */
  | 'hacim';

/** Kıyas kutusunda görünen ölçek adı — neden kıyaslanamadığını anlatır. */
export const OLCEK_ADI: Record<Olcek, string> = {
  fiyat: 'fiyat seviyesi',
  fiyatFarki: 'fiyat farkı',
  yuzde: 'yüzde değişim',
  yuzde0100: '0–100 salınım',
  oran: 'katsayı',
  para: 'işlem tutarı',
  hacim: 'hacim',
};

/**
 * Hazır radar ölçütlerinin birimini ölçeğe çevirir.
 *
 * Böylece grafikteki gösterge, radarın kendi ölçütleriyle de kıyaslanabiliyor
 * ve en çok istenen filtre ("Fiyat > EMA 200") tek kutuda kuruluyor: `last`
 * birimi `price`, EMA'nın ölçeği `fiyat` — ikisi aynı kovaya düşüyor.
 */
export function birimdenOlcek(unit: 'pct' | 'price' | 'ratio' | 'level' | 'money'): Olcek {
  switch (unit) {
    case 'price':
      return 'fiyat';
    case 'pct':
      return 'yuzde';
    case 'level':
      return 'yuzde0100';
    case 'money':
      return 'para';
    case 'ratio':
      return 'oran';
  }
}

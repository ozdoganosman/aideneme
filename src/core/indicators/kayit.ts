/**
 * İNDİKATÖR KAYIT DEFTERİ.
 *
 * Önce sistem sabitti: iki fiyat EMA'sı ve iki panel (Williams %R, MACD),
 * parametreleri de düz bir yapıda (`IndicatorParams`) on üç sayı olarak
 * duruyordu. Yeni bir gösterge eklemek dört ayrı dosyaya dokunmayı
 * gerektiriyordu — tip, varsayılanlar, worker, arayüz.
 *
 * Kullanıcı isteği: "indikatör sistemini trading view gibi yapabilir miyiz,
 * arama butonu orada indikatörler; indikatörün ayar kısmında parametrelerin
 * değiştirilebilmesi; temel indikatörlerin barındırılması".
 *
 * Bu dosya bunun çekirdeği: her gösterge KENDİ parametre şemasını, kendi
 * çıktılarını ve kendi hesabını taşıyor. Arayüz listeyi buradan okuyor, ayar
 * kutusunu şemadan ÜRETİYOR; worker da aynı defteri kullanıyor. Yeni gösterge
 * eklemek tek bir kayıt yazmak demek.
 *
 * TAMAMEN SAF: DOM, ağ, takvim yok. Bu yüzden hem worker'da hem testte
 * koşuyor ve ileride kullanıcı göstergeleri de aynı sözleşmeye oturacak.
 */

/** Tema renk tokenı — gerçek renge arayüz katmanında çevriliyor. */
export type RenkToken = 'accent' | 'warn' | 'up' | 'down' | 'muted' | 'text';

export type CizimTuru = 'cizgi' | 'sutun';

export interface SayiParametresi {
  ad: string;
  etiket: string;
  varsayilan: number;
  min: number;
  max: number;
  /** Tam sayı mı (uzunluklar) yoksa ondalıklı mı (çarpanlar). */
  ondalik?: boolean;
}

export interface CikisTanimi {
  ad: string;
  /** Çizgi etiketi; parametreye bağlı olabilir (örn. "EMA 50"). */
  etiket: string;
  tur: CizimTuru;
  token: RenkToken;
  /** Sabit yatay eşik (örn. RSI'da 50). */
  taban?: number;
  /** Histogramı yönüne göre renklendir. */
  yonRengi?: boolean;
}

export type Parametreler = Record<string, number>;

export interface IndikatorTanimi {
  id: string;
  /** Listede görünen tam ad. */
  ad: string;
  /** Grafik üstündeki kısa ad. */
  kisa: string;
  kategori: 'Trend' | 'Momentum' | 'Oynaklık' | 'Hacim';
  /** Fiyatla aynı eksende mi, ayrı panelde mi. */
  panel: 'fiyat' | 'ayri';
  /** Aramada eşleşecek ek kelimeler (kısaltmalar, İngilizce adlar). */
  arama: string[];
  parametreler: SayiParametresi[];
  /**
   * Çıktı tanımları — `HESAPLAR` içindeki hesabın döndürdüğü diziler ile
   * AYNI sırada.
   *
   * Hesabın kendisi bu dosyada DEĞİL (bkz. kayitHesap.ts): yalnızca worker'da
   * lazım, arayüz ise tanımları çip etiketi ve ayar kutusu için okuyor.
   */
  ciktilar: (p: Parametreler) => CikisTanimi[];
}

/** Bir tanımın varsayılan parametreleri. */
export function varsayilanParametreler(t: IndikatorTanimi): Parametreler {
  const out: Parametreler = {};
  for (const p of t.parametreler) out[p.ad] = p.varsayilan;
  return out;
}

/**
 * Parametreyi şemaya göre sınırla.
 *
 * Kullanıcı kutuya elle yazabiliyor; uzunluk 0 ya da negatif gelirse gösterge
 * sessizce boş dizi döndürür ve ekranda "çizilmedi mi, veri mi yok" ayırt
 * edilemez. Sınır burada, tek yerde.
 */
export function parametreSinirla(t: IndikatorTanimi, p: Parametreler): Parametreler {
  const out: Parametreler = {};
  for (const s of t.parametreler) {
    const ham = p[s.ad];
    const v = Number.isFinite(ham) ? ham : s.varsayilan;
    const sinirli = Math.min(s.max, Math.max(s.min, v));
    out[s.ad] = s.ondalik ? sinirli : Math.round(sinirli);
  }
  return out;
}

const uzunluk = (
  ad: string,
  etiket: string,
  varsayilan: number,
  min = 1,
  max = 1000,
): SayiParametresi => ({ ad, etiket, varsayilan, min, max });

const carpan = (ad: string, etiket: string, varsayilan: number): SayiParametresi => ({
  ad,
  etiket,
  varsayilan,
  min: 0.1,
  max: 10,
  ondalik: true,
});

/**
 * TEMEL GÖSTERGELER.
 *
 * "260 günlük paradigma" varsayılanları (Williams %R 260/260/120, MACD
 * 120/260/50/185) BİREBİR korundu: eski sabit sistemde ekranda ne görünüyorsa
 * burada da o görünüyor. Kullanıcının kurduğu okuma alışkanlığını bir
 * yeniden yapılandırma sessizce değiştirmemeli.
 */
export const INDIKATORLER: IndikatorTanimi[] = [
  {
    id: 'ema',
    ad: 'Üstel Hareketli Ortalama',
    kisa: 'EMA',
    kategori: 'Trend',
    panel: 'fiyat',
    arama: ['ema', 'exponential moving average', 'ortalama', 'hareketli'],
    parametreler: [uzunluk('uzunluk', 'Uzunluk', 50)],
    ciktilar: (p) => [{ ad: 'ema', etiket: `EMA ${p.uzunluk}`, tur: 'cizgi', token: 'accent' }],
  },
  {
    id: 'sma',
    ad: 'Basit Hareketli Ortalama',
    kisa: 'SMA',
    kategori: 'Trend',
    panel: 'fiyat',
    arama: ['sma', 'simple moving average', 'ortalama'],
    parametreler: [uzunluk('uzunluk', 'Uzunluk', 50)],
    ciktilar: (p) => [{ ad: 'sma', etiket: `SMA ${p.uzunluk}`, tur: 'cizgi', token: 'warn' }],
  },
  {
    id: 'wma',
    ad: 'Ağırlıklı Hareketli Ortalama',
    kisa: 'WMA',
    kategori: 'Trend',
    panel: 'fiyat',
    arama: ['wma', 'weighted moving average', 'ağırlıklı'],
    parametreler: [uzunluk('uzunluk', 'Uzunluk', 50)],
    ciktilar: (p) => [{ ad: 'wma', etiket: `WMA ${p.uzunluk}`, tur: 'cizgi', token: 'up' }],
  },
  {
    id: 'vwap',
    ad: 'Hacim Ağırlıklı Ortalama Fiyat (pencereli)',
    kisa: 'VWAP',
    kategori: 'Hacim',
    panel: 'fiyat',
    arama: ['vwap', 'volume weighted', 'hacim ağırlıklı'],
    parametreler: [uzunluk('uzunluk', 'Uzunluk', 20)],
    ciktilar: (p) => [{ ad: 'vwap', etiket: `VWAP ${p.uzunluk}`, tur: 'cizgi', token: 'accent' }],
  },
  {
    id: 'bollinger',
    ad: 'Bollinger Bantları',
    kisa: 'BB',
    kategori: 'Oynaklık',
    panel: 'fiyat',
    arama: ['bollinger', 'bb', 'bant', 'band', 'volatilite'],
    parametreler: [uzunluk('uzunluk', 'Uzunluk', 20), carpan('kat', 'Sapma katsayısı', 2)],
    ciktilar: (p) => [
      { ad: 'ust', etiket: `BB üst ${p.uzunluk}`, tur: 'cizgi', token: 'muted' },
      { ad: 'orta', etiket: `BB orta ${p.uzunluk}`, tur: 'cizgi', token: 'accent' },
      { ad: 'alt', etiket: `BB alt ${p.uzunluk}`, tur: 'cizgi', token: 'muted' },
    ],
  },
  {
    id: 'supertrend',
    ad: 'Supertrend',
    kisa: 'ST',
    kategori: 'Trend',
    panel: 'fiyat',
    arama: ['supertrend', 'süpertrend', 'atr trend'],
    parametreler: [uzunluk('uzunluk', 'ATR uzunluğu', 10), carpan('kat', 'Çarpan', 3)],
    ciktilar: (p) => [
      { ad: 'st', etiket: `Supertrend ${p.uzunluk}×${p.kat}`, tur: 'cizgi', token: 'up' },
    ],
  },
  {
    id: 'rsi',
    ad: 'Göreli Güç Endeksi',
    kisa: 'RSI',
    kategori: 'Momentum',
    panel: 'ayri',
    arama: ['rsi', 'relative strength', 'göreli güç'],
    parametreler: [uzunluk('uzunluk', 'Uzunluk', 14)],
    ciktilar: (p) => [
      { ad: 'rsi', etiket: `RSI ${p.uzunluk}`, tur: 'cizgi', token: 'accent', taban: 50 },
    ],
  },
  {
    id: 'wr',
    ad: 'Williams %R',
    kisa: '%R',
    kategori: 'Momentum',
    panel: 'ayri',
    arama: ['williams', 'wr', '%r', 'percent r'],
    parametreler: [
      uzunluk('uzunluk', 'Uzunluk', 260),
      uzunluk('emaYavas', 'EMA yavaş', 260),
      uzunluk('emaHizli', 'EMA hızlı', 120),
    ],
    ciktilar: (p) => [
      { ad: 'r', etiket: `%R ${p.uzunluk}`, tur: 'cizgi', token: 'accent', taban: 50 },
      { ad: 'emaYavas', etiket: `EMA ${p.emaYavas}`, tur: 'cizgi', token: 'warn' },
      { ad: 'emaHizli', etiket: `EMA ${p.emaHizli}`, tur: 'cizgi', token: 'muted' },
    ],
  },
  {
    id: 'stoch',
    ad: 'Stokastik',
    kisa: 'Stoch',
    kategori: 'Momentum',
    panel: 'ayri',
    arama: ['stokastik', 'stochastic', 'stoch', 'k d'],
    parametreler: [uzunluk('uzunluk', '%K uzunluğu', 14), uzunluk('d', '%D yumuşatma', 3)],
    ciktilar: (p) => [
      { ad: 'k', etiket: `%K ${p.uzunluk}`, tur: 'cizgi', token: 'accent', taban: 50 },
      { ad: 'd', etiket: `%D ${p.d}`, tur: 'cizgi', token: 'warn' },
    ],
  },
  {
    id: 'macd',
    ad: 'MACD',
    kisa: 'MACD',
    kategori: 'Momentum',
    panel: 'ayri',
    arama: ['macd', 'moving average convergence'],
    parametreler: [
      uzunluk('hizli', 'Hızlı', 12),
      uzunluk('yavas', 'Yavaş', 26),
      uzunluk('sinyal', 'Sinyal', 9),
    ],
    ciktilar: () => [
      { ad: 'hist', etiket: 'Histogram', tur: 'sutun', token: 'muted', taban: 0, yonRengi: true },
      { ad: 'macd', etiket: 'MACD', tur: 'cizgi', token: 'accent' },
      { ad: 'sinyal', etiket: 'Sinyal', tur: 'cizgi', token: 'warn' },
    ],
  },
  {
    id: 'macdNizami',
    ad: 'MACD (NizamiCedid)',
    kisa: 'nMACD',
    kategori: 'Momentum',
    panel: 'ayri',
    arama: ['macd', 'nizami', 'cedid', '260'],
    parametreler: [
      uzunluk('hizli', 'Hızlı', 120),
      uzunluk('yavas', 'Yavaş', 260),
      uzunluk('sinyal', 'Sinyal', 50),
      uzunluk('vwma', 'eMACD VWMA', 185),
    ],
    ciktilar: () => [
      { ad: 'hist', etiket: 'Histogram', tur: 'sutun', token: 'muted', taban: 0, yonRengi: true },
      { ad: 'macd', etiket: 'MACD', tur: 'cizgi', token: 'accent' },
      { ad: 'sinyal', etiket: 'Sinyal', tur: 'cizgi', token: 'warn' },
      { ad: 'emacd', etiket: 'eMACD', tur: 'cizgi', token: 'down' },
    ],
    /*
      ÖLÇEKTEN ARINDIRILMIŞ: seriler hızlı EMA'ya bölünüyor. Ham MACD fiyat
      birimindedir; 3 TL'lik hisseyle 300 TL'lik hisse aynı eksende
      karşılaştırılamaz. Eski sabit sistemde de böyleydi, korunuyor.
    */
  },
  {
    id: 'adx',
    ad: 'Ortalama Yön Endeksi',
    kisa: 'ADX',
    kategori: 'Trend',
    panel: 'ayri',
    arama: ['adx', 'average directional', 'yön endeksi', 'trend gücü'],
    parametreler: [uzunluk('uzunluk', 'Uzunluk', 14), uzunluk('ema', 'EMA yumuşatma', 14)],
    ciktilar: (p) => [
      { ad: 'adx', etiket: `ADX ${p.uzunluk}`, tur: 'cizgi', token: 'accent', taban: 25 },
      { ad: 'ema', etiket: `EMA ${p.ema}`, tur: 'cizgi', token: 'warn' },
    ],
  },
  {
    id: 'atr',
    ad: 'Ortalama Gerçek Aralık',
    kisa: 'ATR',
    kategori: 'Oynaklık',
    panel: 'ayri',
    arama: ['atr', 'average true range', 'oynaklık', 'volatilite'],
    parametreler: [uzunluk('uzunluk', 'Uzunluk', 14)],
    ciktilar: (p) => [{ ad: 'atr', etiket: `ATR ${p.uzunluk}`, tur: 'cizgi', token: 'down' }],
  },
  {
    id: 'roc',
    ad: 'Değişim Oranı (Momentum)',
    kisa: 'ROC',
    kategori: 'Momentum',
    panel: 'ayri',
    arama: ['roc', 'rate of change', 'momentum', 'değişim'],
    parametreler: [uzunluk('uzunluk', 'Uzunluk', 260), uzunluk('ema', 'EMA yumuşatma', 120)],
    ciktilar: (p) => [
      { ad: 'roc', etiket: `ROC ${p.uzunluk}`, tur: 'cizgi', token: 'accent', taban: 0 },
      { ad: 'ema', etiket: `EMA ${p.ema}`, tur: 'cizgi', token: 'warn' },
    ],
  },
  {
    id: 'obv',
    ad: 'Denge Hacmi',
    kisa: 'OBV',
    kategori: 'Hacim',
    panel: 'ayri',
    arama: ['obv', 'on balance volume', 'denge hacmi'],
    parametreler: [uzunluk('ema', 'EMA yumuşatma', 20)],
    ciktilar: (p) => [
      { ad: 'obv', etiket: 'OBV', tur: 'cizgi', token: 'accent' },
      { ad: 'ema', etiket: `EMA ${p.ema}`, tur: 'cizgi', token: 'warn' },
    ],
  },
];

export const INDIKATOR_ILE: Map<string, IndikatorTanimi> = new Map(
  INDIKATORLER.map((t) => [t.id, t]),
);

/**
 * Arama: ada, kısa ada, kategoriye ve ek anahtarlara bakar.
 *
 * Türkçe karakter DUYARSIZ: "oynaklik" yazan kullanıcı "Oynaklık" kaydını
 * bulmalı. Küçük harfe çevirmek tek başına yetmiyor (İ/ı ayrı kod noktaları).
 */
export function indikatorAra(sorgu: string): IndikatorTanimi[] {
  const q = sadelestir(sorgu);
  if (!q) return INDIKATORLER;
  return INDIKATORLER.filter((t) =>
    [t.ad, t.kisa, t.kategori, ...t.arama].some((alan) => sadelestir(alan).includes(q)),
  );
}

const HARF: Record<string, string> = {
  ı: 'i',
  İ: 'i',
  ş: 's',
  Ş: 's',
  ğ: 'g',
  Ğ: 'g',
  ü: 'u',
  Ü: 'u',
  ö: 'o',
  Ö: 'o',
  ç: 'c',
  Ç: 'c',
};

function sadelestir(s: string): string {
  return s
    .split('')
    .map((ch) => HARF[ch] ?? ch)
    .join('')
    .toLowerCase()
    .trim();
}

import type { Candles } from '../data/types';

/**
 * BIST SEKTÖR ENDEKSLERİ — "endüstriden para akışı" sorusunun veriye dayanan
 * cevabı.
 *
 * Neden bu yol: sektör AKIŞI için sembol→sektör sınıflandırması gerekiyor ve
 * o dosya üretilemiyor (kaynak uç noktaları 401 döndürüyor; `build_sectors.py`
 * başındaki nota bakın). Ama BIST'in KENDİ alt sektör endeksleri zaten veri
 * setimizde — her biri tam geçmişiyle. Sektörün nasıl gittiğini uydurmadan,
 * borsanın resmî endeksinden okuyoruz.
 *
 * DÜRÜSTLÜK SINIRI — bu GETİRİ, akış DEĞİL: endeks serilerinin "hacim" alanı
 * güvenilir değil (ölçüldü: yayındaki veride endekslerin işlem değeri 0).
 * Bu yüzden "şu sektöre şu kadar para girdi" demiyoruz; "şu sektör endeksi şu
 * kadar kazandırdı" diyoruz. İkisi aynı şey değil ve arayüz de böyle diyor.
 *
 * Liste BİRBİRİNİ DIŞLAYAN ekonomik sektörler: XU100/XU030 gibi ana endeksler
 * ve XUSIN/XUMAL gibi ÜST kümeler bilerek dışarıda — üst kümeyi alt sektörle
 * aynı listede sıralamak aynı şirketi iki kez saymak olurdu.
 */
export interface SektorEndeksi {
  /** Endeks sembolü (XBANK, XGIDA …). */
  kod: string;
  /** Okunur Türkçe ad. */
  ad: string;
}

export const BIST_SEKTOR_ENDEKSLERI: readonly SektorEndeksi[] = [
  { kod: 'XBANK', ad: 'Banka' },
  { kod: 'XHOLD', ad: 'Holding' },
  { kod: 'XSGRT', ad: 'Sigorta' },
  { kod: 'XFINK', ad: 'Finansal Kiralama, Faktoring' },
  { kod: 'XAKUR', ad: 'Aracı Kurumlar' },
  { kod: 'XGMYO', ad: 'Gayrimenkul Yatırım Ortaklıkları' },
  { kod: 'XYORT', ad: 'Menkul Kıymet Yatırım Ortaklıkları' },
  { kod: 'XGIDA', ad: 'Gıda, İçecek' },
  { kod: 'XKMYA', ad: 'Kimya, Petrol, Plastik' },
  { kod: 'XMANA', ad: 'Metal Ana Sanayi' },
  { kod: 'XMESY', ad: 'Metal Eşya, Makine' },
  { kod: 'XTAST', ad: 'Taş, Toprak (Çimento)' },
  { kod: 'XTEKS', ad: 'Tekstil, Deri' },
  { kod: 'XKAGT', ad: 'Orman, Kağıt, Basım' },
  { kod: 'XMADN', ad: 'Madencilik' },
  { kod: 'XELKT', ad: 'Elektrik' },
  { kod: 'XILTM', ad: 'İletişim' },
  { kod: 'XULAS', ad: 'Ulaştırma' },
  { kod: 'XTCRT', ad: 'Ticaret' },
  { kod: 'XTRZM', ad: 'Turizm' },
  { kod: 'XINSA', ad: 'İnşaat' },
  { kod: 'XBLSM', ad: 'Bilişim' },
  { kod: 'XSPOR', ad: 'Spor' },
];

/** Kod → ad araması; listede olmayan kod için null. */
export function sektorAdi(kod: string): string | null {
  return BIST_SEKTOR_ENDEKSLERI.find((s) => s.kod === kod)?.ad ?? null;
}

export interface SektorGetirisi {
  kod: string;
  ad: string;
  /** Pencere getirisi (%). */
  getiri: number;
  /** Son kapanış. */
  son: number;
  /** Pencerede kullanılan bar sayısı — kısa seride şeffaflık için. */
  bar: number;
}

/**
 * Seçilen pencerede her sektör endeksinin getirisi, BÜYÜKTEN küçüğe.
 *
 * `bars` kaç BARLIK pencere olduğunu söylüyor (1 hafta ≈ 5, 1 ay ≈ 22).
 * Taban, son bardan `bars` geriye giden kapanış.
 *
 * Bir endeks şu durumlarda LİSTEYE GİRMEZ — eksik veriyi sıfır getiri saymak
 * o sektörü "yatay" göstermek olurdu ki bu yanlış bir bilgidir:
 *   - serisi yoksa,
 *   - pencereyi dolduracak kadar barı yoksa,
 *   - taban kapanışı pozitif değilse (yüzde değişim tanımsız olurdu).
 */
export function sektorGetirileri(
  seriler: ReadonlyMap<string, Candles>,
  bars: number,
): SektorGetirisi[] {
  const out: SektorGetirisi[] = [];
  for (const { kod, ad } of BIST_SEKTOR_ENDEKSLERI) {
    const c = seriler.get(kod);
    if (!c || c.length < bars + 1) continue;
    const son = c.close[c.length - 1];
    const taban = c.close[c.length - 1 - bars];
    if (!(taban > 0) || !Number.isFinite(son)) continue;
    out.push({ kod, ad, getiri: ((son - taban) / taban) * 100, son, bar: bars });
  }
  out.sort((a, b) => b.getiri - a.getiri);
  return out;
}

/**
 * Sektör listesinin tek cümlelik özeti.
 *
 * Neden ayrı: tablo "hangi sektör" sorusunu cevaplıyor ama kullanıcı önce
 * "ne oluyor" diye bakıyor. Liste boşsa CEVAP UYDURULMUYOR.
 */
export function sektorOzeti(liste: readonly SektorGetirisi[]): string | null {
  if (liste.length === 0) return null;
  const en = liste[0];
  const son = liste[liste.length - 1];
  const artan = liste.filter((s) => s.getiri > 0).length;
  if (liste.length === 1) return `Tek ölçülebilen sektör: ${en.ad}.`;
  return `${liste.length} sektörün ${artan} tanesi artıda. Başta ${en.ad}, sonda ${son.ad}.`;
}

import type { Candles } from '../data/types';

/**
 * BIST SEKTÖR ENDEKSLERİ — "endüstriden para akışı" sorusunun veriye dayanan
 * cevabı.
 *
 * Bu dosya SEKTÖRÜN NASIL GİTTİĞİNİ ölçüyor: BIST'in kendi alt sektör
 * endeksleri veri setimizde, her biri tam geçmişiyle. Sektörün getirisini
 * uydurmadan borsanın resmî endeksinden okuyoruz.
 *
 * Sembol→sektör SINIFLANDIRMASI ayrı bir şey ve artık var: `sectors.json`,
 * Borsa İstanbul'un kendi bileşen dosyasından üretiliyor (bkz.
 * `build_sectors.py`). Aşağıdaki korelasyon eşleştirmesi o dosyanın
 * OLMADIĞI piyasalar için duruyor — vekil, asıl değil.
 *
 * DÜRÜSTLÜK SINIRI — bu GETİRİ, akış DEĞİL: endeks serilerinin "hacim" alanı
 * güvenilir değil (ölçüldü: yayındaki veride endekslerin işlem değeri 0).
 * Bu yüzden "şu sektöre şu kadar para girdi" demiyoruz; "şu sektör endeksi şu
 * kadar kazandırdı" diyoruz. İkisi aynı şey değil ve arayüz de böyle diyor.
 *
 * Liste BİRBİRİNİ DIŞLAYAN ekonomik sektörler: XU100/XU030 gibi ana endeksler
 * ve XUSIN/XUMAL gibi ÜST kümeler bilerek dışarıda — üst kümeyi alt sektörle
 * aynı listede sıralamak aynı şirketi iki kez saymak olurdu.
 *
 * SINIFLANDIRMADA ÜST GRUPLAR VAR, BU LİSTEDE YOK. `build_sectors.py` alt
 * sektör endeksi hiçbir hisseyi sahiplenmediğinde XUSIN/XUMAL/XUHIZ/XUTEK'e
 * düşüyor ve o hisseleri "… (alt sektörsüz)" adıyla yazıyor. Sebep ölçüldü:
 * ASELS'in yayımlanan tüm endeks üyelikleri arasında tek sektör endeksi
 * XUTEK ve tek başına piyasanın son-bar işlem değerinin %6,4'ü.
 *
 * O dört kod BURAYA EKLENMİYOR, çünkü bu liste GETİRİ tablosunu besliyor ve
 * orada birbirini dışlaması şart: XUTEK, XBLSM'i de kapsıyor. Sınıflandırma
 * ile getiri tablosu farklı iki soruya cevap veriyor ve farklı listelerle
 * çalışmaları doğru. Üst grup adlarının bu tabloda karşılığı yok — o adlar
 * "Sektörün hisseleri" sütununda hiçbir satıra düşmüyor, ki doğrusu bu:
 * onların bir alt sektör endeksi yok.
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

export interface SektorEslesmesi {
  symbol: string;
  /** En yüksek korelasyonlu sektör endeksi. */
  kod: string;
  ad: string;
  /** Günlük getiri korelasyonu (−1…1). */
  korelasyon: number;
  /** Korelasyonda kullanılan ortak gün sayısı. */
  ortak: number;
}

/**
 * Eşik — bu değerin ALTINDAKİ eşleşme bildirilmiyor.
 *
 * Gerçek BIST verisiyle ölçüldü (25 bilinen hisse, 250 barlık pencere):
 *   korelasyon ≥ 0,70 → 16 tahminin 15'i doğru (%94)
 *   korelasyon < 0,70 →  9 tahminin 6'sı doğru (%67)
 * Tek "yanlış" yüksek eşleşme SAHOL → XBANK'tı; Sabancı Holding'in değerini
 * Akbank belirlediği için bu aslında doğru bir DAVRANIŞ gözlemi.
 *
 * Yani eşleşme, korelasyon yüksekken güvenilir. Düşükken sessiz kalmak,
 * yanlış bir sektör etiketi yapıştırmaktan iyidir.
 */
export const ESLESME_ESIGI = 0.7;

/**
 * Her hissenin EN ÇOK BİRLİKTE HAREKET ETTİĞİ sektör endeksi.
 *
 * DİKKAT — bu RESMÎ SEKTÖR DEĞİL. Ölçülen şey davranış: hissenin günlük
 * getirisi hangi sektör endeksinin getirisine en çok benziyor.
 *
 * VEKİL, ASIL DEĞİL. Resmî sınıflandırma (`sectors.json`) varken bu hesap
 * KULLANILMAMALI: gerçek veride ölçtüm, korelasyon 584 hissenin 35'ini
 * (%6) bir sektöre bağlayabiliyor, resmî dosya 496'sını (%85). İki
 * üyeliği aynı ekranda yan yana göstermek, zayıf olanı yetkili gibi
 * okutur. Yüzeyler önce resmî dosyaya bakıyor; burası yalnızca o dosyanın
 * olmadığı piyasalar için. Arayüz de "sektörü şu" değil "şu sektörle
 * birlikte hareket ediyor" diyor.
 *
 * Korelasyon FİYAT değil GETİRİ üzerinden: iki trendli seri seviye
 * korelasyonunda her zaman ~1 çıkar ve hiçbir şey ayırt edilmez.
 */
export function sektorEslesmeleri(
  hisseler: ReadonlyMap<string, Candles>,
  endeksler: ReadonlyMap<string, Candles>,
  opts: { esik?: number; minOrtak?: number } = {},
): SektorEslesmesi[] {
  const esik = opts.esik ?? ESLESME_ESIGI;
  const minOrtak = opts.minOrtak ?? 100;

  /** Zaman → günlük getiri. Fiyatı geçersiz olan gün ATILIR, sıfır sayılmaz. */
  const getiriHaritasi = (c: Candles): Map<number, number> => {
    const m = new Map<number, number>();
    for (let i = 1; i < c.length; i++) {
      const onceki = c.close[i - 1];
      const simdi = c.close[i];
      if (onceki > 0 && simdi > 0 && Number.isFinite(onceki) && Number.isFinite(simdi)) {
        m.set(c.time[i], Math.log(simdi / onceki));
      }
    }
    return m;
  };

  const endeksGetirileri: { kod: string; ad: string; g: Map<number, number> }[] = [];
  for (const { kod, ad } of BIST_SEKTOR_ENDEKSLERI) {
    const c = endeksler.get(kod);
    if (!c || c.length < 2) continue;
    endeksGetirileri.push({ kod, ad, g: getiriHaritasi(c) });
  }
  if (endeksGetirileri.length === 0) return [];

  const out: SektorEslesmesi[] = [];
  for (const [symbol, c] of hisseler) {
    if (!c || c.length < 2) continue;
    const hg = getiriHaritasi(c);
    if (hg.size < minOrtak) continue;

    let enIyi: SektorEslesmesi | null = null;
    for (const { kod, ad, g } of endeksGetirileri) {
      // Küçük olanın üzerinde dönmek: 250 barlık endeks haritasında 3.400
      // barlık hisseyi aramak boşuna iş olurdu.
      const [kucuk, buyuk] = hg.size <= g.size ? [hg, g] : [g, hg];
      let n = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const [t, a] of kucuk) {
        const b = buyuk.get(t);
        if (b === undefined) continue;
        const x = kucuk === hg ? a : b;
        const y = kucuk === hg ? b : a;
        n++;
        sx += x;
        sy += y;
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
      }
      if (n < minOrtak) continue;
      const pay = n * sxy - sx * sy;
      const payda = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
      if (!(payda > 0)) continue;
      const r = pay / payda;
      if (!Number.isFinite(r)) continue;
      if (!enIyi || r > enIyi.korelasyon) {
        enIyi = { symbol, kod, ad, korelasyon: r, ortak: n };
      }
    }
    if (enIyi && enIyi.korelasyon >= esik) out.push(enIyi);
  }
  out.sort((a, b) => b.korelasyon - a.korelasyon);
  return out;
}

/** Bir sektör endeksiyle birlikte hareket eden hisseler, korelasyona göre. */
export function sektorunHisseleri(
  eslesmeler: readonly SektorEslesmesi[],
  kod: string,
): SektorEslesmesi[] {
  return eslesmeler.filter((e) => e.kod === kod);
}

/**
 * RESMÎ sınıflandırmada bir sektörün hisseleri.
 *
 * Eşleştirme SEKTÖR ADI üzerinden yapılıyor, kod üzerinden değil — ve bu bir
 * tesadüf değil: `scripts/build_sectors.py` sektör adlarını doğrudan
 * `BIST_SEKTOR_ENDEKSLERI` listesinden okuyor, yani `sectors.json` içindeki
 * adlar bu dosyadaki adların ta kendisi. Bağ tek yönlü ve tek kaynaklı.
 *
 * Sıra alfabetik: korelasyon eşleşmesinin aksine burada hisseleri
 * sıralayacak bir ÖLÇÜ yok ve uydurma bir sıra "önce gelen daha önemli"
 * diye okunur.
 */
export function resmiSektorunHisseleri(harita: Record<string, string>, ad: string): string[] {
  const out: string[] = [];
  for (const [sembol, sektor] of Object.entries(harita)) {
    if (sektor === ad) out.push(sembol);
  }
  return out.sort((a, b) => a.localeCompare(b, 'tr'));
}

/**
 * Eşleşmeleri `SectorMap` biçimine çevirir — akran karşılaştırması gibi
 * sektör haritası bekleyen yüzeyler bunu olduğu gibi kullanabilsin diye.
 *
 * `source` alanı ne olduğunu AÇIKÇA söylüyor: bu resmî bir sınıflandırma
 * değil, ölçülmüş bir davranış. Kullanan yüzey bunu kullanıcıya da yazmalı;
 * "sektörü şu" ile "şununla birlikte hareket ediyor" aynı iddia değildir.
 */
export function eslesmeHaritasi(
  eslesmeler: readonly SektorEslesmesi[],
  generated = 0,
): { source: string; of: Record<string, string>; generated: number } {
  const of: Record<string, string> = {};
  for (const e of eslesmeler) of[e.symbol] = e.ad;
  return { source: 'Sektör endeksi korelasyonu', of, generated };
}

import type { Bundle } from '../data/pack';
import {
  ANOMALI_VARSAYILAN,
  anomaliGunu,
  anomaliIzgarasi,
  type AnomaliAyar,
  type AnomaliSatiri,
  type AnomaliTuru,
} from './anomali';

/**
 * ANOMALİNİN KARNESİ — "olağandışı" işe yarıyor mu?
 *
 * Anomali radarı "bugün kim olağandışı" diyor ve "olağandışı ≠ fırsat" diye
 * uyarıyor. Uyarı doğru ama eksik: kullanıcı haklı olarak "peki GEÇMİŞTE bu
 * listeye düşenler sonra ne yaptı?" diye soruyor. Bu modül o soruyu veriyle
 * cevaplıyor: paketteki geçmiş her gün için radarı O GÜNE kuruyor (o güne
 * kadarki veriyle, sonrasına bakmadan), listeye düşen hisselerin sonraki
 * h gündeki getirisini aynı günün piyasa medyanıyla kıyaslıyor.
 *
 * YÖN AYRI. Yukarı boşluk ile aşağı boşluk aynı şey değil; tek kovada
 * toplansa birbirini götürür. Boşluk ve kopma işaretine göre ikiye bölünüyor.
 *
 * GİRİŞ O GÜNÜN KAPANIŞI. Sinyal gün sonunda görünür oluyor (kopma ve hacim
 * zaten kapanışta belli); daha erken giriş ileriye bakmak olurdu.
 *
 * FAZLA GETİRİ, HAM GETİRİ DEĞİL. Piyasanın yükseldiği bir dönemde her liste
 * "kazandırır". Olayın getirisinden aynı günün (aynı ufuktaki) piyasa medyanı
 * çıkarılıyor.
 *
 * ANLAMLILIK GÜN ÜZERİNDEN. Aynı günün olayları bağımsız değil (şok gününde
 * 30 hisse birlikte düşer); olay sayısıyla hesaplanan p-değeri sahte bir
 * kesinlik verirdi. İşaret testi, gün başına ortalama fazla getirinin
 * işaretleri üzerinden. Bu da üst üste binen pencereler yüzünden hâlâ biraz
 * iyimser — arayüz bunu söylüyor.
 *
 * HAYATTA KALMA YANLILIĞI. Paket bugün işlem gören sembolleri taşıyor;
 * aradan kotasyondan çıkanlar yok. Arayüz bunu da söylüyor.
 *
 * YAYGIN SİNYAL SAYILMIYOR. Panelde olduğu gibi: o gün piyasanın ≥%10'unda
 * tetiklenen sinyal bir piyasa olayı; o günün o kovasına olay yazılmıyor.
 */

export type KarneKovasi =
  'hacim' | 'boslukYukari' | 'boslukAsagi' | 'kopmaYukari' | 'kopmaAsagi' | 'korelasyon';

export const KARNE_KOVALARI: readonly KarneKovasi[] = [
  'hacim',
  'boslukYukari',
  'boslukAsagi',
  'kopmaYukari',
  'kopmaAsagi',
  'korelasyon',
];

export interface UfukSonucu {
  /** Ölçülebilen olay sayısı (ileri getirisi hesaplanabilen). */
  n: number;
  /** Olayların fazla getirisinin medyanı (yüzde puan). */
  medyanFazla: number;
  /** Fazla getirisi pozitif olan olayların payı (0–1). */
  isabet: number;
  /** Olay olan gün sayısı — anlamlılık bunun üzerinden. */
  gun: number;
  /** Gün başına ortalama fazla getirinin işaret testi, iki yönlü. */
  p: number;
  /**
   * KONTROL: aynı hisselerin (olay ağırlığıyla) SIRADAN günlerdeki medyan
   * fazla getirisi. Olay medyanı bundan belirgin farklı değilse sonuç "bu
   * hisseler zaten böyle" demektir, sinyalin etkisi değil.
   */
  kontrolFazla: number;
}

export interface KarneSatiri {
  kova: KarneKovasi;
  /** Toplam olay (ufuktan bağımsız; ileri getirisi ölçülemeyenler dahil). */
  olay: number;
  ufuk: Record<number, UfukSonucu>;
}

export interface AnomaliKarnesi {
  ufuklar: number[];
  /** Değerlendirilen ilk ve son gün (epoch gün). */
  basGun: number;
  sonGun: number;
  degerlendirilenGun: number;
  satirlar: KarneSatiri[];
}

export interface KarneSecenek {
  ufuklar?: number[];
  ayar?: Partial<AnomaliAyar>;
}

/** Olayın hangi kovalara düştüğü (yaygın sinyaller hariç). */
function kovalar(s: AnomaliSatiri, yaygin: Record<AnomaliTuru, boolean>): KarneKovasi[] {
  const out: KarneKovasi[] = [];
  for (const t of s.tetikler) {
    if (yaygin[t]) continue;
    if (t === 'hacim') out.push('hacim');
    else if (t === 'korelasyon') out.push('korelasyon');
    else if (t === 'bosluk') out.push(s.bosluk >= 0 ? 'boslukYukari' : 'boslukAsagi');
    else out.push(s.kopma >= 0 ? 'kopmaYukari' : 'kopmaAsagi');
  }
  return out;
}

function medyan(d: number[]): number {
  if (d.length === 0) return Number.NaN;
  const s = [...d].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * İki yönlü işaret testi: n denemede k başarı, p = 0,5 altında.
 * Kesin binom — log uzayında, n birkaç yüzü geçmiyor.
 */
export function isaretTesti(k: number, n: number): number {
  if (n <= 0) return Number.NaN;
  const uc = Math.min(k, n - k);
  // log C(n, i) artımlı: C(n,i+1) = C(n,i)·(n−i)/(i+1)
  let logC = 0;
  let toplam = 0;
  const log2n = n * Math.LN2;
  for (let i = 0; i <= uc; i++) {
    toplam += Math.exp(logC - log2n);
    logC += Math.log(n - i) - Math.log(i + 1);
  }
  return Math.min(1, 2 * toplam);
}

export function anomaliKarnesi(
  paket: Bundle,
  sektorler: Record<string, string> | null,
  secenek: KarneSecenek = {},
): AnomaliKarnesi {
  const ufuklar = [...(secenek.ufuklar ?? [5, 20])].sort((a, b) => a - b);
  const ayar = { ...ANOMALI_VARSAYILAN, ...secenek.ayar };
  const bars = paket.bars;
  const S = paket.names.length;
  const iz = anomaliIzgarasi(paket, sektorler, ayar, 0);

  // Değerlendirme aralığı: z için en az `pencere` günlük geçmiş; en kısa
  // ufuk kadar gelecek. Uzun ufuk erken bitiyor — her ufuk kendi n'ini taşıyor.
  const ilk = Math.max(1, ayar.pencere);
  const sonD = bars - 1 - ufuklar[0];

  // İleri getiri: d kapanışından d+h'ye kadarki SON sonlu kapanışa.
  // (Sembol d+h'de işlem görmediyse o güne kadarki son fiyat.)
  const ileri = (si: number, d: number, h: number): number => {
    const k0 = paket.closeAt(si, d);
    if (!(k0 > 0) || d + h >= bars) return Number.NaN;
    for (let j = d + h; j > d; j--) {
      const k = paket.closeAt(si, j);
      if (k > 0) return (k / k0 - 1) * 100;
    }
    return Number.NaN;
  };

  // Piyasa medyanı (d, h) — o gün işlem görmüş herkes. Önbellekli.
  const tabanOnbellek = new Map<number, number>();
  const taban = (d: number, h: number): number => {
    const anahtar = d * 1000 + h;
    const var_ = tabanOnbellek.get(anahtar);
    if (var_ !== undefined) return var_;
    const r: number[] = [];
    for (let si = 0; si < S; si++) {
      const v = ileri(si, d, h);
      if (Number.isFinite(v)) r.push(v);
    }
    const m = medyan(r);
    tabanOnbellek.set(anahtar, m);
    return m;
  };

  /*
    KONTROL — her sembolün değerlendirme aralığındaki TÜM günlerdeki fazla
    getirisinin medyanı. Gerçek veride ilk karnede altı kovanın altısı da
    negatif çıktı; ilk şüphe "listeye oynak hisseler düşüyor, oynak hissenin
    medyanı düşük" idi. Ölçüldü: aynı hisselerin sıradan günleri 0,00, olay
    günleri −0,76 (5 gün). Şüphe yanlıştı ve bu sütun o ayrımı kalıcı kılıyor.
  */
  const kontrolOnbellek = new Map<number, number>();
  const kontrol = (si: number, h: number): number => {
    const anahtar = si * 1000 + h;
    const var_ = kontrolOnbellek.get(anahtar);
    if (var_ !== undefined) return var_;
    const r: number[] = [];
    for (let d = ilk; d <= bars - 1 - h; d++) {
      const g = ileri(si, d, h);
      if (!Number.isFinite(g)) continue;
      const t = taban(d, h);
      if (Number.isFinite(t)) r.push(g - t);
    }
    const m = medyan(r);
    kontrolOnbellek.set(anahtar, m);
    return m;
  };

  interface Birikim {
    olay: number;
    /** h → olay başına kontrol değeri (sembolün sıradan günleri). */
    kontrol: Record<number, number[]>;
    fazla: Record<number, number[]>;
    /** h → gün → o günün fazla getirileri */
    gunluk: Record<number, Map<number, number[]>>;
  }
  const bir = new Map<KarneKovasi, Birikim>();
  for (const k of KARNE_KOVALARI) {
    const fazla: Record<number, number[]> = {};
    const kont: Record<number, number[]> = {};
    const gunluk: Record<number, Map<number, number[]>> = {};
    for (const h of ufuklar) {
      fazla[h] = [];
      kont[h] = [];
      gunluk[h] = new Map();
    }
    bir.set(k, { olay: 0, kontrol: kont, fazla, gunluk });
  }

  let degerlendirilen = 0;
  for (let d = ilk; d <= sonD; d++) {
    degerlendirilen++;
    const r = anomaliGunu(iz, d, ayar);
    for (const satir of r.satirlar) {
      const si = paket.names.indexOf(satir.symbol);
      for (const k of kovalar(satir, r.yaygin)) {
        const b = bir.get(k)!;
        b.olay++;
        for (const h of ufuklar) {
          const g = ileri(si, d, h);
          const t = Number.isFinite(g) ? taban(d, h) : Number.NaN;
          if (!Number.isFinite(g) || !Number.isFinite(t)) continue;
          b.fazla[h].push(g - t);
          b.kontrol[h].push(kontrol(si, h));
          const liste = b.gunluk[h].get(d);
          if (liste) liste.push(g - t);
          else b.gunluk[h].set(d, [g - t]);
        }
      }
    }
  }

  const satirlar: KarneSatiri[] = KARNE_KOVALARI.map((kova) => {
    const b = bir.get(kova)!;
    const ufuk: Record<number, UfukSonucu> = {};
    for (const h of ufuklar) {
      const f = b.fazla[h];
      let yukari = 0;
      let isaretli = 0;
      for (const gunluk of b.gunluk[h].values()) {
        const ort = gunluk.reduce((a, x) => a + x, 0) / gunluk.length;
        if (ort > 0) yukari++;
        if (ort !== 0) isaretli++;
      }
      ufuk[h] = {
        n: f.length,
        medyanFazla: medyan(f),
        isabet: f.length ? f.filter((x) => x > 0).length / f.length : Number.NaN,
        gun: b.gunluk[h].size,
        p: isaretTesti(yukari, isaretli),
        kontrolFazla: medyan(b.kontrol[h].filter(Number.isFinite)),
      };
    }
    return { kova, olay: b.olay, ufuk };
  });

  return {
    ufuklar,
    basGun: ilk <= sonD ? paket.days[ilk] : Number.NaN,
    sonGun: ilk <= sonD ? paket.days[sonD] : Number.NaN,
    degerlendirilenGun: degerlendirilen,
    satirlar,
  };
}

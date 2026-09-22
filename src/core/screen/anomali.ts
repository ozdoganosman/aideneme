import type { Bundle } from '../data/pack';

/**
 * ANOMALİ RADARI — "bugün olağandışı ne var?"
 *
 * Tarayıcı ve radar "şu koşulu sağlayan hisseler" sorusuna cevap veriyor;
 * koşulu kullanıcı yazıyor. Bu modül tersini soruyor: kullanıcı hiçbir şey
 * yazmadan, hangi hisse BUGÜN kendi alışkanlığının dışına çıktı?
 *
 * "Olağandışı" burada mutlak bir eşik değil, sembolün KENDİ geçmişine göre
 * bir sapma: 60 günün standart sapmasıyla ölçülen z-skoru. %5 yükseliş bir
 * bankada olağandışı, küçük bir madencilik hissesinde sıradandır; sabit
 * eşik ikisini aynı kefeye koyardı.
 *
 * Dört sinyal, her biri ayrı ölçülüyor ve ayrı raporlanıyor:
 *   hacim      — bugünkü işlem değerinin (log) z-skoru; yalnızca YÜKSEK taraf
 *                tetikler ("hacim patlaması"). Düşük hacim de olağandışıdır
 *                ama listeyi işlem görmeyen kâğıtlarla doldururdu.
 *   bosluk     — açılış ÷ önceki kapanış − 1; kendi boşluk geçmişine göre z.
 *   kopma      — bugünkü değişim − sektör medyanı; kendi sapma geçmişine göre
 *                z. Sektör dosyası yoksa ya da sektör çok küçükse ölçülemez.
 *   korelasyon — sektör medyanıyla korelasyon: uzun pencerede yüksekken kısa
 *                pencerede düşmüş mü? "Sürüden ayrıldı" sinyali.
 *
 * OLAĞANDIŞI ≠ FIRSAT. Bu bir sıralama değil, dikkat listesi: hacim patlaması
 * hem alımın hem satımın izi olabilir. Bu yüzden satırda yön verilmiyor,
 * sadece "ne oldu" ve "ne kadar alışılmadık" yazılıyor; kararı kullanıcı
 * grafiğe bakarak verir.
 *
 * ÖLÇÜLEMEDİ ≠ SIRADAN. Yeterli geçmişi olmayan sembolde sinyal NaN kalır ve
 * sayılır — "hiçbir şey bulunmadı" ile "bakılamadı" aynı şey değil.
 *
 * Gün eksenine hizalı: paketin ham ızgarasından (`closeAt`/`openAt`/
 * `volumeAt`) okunuyor ki sektör medyanı gerçekten AYNI günün medyanı olsun.
 * Değişim önceki SONLU kapanışa göre — `pulseRow` ile aynı anlam.
 */

export type AnomaliTuru = 'hacim' | 'bosluk' | 'kopma' | 'korelasyon';

export const ANOMALI_TURLERI: readonly AnomaliTuru[] = ['hacim', 'bosluk', 'kopma', 'korelasyon'];

export interface AnomaliAyar {
  /** z-skoru için geçmiş penceresi (gün, bugün hariç). */
  pencere: number;
  /** Pencerede bu kadar gözlemden azı varsa sinyal ölçülemez. */
  enAzGozlem: number;
  /** Tetik eşiği (standart sapma). */
  zEsik: number;
  /** Boşluk tetiği için mutlak taban (%): z büyük ama %0,3'lük boşluk anlamsız. */
  boslukTaban: number;
  /** Kopma tetiği için mutlak taban (puan). */
  kopmaTaban: number;
  /** Sektör medyanı için gereken en az sembol (bugün işlem görmüş). */
  enAzSektor: number;
  /** Korelasyon: uzun pencere (gün), kısa pencereden ÖNCE. */
  korUzun: number;
  /** Korelasyon: kısa pencere (gün, bugün dahil). */
  korKisa: number;
  /** Uzun pencere korelasyonu en az bu kadar olmalı ki "sürüden ayrıldı" denebilsin. */
  korTaban: number;
  /** Uzun − kısa korelasyon farkı en az bu kadar. */
  korDusus: number;
  /**
   * YAYGINLIK: bir sinyal denenenlerin bu payından fazlasında tetiklenirse
   * piyasa olayıdır, tekil olağandışılık değil (bkz. dosya başı).
   */
  yayginPay: number;
}

export const ANOMALI_VARSAYILAN: AnomaliAyar = {
  pencere: 60,
  enAzGozlem: 20,
  zEsik: 3,
  boslukTaban: 1,
  kopmaTaban: 2,
  enAzSektor: 5,
  korUzun: 120,
  korKisa: 20,
  korTaban: 0.5,
  korDusus: 0.5,
  yayginPay: 0.1,
};

export interface AnomaliSatiri {
  symbol: string;
  /** Sektör dosyasından; yoksa null. */
  sektor: string | null;
  /** Bugünkü değişim (%). */
  degisim: number;
  /** Bugünkü işlem değeri. */
  deger: number;
  hacimZ: number;
  /** Açılış boşluğu (%) ve kendi geçmişine göre z'si. */
  bosluk: number;
  boslukZ: number;
  /** Sektör medyanından sapma (puan) ve kendi geçmişine göre z'si. */
  kopma: number;
  kopmaZ: number;
  korUzun: number;
  korKisa: number;
  /** Tetiklenen sinyaller; boşsa satır listeye girmez. */
  tetikler: AnomaliTuru[];
}

export interface AnomaliSonucu {
  /** Bugün (epoch gün). */
  gun: number;
  /** Bugün işlem görmüş, denenmiş sembol sayısı. */
  denenen: number;
  /** Bugün işlem görmemiş sembol sayısı — denenmedi. */
  islemGormeyen: number;
  /**
   * En az bir YAYGIN OLMAYAN sinyali tetiklenenler; şiddete göre sıralı.
   * Yalnızca yaygın sinyalle tetiklenenler listede değil, `yayginSatir`da.
   */
  satirlar: AnomaliSatiri[];
  /** Sinyal bugün piyasa geneline yayılmış mı (tetiklenen ÷ denenen ≥ yayginPay). */
  yaygin: Record<AnomaliTuru, boolean>;
  /** Yalnızca yaygın sinyallerle tetiklenen, bu yüzden listeye alınmayan sembol sayısı. */
  yayginSatir: number;
  /** Sinyal başına ölçülemeyen sembol sayısı (denenenler içinde). */
  olculemeyen: Record<AnomaliTuru, number>;
  /** Sinyal başına tetiklenen sembol sayısı. */
  tetiklenen: Record<AnomaliTuru, number>;
}

function sayac(): Record<AnomaliTuru, number> {
  return { hacim: 0, bosluk: 0, kopma: 0, korelasyon: 0 };
}

function bayrak(): Record<AnomaliTuru, boolean> {
  return { hacim: false, bosluk: false, kopma: false, korelasyon: false };
}

/** Ortalama ve örneklem standart sapması; n < 2 ya da sapma 0 ise NaN sapma. */
function ozet(d: number[]): { ort: number; sapma: number } {
  const n = d.length;
  if (n < 2) return { ort: Number.NaN, sapma: Number.NaN };
  let t = 0;
  for (const v of d) t += v;
  const ort = t / n;
  let k = 0;
  for (const v of d) k += (v - ort) * (v - ort);
  const sapma = Math.sqrt(k / (n - 1));
  return { ort, sapma: sapma > 0 ? sapma : Number.NaN };
}

/** Bugünkü değerin geçmişe göre z'si; geçmiş yetersizse NaN. */
function zSkoru(bugun: number, gecmis: number[], enAz: number): number {
  if (!Number.isFinite(bugun) || gecmis.length < enAz) return Number.NaN;
  const { ort, sapma } = ozet(gecmis);
  return Number.isFinite(sapma) ? (bugun - ort) / sapma : Number.NaN;
}

/** Pearson — iki dizinin ikisinde de sonlu olan noktalar üzerinden. */
function pearson(a: Float64Array, b: Float64Array, from: number, to: number, enAz: number): number {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = from; i < to; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    n++;
    sa += a[i];
    sb += b[i];
  }
  if (n < enAz) return Number.NaN;
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = from; i < to; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  const payda = Math.sqrt(va * vb);
  return payda > 0 ? cov / payda : Number.NaN;
}

function medyan(d: number[]): number {
  if (d.length === 0) return Number.NaN;
  d.sort((x, y) => x - y);
  const m = d.length >> 1;
  return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
}

/**
 * Şiddet: sıralama için tek sayı. Tetiklenen sinyal sayısı önce; sonra en
 * büyük z. Korelasyon kırılmasının z'si yok; düşüşü eşiğe oranlayıp z eşiğiyle
 * çarparak aynı ölçeğe getiriliyor (0,5 düşüş ≈ 3σ).
 */
function siddet(s: AnomaliSatiri, ayar: AnomaliAyar, yaygin: Record<AnomaliTuru, boolean>): number {
  // Yaygın sinyal şiddete katılmıyor: o gün herkeste var, ayırt etmiyor.
  const sayilan = s.tetikler.filter((t) => !yaygin[t]);
  const adaylar = [
    sayilan.includes('hacim') ? s.hacimZ : 0,
    sayilan.includes('bosluk') ? Math.abs(s.boslukZ) : 0,
    sayilan.includes('kopma') ? Math.abs(s.kopmaZ) : 0,
    sayilan.includes('korelasyon') ? ((s.korUzun - s.korKisa) / ayar.korDusus) * ayar.zEsik : 0,
  ];
  return sayilan.length * 1000 + Math.max(...adaylar);
}

/**
 * Sinyallerin okuduğu ızgara: sembol × gün değişim, boşluk, işlem değeri ve
 * sektör medyanları. BİR KEZ kuruluyor; bir gün (`anomaliGunu`) ya da çok gün
 * (anomalinin karnesi) aynı ızgaradan değerlendiriliyor.
 *
 * `enErken`: sektör medyanlarının hesaplanacağı ilk gün. Tek gün için yalnızca
 * gereken pencere; karne için 0.
 */
export interface AnomaliIzgarasi {
  paket: Bundle;
  bars: number;
  S: number;
  degisim: Float64Array;
  bosluk: Float64Array;
  deger: Float64Array;
  /** Sembol indeksi → sektör adı (dosya yoksa ya da eşleşme yoksa null). */
  sektorOf: (string | null)[];
  sektorMedyani: Map<string, Float64Array>;
}

export function anomaliIzgarasi(
  paket: Bundle,
  sektorler: Record<string, string> | null,
  ayarUst: Partial<AnomaliAyar> = {},
  enErken = 0,
): AnomaliIzgarasi {
  const ayar = { ...ANOMALI_VARSAYILAN, ...ayarUst };
  const bars = paket.bars;
  const S = paket.names.length;

  /*
    İLK GEÇİŞ — sembol × gün ızgarasında değişim, boşluk ve işlem değeri.
    Değişim ve boşluk önceki SONLU kapanışa göre. 584 × 250 × 3 double ≈ 3,5 MB
    geçici; sinyallerin hepsi buradan okunuyor, seri iki kez kurulmuyor.
  */
  const degisim = new Float64Array(S * bars).fill(Number.NaN);
  const bosluk = new Float64Array(S * bars).fill(Number.NaN);
  const deger = new Float64Array(S * bars).fill(Number.NaN);
  for (let si = 0; si < S; si++) {
    let onceki = Number.NaN;
    for (let di = 0; di < bars; di++) {
      const k = paket.closeAt(si, di);
      if (!(k > 0)) continue;
      const i = si * bars + di;
      const h = paket.volumeAt(si, di);
      deger[i] = Number.isFinite(h) && h > 0 ? k * h : Number.NaN;
      if (onceki > 0) {
        degisim[i] = (k / onceki - 1) * 100;
        const a = paket.openAt(si, di);
        if (a > 0) bosluk[i] = (a / onceki - 1) * 100;
      }
      onceki = k;
    }
  }

  // SEKTÖR MEDYANLARI — gün başına, `enErken`den son güne.
  const sektorOf = paket.names.map((ad) => (sektorler ? (sektorler[ad] ?? null) : null));
  const sektorUyeleri = new Map<string, number[]>();
  sektorOf.forEach((sk, si) => {
    if (!sk) return;
    const liste = sektorUyeleri.get(sk);
    if (liste) liste.push(si);
    else sektorUyeleri.set(sk, [si]);
  });
  const sektorMedyani = new Map<string, Float64Array>();
  for (const [sk, uyeler] of sektorUyeleri) {
    const m = new Float64Array(bars).fill(Number.NaN);
    for (let di = Math.max(0, enErken); di < bars; di++) {
      const d: number[] = [];
      for (const si of uyeler) {
        const v = degisim[si * bars + di];
        if (Number.isFinite(v)) d.push(v);
      }
      if (d.length >= ayar.enAzSektor) m[di] = medyan(d);
    }
    sektorMedyani.set(sk, m);
  }

  return { paket, bars, S, degisim, bosluk, deger, sektorOf, sektorMedyani };
}

/** Bugünün (son günün) anomalileri. */
export function anomaliHesapla(
  paket: Bundle,
  sektorler: Record<string, string> | null,
  ayarUst: Partial<AnomaliAyar> = {},
): AnomaliSonucu {
  const ayar = { ...ANOMALI_VARSAYILAN, ...ayarUst };
  const son = paket.bars - 1;
  const enErken = Math.max(0, son - ayar.korUzun - ayar.korKisa - ayar.pencere);
  return anomaliGunu(anomaliIzgarasi(paket, sektorler, ayar, enErken), son, ayar);
}

/**
 * `son` gününün anomalileri — o güne kadarki veriyle, sonrasına bakmadan.
 * Karne bunu geçmiş her gün için çağırıyor; ileriye bakma olmaması bu yüzden
 * önemli: her pencere `son`da bitiyor.
 */
export function anomaliGunu(
  iz: AnomaliIzgarasi,
  son: number,
  ayarUst: Partial<AnomaliAyar> = {},
): AnomaliSonucu {
  const ayar = { ...ANOMALI_VARSAYILAN, ...ayarUst };
  const { paket, bars, S, degisim, bosluk, deger, sektorOf, sektorMedyani } = iz;
  const bos: AnomaliSonucu = {
    gun: son >= 0 && son < bars ? paket.days[son] : Number.NaN,
    denenen: 0,
    islemGormeyen: S,
    satirlar: [],
    yaygin: bayrak(),
    yayginSatir: 0,
    olculemeyen: sayac(),
    tetiklenen: sayac(),
  };
  if (son < 1 || son >= bars) return bos;

  const out = bos;
  out.islemGormeyen = 0;
  const adaylar: AnomaliSatiri[] = [];
  const gecmisBas = Math.max(0, son - ayar.pencere);
  const kisaBas = Math.max(0, son + 1 - ayar.korKisa);
  const uzunBas = Math.max(0, kisaBas - ayar.korUzun);
  const uzunEnAz = Math.ceil(ayar.korUzun * 0.5);
  const kisaEnAz = Math.ceil(ayar.korKisa * 0.75);

  for (let si = 0; si < S; si++) {
    const bugun = si * bars + son;
    if (!Number.isFinite(degisim[bugun])) {
      out.islemGormeyen++;
      continue;
    }
    out.denenen++;
    const ad = paket.names[si];
    const sk = sektorOf[si];
    const med = sk ? sektorMedyani.get(sk) : undefined;

    // hacim — log uzayında: işlem değeri çarpımsal dağılır, ham z bir günlük
    // rekor hacmi her zaman "olağandışı" gösterirdi.
    const hacimGecmis: number[] = [];
    for (let di = gecmisBas; di < son; di++) {
      const v = deger[si * bars + di];
      if (v > 0) hacimGecmis.push(Math.log(v));
    }
    const hacimZ = zSkoru(
      deger[bugun] > 0 ? Math.log(deger[bugun]) : Number.NaN,
      hacimGecmis,
      ayar.enAzGozlem,
    );

    // boşluk
    const boslukGecmis: number[] = [];
    for (let di = gecmisBas; di < son; di++) {
      const v = bosluk[si * bars + di];
      if (Number.isFinite(v)) boslukGecmis.push(v);
    }
    const boslukZ = zSkoru(bosluk[bugun], boslukGecmis, ayar.enAzGozlem);

    // kopma
    let kopma = Number.NaN;
    let kopmaZ = Number.NaN;
    if (med && Number.isFinite(med[son])) {
      kopma = degisim[bugun] - med[son];
      const gecmis: number[] = [];
      for (let di = gecmisBas; di < son; di++) {
        const v = degisim[si * bars + di];
        if (Number.isFinite(v) && Number.isFinite(med[di])) gecmis.push(v - med[di]);
      }
      kopmaZ = zSkoru(kopma, gecmis, ayar.enAzGozlem);
    }

    // korelasyon
    let korUzun = Number.NaN;
    let korKisa = Number.NaN;
    if (med) {
      const kendi = degisim.subarray(si * bars, si * bars + bars);
      korUzun = pearson(kendi, med, uzunBas, kisaBas, uzunEnAz);
      korKisa = pearson(kendi, med, kisaBas, son + 1, kisaEnAz);
    }

    const tetikler: AnomaliTuru[] = [];
    if (!Number.isFinite(hacimZ)) out.olculemeyen.hacim++;
    else if (hacimZ >= ayar.zEsik) tetikler.push('hacim');

    if (!Number.isFinite(boslukZ)) out.olculemeyen.bosluk++;
    else if (Math.abs(boslukZ) >= ayar.zEsik && Math.abs(bosluk[bugun]) >= ayar.boslukTaban)
      tetikler.push('bosluk');

    if (!Number.isFinite(kopmaZ)) out.olculemeyen.kopma++;
    else if (Math.abs(kopmaZ) >= ayar.zEsik && Math.abs(kopma) >= ayar.kopmaTaban)
      tetikler.push('kopma');

    if (!Number.isFinite(korUzun) || !Number.isFinite(korKisa)) out.olculemeyen.korelasyon++;
    else if (korUzun >= ayar.korTaban && korUzun - korKisa >= ayar.korDusus)
      tetikler.push('korelasyon');

    for (const t of tetikler) out.tetiklenen[t]++;
    if (tetikler.length === 0) continue;
    adaylar.push({
      symbol: ad,
      sektor: sk,
      degisim: degisim[bugun],
      deger: deger[bugun],
      hacimZ,
      bosluk: bosluk[bugun],
      boslukZ,
      kopma,
      kopmaZ,
      korUzun,
      korKisa,
      tetikler,
    });
  }

  /*
    YAYGINLIK — gerçek veride görüldü (18 Eyl 2026): 581 sembolün 116'sı
    açılış boşluğuyla tetiklendi. Her biri kendi geçmişine göre gerçekten
    olağandışıydı; ama piyasanın beşte biri aynı şeyi yapıyorsa bu bir PİYASA
    OLAYIDIR ve "dikkat listesi" 116 satırla dikkat çekmez. Yaygın sinyal
    satırın rozetinde kalıyor (olgu doğru) ama tek başına listeye sokmuyor ve
    şiddete katılmıyor. Arayüz yaygınlığı ayrı bir cümleyle söylüyor.

    Eşik %10, ölçümle: normal günlerde hiçbir sinyal %5'i geçmiyor (45 günde
    en yüksek: korelasyon %5), şok günlerinde boşluk %20–28, kopma %11.
  */
  for (const t of ANOMALI_TURLERI) {
    out.yaygin[t] = out.denenen > 0 && out.tetiklenen[t] / out.denenen >= ayar.yayginPay;
  }
  for (const a of adaylar) {
    if (a.tetikler.some((t) => !out.yaygin[t])) out.satirlar.push(a);
    else out.yayginSatir++;
  }
  out.satirlar.sort((a, b) => siddet(b, ayar, out.yaygin) - siddet(a, ayar, out.yaygin));
  return out;
}

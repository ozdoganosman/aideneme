import { INDIKATOR_ILE, parametreSinirla, type Parametreler } from '../indicators/kayit';
import type { Olcek } from './olcek';
import type { MetricDef } from './metrics';

/**
 * GRAFİKTEKİ GÖSTERGE → RADAR ÖLÇÜTÜ.
 *
 * Kullanıcı isteği: "açık olan indikatörler parametreleriyle yan tarama
 * sekmesinde filtrelenmeye hazır olmalılar".
 *
 * Buradaki tek iş, grafikte açık duran bir gösterge örneğini radarın
 * anlayacağı ölçüt kimliğine çevirmek. Kimlik PARAMETRELERİ İÇERİYOR, çünkü
 * "EMA 50" ile "EMA 200" ayrı iki ölçüttür; kimlik yalnızca `ema` olsaydı
 * kullanıcı ikisini aynı anda filtreleyemez, üstelik birini filtrelerken
 * ötekinin sayısını görürdü.
 *
 * Kimlik aynı zamanda HESABIN anahtarı: aynı gösterge aynı parametrelerle iki
 * kez açıksa (ayrı panellerde olabilir) worker'da bir kez hesaplanıyor.
 *
 * Bu dosya HESAP İÇERMİYOR — `kayit.ts` gibi yalnızca tanım okuyor. Hesap
 * `indikatorOlcutHesap.ts`'te ve oraya SADECE worker dokunuyor; ikisi tek
 * dosya olsaydı bütün gösterge matematiği ana pakete girerdi (bu oturumda bir
 * kez ölçüldü: SymbolDesk 11,2 → 30,1 kB, açılış 1501 → 1731 ms).
 */

/** Worker'ın bir sembol için hesaplayacağı gösterge. */
export interface OlcutIstegi {
  /** Ölçüt kimliğinin gösterge kısmı: `gos:ema:50`. */
  anahtar: string;
  id: string;
  parametreler: Parametreler;
}

export interface GostergeOlcutu {
  /** Radar ölçüt kimliği: `gos:ema:50:ema`. */
  id: string;
  /** Çizgi etiketi: "EMA 50". */
  etiket: string;
  /** Göstergenin tam adı — listede hangi göstergeden geldiğini söyler. */
  gosterge: string;
  /** Kıyasa girebilmesi için gerekli; yoksa yalnızca sabit eşikle filtrelenir. */
  olcek?: Olcek;
  istek: OlcutIstegi;
}

/** Parametreleri şemadaki SIRAYLA yazar — kimlik böylece kararlı olur. */
function parametreEki(indId: string, p: Parametreler): string {
  const t = INDIKATOR_ILE.get(indId);
  if (!t) return '';
  return t.parametreler.map((s) => p[s.ad]).join('-');
}

/** Bir göstergenin ölçüt anahtarı (çıktı adı olmadan). */
export function gostergeAnahtari(indId: string, p: Parametreler): string {
  return `gos:${indId}:${parametreEki(indId, p)}`;
}

/** Tek bir çıktının ölçüt kimliği. */
export function gostergeOlcutId(indId: string, p: Parametreler, ciktiAd: string): string {
  return `${gostergeAnahtari(indId, p)}:${ciktiAd}`;
}

/** Bir ölçüt kimliği grafikten gelen bir göstergeye mi ait? */
export function gostergeOlcutuMu(id: string): boolean {
  return id.startsWith('gos:');
}

/**
 * Açık gösterge örneklerinden radar ölçütleri.
 *
 * Aynı gösterge + aynı parametre iki kez açıksa TEK kayıt üretiliyor:
 * kullanıcı aynı ölçütü listede iki kez görmemeli ve worker onu iki kez
 * hesaplamamalı.
 *
 * Kullanıcının kendi yazdığı göstergeler (`kul:` önekli) BURAYA GİRMİYOR —
 * ama artık radara giriyorlar, başka kapıdan: `kullaniciOlcut.ts`. Sebep
 * yapısal: burada ölçüt kimliği tanımdan ÖNCEDEN türetiliyor, kullanıcı
 * göstergesinde ise çıktıları kodun kendisi üretiyor, yani kimlik ancak kod
 * koştuktan sonra biliniyor. (Bu yorumun eski hâli "600 sembol için pratik
 * değil" diyordu; ölçüldü ve yanlış çıktı — bir derlemeyle 584 sembol 2,7 ms.)
 */
export function gostergeOlcutleri(
  ornekler: { id: string; parametreler: Parametreler }[],
): GostergeOlcutu[] {
  const out: GostergeOlcutu[] = [];
  const gorulen = new Set<string>();
  for (const o of ornekler) {
    const t = INDIKATOR_ILE.get(o.id);
    if (!t) continue;
    const p = parametreSinirla(t, o.parametreler);
    const anahtar = gostergeAnahtari(o.id, p);
    if (gorulen.has(anahtar)) continue;
    gorulen.add(anahtar);
    for (const c of t.ciktilar(p)) {
      out.push({
        id: `${anahtar}:${c.ad}`,
        etiket: c.etiket,
        gosterge: t.ad,
        olcek: c.olcek,
        istek: { anahtar, id: o.id, parametreler: p },
      });
    }
  }
  return out;
}

/** Worker'a gidecek istekler — çıktı başına değil, GÖSTERGE başına bir tane. */
export function olcutIstekleri(olcutler: GostergeOlcutu[]): OlcutIstegi[] {
  const out: OlcutIstegi[] = [];
  const gorulen = new Set<string>();
  for (const m of olcutler) {
    if (gorulen.has(m.istek.anahtar)) continue;
    gorulen.add(m.istek.anahtar);
    out.push(m.istek);
  }
  return out;
}

/**
 * Radar sütun/filtre makinesinin beklediği tanım.
 *
 * `formula` sağlaması (provenance) burada da veriliyor: kullanıcı bir sayıyı
 * neye dayanarak süzdüğünü görebilmeli. Gösterge ölçütünde bu, göstergenin
 * adı ve parametreleri.
 */
export function olcutTanimi(m: GostergeOlcutu): MetricDef {
  const p = m.istek.parametreler;
  const parcalar = Object.entries(p).map(([ad, v]) => `${ad}=${v}`);
  return {
    id: m.id,
    label: m.etiket,
    unit: birimi(m.olcek),
    decimals: m.olcek === 'hacim' || m.olcek === 'para' ? 0 : 2,
    formula: () => `${m.gosterge}${parcalar.length ? ` (${parcalar.join(', ')})` : ''} — son bar`,
  };
}

function birimi(o: Olcek | undefined): MetricDef['unit'] {
  switch (o) {
    case 'fiyat':
    case 'fiyatFarki':
      return 'price';
    case 'yuzde':
      return 'pct';
    case 'yuzde0100':
      return 'level';
    case 'para':
      return 'money';
    default:
      return 'ratio';
  }
}

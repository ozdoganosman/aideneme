import type { CikisTanimi } from '../indicators/kayit';
import type { Olcek } from './olcek';
import type { MetricDef } from './metrics';

/**
 * KULLANICININ KENDİ GÖSTERGESİ → RADAR ÖLÇÜTÜ.
 *
 * Kayıt defterindeki göstergeler için `indikatorOlcut.ts` var; oradaki
 * ölçüt kimliği tanımdan ÖNCEDEN türetiliyor çünkü çıktılar kayıtta yazılı.
 * Kullanıcı göstergesinde bu mümkün değil: çıktıları kodun kendisi
 * (`ciktilar(p)`) üretiyor ve kod korumalı alanda koşuyor. Yani kimlik ve
 * etiket ancak toplu koşturma DÖNDÜKTEN sonra biliniyor. Bu dosya o dönüşü
 * ölçüte çeviriyor.
 *
 * Kimlik `kul:` önekli gösterge kimliğiyle başlıyor — `gos:` (kayıt) ile
 * çakışmıyor, `kullaniciMi()` bunu ayırt ediyor.
 */

export interface KullaniciOlcutu {
  id: string;
  etiket: string;
  /** Göstergenin adı — kaynağını söyler. */
  gosterge: string;
  /** Kullanıcı ölçek bildirdiyse; yoksa kıyasa girmez. */
  olcek?: Olcek;
  /** Kaçıncı çıktı — toplu sonuçtaki dizide indeks. */
  sira: number;
}

/** Parametreleri ad sırasına göre yazar — kimlik nesne sırasından bağımsız. */
export function kullaniciParametreEki(p: Record<string, number>): string {
  return Object.keys(p)
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join(',');
}

/** Gösterge + parametre anahtarı: aynı kod aynı ayarla bir kez koşar. */
export function kullaniciAnahtari(gostergeId: string, p: Record<string, number>): string {
  return `${gostergeId}:${kullaniciParametreEki(p)}`;
}

export function kullaniciOlcutId(
  gostergeId: string,
  p: Record<string, number>,
  ciktiAd: string,
): string {
  return `${kullaniciAnahtari(gostergeId, p)}:${ciktiAd}`;
}

/** Toplu sonucun çıktı tanımlarından ölçütler. */
export function kullaniciOlcutleri(
  gostergeId: string,
  p: Record<string, number>,
  gostergeAdi: string,
  ciktilar: CikisTanimi[],
): KullaniciOlcutu[] {
  return ciktilar.map((c, i) => ({
    id: kullaniciOlcutId(gostergeId, p, c.ad),
    etiket: c.etiket,
    gosterge: gostergeAdi,
    olcek: c.olcek,
    sira: i,
  }));
}

/** Radar makinesinin beklediği tanım; sağlamada göstergenin adı ve ayarı. */
export function kullaniciOlcutTanimi(m: KullaniciOlcutu, p: Record<string, number>): MetricDef {
  const ek = kullaniciParametreEki(p);
  return {
    id: m.id,
    label: m.etiket,
    unit: birimi(m.olcek),
    decimals: m.olcek === 'hacim' || m.olcek === 'para' ? 0 : 2,
    formula: () => `${m.gosterge} (kendi göstergen${ek ? `, ${ek}` : ''}) — son bar`,
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
    case 'oran':
      return 'ratio';
    default:
      /*
        ÖLÇEK BİLDİRİLMEMİŞ → BİRİM EKİ YOK.

        Gerçek veride görüldü: "Ortalama Farkı" (fiyat farkı) göstergesi
        radarda "-6.425,66×" diye çıkıyordu — kullanıcı ölçek yazmamıştı,
        varsayılan 'ratio' da "×" ekliyordu. Bilmediğimiz birimi iddia etmek
        yanlış; 'level' biçimleyicide eksiz düz sayı veriyor. Kıyas kovasına
        etkisi yok: kıyas `olcek` alanına bakıyor, buna değil.
      */
      return 'level';
  }
}

/**
 * DAĞILIM ÖZETİ — "senin göstergen bugün piyasada nerede?"
 *
 * Beş sayı: en düşük, alt çeyrek, medyan, üst çeyrek, en yüksek. Ortalama
 * yok: tek bir aykırı değer ortalamayı sürükler, çeyrekleri sürüklemez.
 * Ölçülemeyen (NaN) sayılmıyor ve KAÇ tane olduğu söyleniyor — payda
 * küçülünce söylenir.
 */
export interface Dagilim {
  n: number;
  olculemeyen: number;
  min: number;
  c25: number;
  medyan: number;
  c75: number;
  max: number;
}

function ceyrek(sirali: number[], q: number): number {
  if (sirali.length === 0) return Number.NaN;
  const yer = (sirali.length - 1) * q;
  const alt = Math.floor(yer);
  const ust = Math.ceil(yer);
  if (alt === ust) return sirali[alt];
  const t = yer - alt;
  return sirali[alt] * (1 - t) + sirali[ust] * t;
}

export function dagilim(degerler: Iterable<number>): Dagilim {
  const d: number[] = [];
  let olculemeyen = 0;
  for (const v of degerler) {
    if (Number.isFinite(v)) d.push(v);
    else olculemeyen++;
  }
  d.sort((a, b) => a - b);
  return {
    n: d.length,
    olculemeyen,
    min: d.length ? d[0] : Number.NaN,
    c25: ceyrek(d, 0.25),
    medyan: ceyrek(d, 0.5),
    c75: ceyrek(d, 0.75),
    max: d.length ? d[d.length - 1] : Number.NaN,
  };
}

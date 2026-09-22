import type { Candles } from '../core/data/types';
import {
  KITAPLIK,
  ciktiDogrula,
  cikisDogrula,
  kaynakTara,
  ustveriDogrula,
  type KullaniciUstverisi,
} from '../core/indicators/kullanici';
import type { CikisTanimi } from '../core/indicators/kayit';

/**
 * KULLANICI GÖSTERGESİNİ ÇALIŞTIRMA — saf çekirdek.
 *
 * Worker'ın içinde koşacak ama worker'a BAĞLI değil: böylece testte de
 * koşuyor ve yalıtımın kendisi sınanabiliyor.
 *
 * Yalıtım üç katman:
 *   1. ORTAM — worker başlangıcında tehlikeli küresel nesneler sökülüyor
 *      (bkz. gosterge.worker.ts). DOM zaten yok.
 *   2. KAPSAM — kod, tehlikeli adları GÖLGELEYEN bir fonksiyon içinde
 *      değerlendiriliyor: `self`, `globalThis`, `fetch`… hepsi undefined.
 *   3. KAYNAK — `import()`/`require()` metinsel olarak reddediliyor
 *      (ağa çıkabilen tek yapı ve göstergenin ona ihtiyacı yok).
 *
 * Hiçbiri tek başına "güvenli" değil ve öyle iddia edilmiyor. Bu yüzden
 * DÖRDÜNCÜ kural arayüzde: başkasından gelen kod asla sorulmadan
 * çalıştırılmaz.
 */

/** Kapsamda GÖLGELENECEK adlar — hepsi `undefined` olarak geçiliyor. */
const GOLGELENEN = [
  'self',
  'globalThis',
  'global',
  'window',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
  'navigator',
  'location',
  'postMessage',
  'addEventListener',
  'removeEventListener',
  /*
    `eval` ve `arguments` BURADA YOK ve olamaz: katı kipte parametre adı
    olarak kullanılamıyorlar (JS sözdizimi kuralı, "Unexpected eval or
    arguments in strict mode"). Ölçüldü — listeye konduğunda hiçbir gösterge
    çalışmıyordu.

    Bu bir boşluk ama kapalı bir boşluk: `eval` ile ulaşılacak küresel kapsam
    da zaten sökülmüş oluyor (1. katman, gosterge.worker.ts). Yani gölgeleme
    olmadan da oradan `fetch` bulunamıyor.
  */
  'Function',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
] as const;

export interface CalismaSonucu {
  ustveri: KullaniciUstverisi;
  ciktilar: CikisTanimi[];
  degerler: Float64Array[];
}

export type Sonuc = { tamam: true; deger: CalismaSonucu } | { tamam: false; hata: string };

/** Bir kez derlenmiş gösterge: kaynak değerlendirildi, üstverisi doğrulandı. */
export interface DerliGosterge {
  ustveri: KullaniciUstverisi;
  nesne: {
    hesapla: (c: Candles, p: Record<string, number>, lib: typeof KITAPLIK) => unknown;
    ciktilar?: (p: Record<string, number>) => unknown;
  };
}

export type DerlemeSonucu = { tamam: true; deger: DerliGosterge } | { tamam: false; hata: string };

/**
 * Kaynağı DEĞERLENDİR — bir kez.
 *
 * Tek sembol yolunda kaynak her çağrıda yeniden değerlendiriliyordu ve bu
 * doğruydu: çağrılar arasında durum taşınmıyor. Toplu yolda aynı kaynağı 582
 * kez değerlendirmek anlamsız; değerlendirme bir, koşturma çok. Durum sızıntısı
 * kaygısı yine karşılanıyor: `hesapla` saf olmak zorunda değil ama her sembol
 * için AYNI parametre nesnesi ve AYNI kitaplık geçiliyor; sembolden sembole
 * taşınabilecek tek şey kullanıcının kendi kapanışındaki değişkenler — bu da
 * tek sembol yolunda `ciktilar`/`hesapla` arasında zaten mümkündü.
 */
export function gostergeDerle(kaynak: string): DerlemeSonucu {
  const tarama = kaynakTara(kaynak);
  if (!tarama.tamam) return { tamam: false, hata: tarama.hata };

  let nesne: unknown;
  try {
    const fabrika = new Function(...GOLGELENEN, `'use strict'; return (${kaynak});`) as (
      ...args: undefined[]
    ) => unknown;
    nesne = fabrika(...GOLGELENEN.map(() => undefined));
  } catch (err) {
    return { tamam: false, hata: `Kod çalıştırılamadı: ${mesaj(err)}` };
  }

  const ustveri = ustveriDogrula(nesne);
  if (!ustveri.tamam) return { tamam: false, hata: ustveri.hata };
  return {
    tamam: true,
    deger: { ustveri: ustveri.deger, nesne: nesne as DerliGosterge['nesne'] },
  };
}

/** Parametreleri ŞEMAYA göre sınırla — sınır tek yerde. */
export function parametreSinirla(
  ustveri: KullaniciUstverisi,
  parametreler: Record<string, number>,
): Record<string, number> {
  const p: Record<string, number> = {};
  for (const s of ustveri.parametreler) {
    const ham = parametreler[s.ad];
    const v = Number.isFinite(ham) ? ham : s.varsayilan;
    const sinirli = Math.min(s.max, Math.max(s.min, v));
    p[s.ad] = s.ondalik ? sinirli : Math.round(sinirli);
  }
  return p;
}

/** Çıktı tanımlarını al ve doğrula (yalnızca parametreye bağlı, sembole değil). */
export function gostergeCiktilari(
  d: DerliGosterge,
  p: Record<string, number>,
): { tamam: true; deger: CikisTanimi[] } | { tamam: false; hata: string } {
  let ham: unknown;
  try {
    ham = d.nesne.ciktilar ? d.nesne.ciktilar(p) : undefined;
  } catch (err) {
    return { tamam: false, hata: `ciktilar() hata verdi: ${mesaj(err)}` };
  }
  return cikisDogrula(ham, d.ustveri.kisa);
}

/** Derli göstergeyi TEK seride koştur ve çıktıyı doğrula. */
export function gostergeHesapla(
  d: DerliGosterge,
  c: Candles,
  p: Record<string, number>,
  ciktiSayisi: number,
): { tamam: true; deger: Float64Array[] } | { tamam: false; hata: string } {
  let ham: unknown;
  try {
    ham = d.nesne.hesapla(c, p, KITAPLIK);
  } catch (err) {
    return { tamam: false, hata: `hesapla() hata verdi: ${mesaj(err)}` };
  }
  return ciktiDogrula(ham, c.length, ciktiSayisi);
}

/**
 * Kaynağı değerlendirip göstergeyi hesapla — tek sembol yolu.
 *
 * Derle + çıktılar + koştur bileşimi; davranışı önceki tek parça sürümle
 * aynı (testleri değişmedi).
 */
export function gostergeCalistir(
  kaynak: string,
  c: Candles,
  parametreler: Record<string, number>,
): Sonuc {
  const derli = gostergeDerle(kaynak);
  if (!derli.tamam) return derli;
  const p = parametreSinirla(derli.deger.ustveri, parametreler);
  const ciktilar = gostergeCiktilari(derli.deger, p);
  if (!ciktilar.tamam) return ciktilar;
  const degerler = gostergeHesapla(derli.deger, c, p, ciktilar.deger.length);
  if (!degerler.tamam) return degerler;
  return {
    tamam: true,
    deger: { ustveri: derli.deger.ustveri, ciktilar: ciktilar.deger, degerler: degerler.deger },
  };
}

/** Toplu koşturmanın sonucu: sembol başına SON BAR değerleri. */
export interface TopluSonuc {
  ustveri: KullaniciUstverisi;
  ciktilar: CikisTanimi[];
  /** sembol → çıktı sırasıyla son bar değeri (NaN olabilir). */
  degerler: Record<string, number[]>;
  /** sembol → o sembolde hesap neden düştü. Derleme hatası buraya girmez. */
  hatalar: Record<string, string>;
  /** Denenen sembol sayısı. */
  sayi: number;
}

export type TopluSonucu = { tamam: true; deger: TopluSonuc } | { tamam: false; hata: string };

/**
 * GÖSTERGEYİ PİYASADA KOŞTUR — bir derleme, çok sembol.
 *
 * Radar için: her sembolün yalnızca SON BAR değeri lazım (bugün nerede?).
 * Tam serileri geri taşımak 582 × 250 × çıktı sayısı kadar sayı olurdu;
 * burada sembol başına birkaç sayı dönüyor.
 *
 * SEMBOL BAŞINA HATA TOPLU İŞİ DÜŞÜRMÜYOR. Kullanıcının kodu bir sembolde
 * (örn. 33 barlık ISKUR'da dizi sınırı) patlayabilir; geri kalan 581 sembol
 * için sonucu atmak yanlış olurdu. O sembol `hatalar`a yazılıyor, değeri NaN
 * kalıyor — radar da NaN'ı "ölçülemedi" diye sayıyor. Derleme hatası ise
 * TÜMÜNÜ düşürüyor: kod çalışmıyorsa hiçbir sembol için sonuç yok.
 *
 * `kesici` verilirse her seri önce ondan geçiyor (zaman makinesi: seriyi o
 * güne kadar kes). Buraya bir tarih değil fonksiyon geliyor ki bu dosya
 * paketten ve günlerden habersiz kalsın.
 */
export function gostergeTopluCalistir(
  kaynak: string,
  seriler: Iterable<readonly [string, Candles]>,
  parametreler: Record<string, number>,
  kesici?: (c: Candles) => Candles,
): TopluSonucu {
  const derli = gostergeDerle(kaynak);
  if (!derli.tamam) return derli;
  const p = parametreSinirla(derli.deger.ustveri, parametreler);
  const ciktilar = gostergeCiktilari(derli.deger, p);
  if (!ciktilar.tamam) return ciktilar;

  const degerler: Record<string, number[]> = {};
  const hatalar: Record<string, string> = {};
  let sayi = 0;
  for (const [sembol, ham] of seriler) {
    sayi++;
    const c = kesici ? kesici(ham) : ham;
    if (c.length === 0) {
      degerler[sembol] = ciktilar.deger.map(() => Number.NaN);
      continue;
    }
    const r = gostergeHesapla(derli.deger, c, p, ciktilar.deger.length);
    if (!r.tamam) {
      hatalar[sembol] = r.hata;
      degerler[sembol] = ciktilar.deger.map(() => Number.NaN);
      continue;
    }
    degerler[sembol] = r.deger.map((dizi) => dizi[dizi.length - 1]);
  }
  return {
    tamam: true,
    deger: { ustveri: derli.deger.ustveri, ciktilar: ciktilar.deger, degerler, hatalar, sayi },
  };
}

function mesaj(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

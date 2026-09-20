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

/**
 * Kaynağı değerlendirip göstergeyi hesapla.
 *
 * Kaynak HER ÇAĞRIDA yeniden değerlendiriliyor: çağrılar arasında durum
 * taşınmıyor, yani bir hesap ötekini kirletemiyor. Maliyeti hesabın yanında
 * önemsiz.
 */
export function gostergeCalistir(
  kaynak: string,
  c: Candles,
  parametreler: Record<string, number>,
): Sonuc {
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

  const o = nesne as {
    hesapla: (c: Candles, p: Record<string, number>, lib: typeof KITAPLIK) => unknown;
    ciktilar?: (p: Record<string, number>) => unknown;
  };

  // Parametreler ŞEMAYA göre sınırlanıyor: kullanıcı kodunun bozuk bir sayı
  // görmesi gerekmiyor ve sınır tek yerde kalıyor.
  const p: Record<string, number> = {};
  for (const s of ustveri.deger.parametreler) {
    const ham = parametreler[s.ad];
    const v = Number.isFinite(ham) ? ham : s.varsayilan;
    const sinirli = Math.min(s.max, Math.max(s.min, v));
    p[s.ad] = s.ondalik ? sinirli : Math.round(sinirli);
  }

  let hamCikis: unknown;
  try {
    hamCikis = o.ciktilar ? o.ciktilar(p) : undefined;
  } catch (err) {
    return { tamam: false, hata: `ciktilar() hata verdi: ${mesaj(err)}` };
  }
  const ciktilar = cikisDogrula(hamCikis, ustveri.deger.kisa);
  if (!ciktilar.tamam) return { tamam: false, hata: ciktilar.hata };

  let hamDeger: unknown;
  try {
    hamDeger = o.hesapla(c, p, KITAPLIK);
  } catch (err) {
    return { tamam: false, hata: `hesapla() hata verdi: ${mesaj(err)}` };
  }
  const degerler = ciktiDogrula(hamDeger, c.length, ciktilar.deger.length);
  if (!degerler.tamam) return { tamam: false, hata: degerler.hata };

  return {
    tamam: true,
    deger: { ustveri: ustveri.deger, ciktilar: ciktilar.deger, degerler: degerler.deger },
  };
}

function mesaj(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

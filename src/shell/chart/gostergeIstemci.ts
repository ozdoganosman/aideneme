import type { Candles } from '../../core/data/types';
import type { CikisTanimi } from '../../core/indicators/kayit';
import type { KullaniciUstverisi } from '../../core/indicators/kullanici';
import type { TopluSonuc } from '../../workers/gostergeCalistir';

/**
 * Kullanıcı göstergesi istemcisi.
 *
 * Worker HER İSTEKTE yeniden kuruluyor ve iş bitince kapatılıyor. Pahalı
 * görünüyor ama kasıtlı: sonsuz döngüye giren bir gösterge kodunu durdurmanın
 * tek yolu worker'ı SONLANDIRMAK. Havuzda tutulan bir worker'da böyle bir kod
 * o worker'ı kalıcı olarak kilitlerdi.
 */

export interface GostergeSonucu {
  ustveri: KullaniciUstverisi;
  ciktilar: CikisTanimi[];
  degerler: Float64Array[];
}

/** Sonsuz döngü koruması: bu süreyi aşan gösterge durduruluyor. */
export const ZAMAN_SINIRI_MS = 3000;

export async function gostergeCalistirUzak(
  kaynak: string,
  candles: Candles,
  parametreler: Record<string, number>,
  zamanSiniri = ZAMAN_SINIRI_MS,
): Promise<{ tamam: true; deger: GostergeSonucu } | { tamam: false; hata: string }> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('../../workers/gosterge.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return {
      tamam: false,
      hata:
        'Bu tarayıcıda arka plan işçisi başlatılamadı; kendi göstergen çalıştırılamıyor. ' +
        'Katı bir içerik güvenliği politikası ya da bir eklenti engelliyor olabilir.',
    };
  }

  return new Promise((resolve) => {
    const bitir = (
      sonuc: { tamam: true; deger: GostergeSonucu } | { tamam: false; hata: string },
    ) => {
      clearTimeout(sayac);
      worker.terminate();
      resolve(sonuc);
    };
    const sayac = setTimeout(() => {
      bitir({
        tamam: false,
        hata: `Gösterge ${zamanSiniri} ms içinde bitmedi ve durduruldu. Sonsuz döngü olabilir.`,
      });
    }, zamanSiniri);

    worker.onmessage = (event: MessageEvent) => {
      const d = event.data as
        ({ id: number; ok: true } & GostergeSonucu) | { id: number; ok: false; hata: string };
      if (d.ok)
        bitir({
          tamam: true,
          deger: { ustveri: d.ustveri, ciktilar: d.ciktilar, degerler: d.degerler },
        });
      else bitir({ tamam: false, hata: d.hata });
    };
    worker.onerror = (e) => {
      // Worker'ın kendisi çöktüyse mesaj hiç gelmez; sessiz kalmak kullanıcıyı
      // "hesaplanıyor" ekranında bırakırdı.
      bitir({ tamam: false, hata: `Gösterge çöktü: ${e.message || 'bilinmeyen hata'}` });
    };

    worker.postMessage({ id: 1, kaynak, candles, parametreler });
  });
}

/**
 * Toplu koşturma için zaman sınırı.
 *
 * ÖLÇÜLDÜ (gerçek BIST paketi, 584 sembol, örnek gösterge, Node):
 *   paket çözme 0,6 ms · toplu koşturma medyan 2,7 ms (min 2,1 · maks 8,3).
 * Yani "sembol başına ayrı worker, her biri 3 s" mimarisi büyüklük
 * mertebeleriyle gereksizdi.
 *
 * 10 s, 6× yavaş makinede (~16 ms) bile 600 kat pay bırakıyor; buna
 * ulaşan bir gösterge sonsuz döngüde ya da O(n³) — ikisi de durdurulmalı.
 * Tek sembol sınırı (3 s) ayrı duruyor: oradaki iş çok daha küçük.
 */
export const TOPLU_ZAMAN_SINIRI_MS = 10_000;

export type TopluGostergeSonucu =
  { tamam: true; deger: TopluSonuc } | { tamam: false; hata: string };

/**
 * Kullanıcı göstergesini PİYASA PAKETİNDE koştur — bir derleme, 582 sembol.
 *
 * Aynı "her istekte taze worker" düzeni: sonsuz döngü ancak worker
 * sonlandırılarak durdurulabiliyor. Paket kopyası aktarılıyor (transfer),
 * klonlanmıyor: 3 MB'ı bir daha kopyalamanın anlamı yok, kopya zaten bu
 * worker'a özel.
 */
export async function gostergeTopluCalistirUzak(
  kaynak: string,
  paket: ArrayBuffer,
  parametreler: Record<string, number>,
  tCut?: number,
  zamanSiniri = TOPLU_ZAMAN_SINIRI_MS,
): Promise<TopluGostergeSonucu> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('../../workers/gosterge.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return {
      tamam: false,
      hata: 'Bu tarayıcıda arka plan işçisi başlatılamadı; kendi göstergen piyasada koşturulamıyor.',
    };
  }

  return new Promise((resolve) => {
    const bitir = (sonuc: TopluGostergeSonucu) => {
      clearTimeout(sayac);
      worker.terminate();
      resolve(sonuc);
    };
    const sayac = setTimeout(() => {
      bitir({
        tamam: false,
        hata: `Gösterge tüm piyasada ${zamanSiniri} ms içinde bitmedi ve durduruldu. Sembol başına maliyeti yüksek olabilir.`,
      });
    }, zamanSiniri);

    worker.onmessage = (event: MessageEvent) => {
      const d = event.data as
        ({ id: number; ok: true } & TopluSonuc) | { id: number; ok: false; hata: string };
      if (d.ok) {
        const { id: _id, ok: _ok, ...deger } = d;
        bitir({ tamam: true, deger });
      } else bitir({ tamam: false, hata: d.hata });
    };
    worker.onerror = (e) => {
      bitir({ tamam: false, hata: `Gösterge çöktü: ${e.message || 'bilinmeyen hata'}` });
    };

    const kopya = paket.slice(0);
    worker.postMessage({ id: 1, toplu: true, kaynak, buffer: kopya, parametreler, tCut }, [kopya]);
  });
}

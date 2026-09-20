import type { Candles } from '../../core/data/types';
import type { CikisTanimi } from '../../core/indicators/kayit';
import type { KullaniciUstverisi } from '../../core/indicators/kullanici';

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

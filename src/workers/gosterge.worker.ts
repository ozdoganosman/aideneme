/// <reference lib="webworker" />
import { gostergeCalistir, gostergeTopluCalistir } from './gostergeCalistir';
import { decodeBundle } from '../core/data/pack';
import { kesZaman } from '../core/data/kes';
import type { Candles } from '../core/data/types';

/**
 * KULLANICI GÖSTERGESİ WORKER'I — yalıtımın 1. katmanı (ortam).
 *
 * Analiz worker'ından AYRI. Sebebi: analiz worker'ı piyasa paketini ve
 * uygulamanın tüm hesabını taşıyor; kullanıcı kodunu oraya sokmak, ona
 * uygulamanın verisiyle aynı odada yer vermek olurdu. Burada yalnızca tek
 * sembolün mumları ve kullanıcının kendi kodu var.
 *
 * Kod değerlendirilmeden ÖNCE tehlikeli küresel nesneler sökülüyor. Silinemeyen
 * (yapılandırılamaz) alanlar için `undefined` yazmaya çalışılıyor; ikisi de
 * olmazsa en azından gölgeleme katmanı (gostergeCalistir) duruyor.
 */

const SOKULECEK = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'Notification',
  'crypto',
];

for (const ad of SOKULECEK) {
  try {
    delete (self as unknown as Record<string, unknown>)[ad];
  } catch {
    // Yapılandırılamaz alan: silinemiyorsa üzerine yazmayı dene.
  }
  try {
    Object.defineProperty(self, ad, { value: undefined, configurable: true, writable: true });
  } catch {
    // İkisi de olmadıysa gölgeleme katmanı devrede kalıyor; sessizce devam.
  }
}

export interface GostergeIstegi {
  id: number;
  kaynak: string;
  candles: Candles;
  parametreler: Record<string, number>;
}

/**
 * TOPLU istek: tek sembol yerine PİYASA PAKETİ.
 *
 * Paket buraya kopya olarak geliyor ve worker iş bitince kapatılıyor; yani
 * kullanıcı kodu paketi görebilecek olsa bile (göremiyor — ona yalnızca tek
 * sembolün mumları geçiliyor, küreseller gölgeli) bu paket herkese açık
 * piyasa verisi ve worker'la birlikte yok oluyor. Tek sembol yolundaki
 * yalıtım gerekçesi olduğu gibi duruyor: analiz worker'ına GİRMİYOR.
 *
 * `tCut` verilirse her seri o güne kadar kesiliyor (zaman makinesi).
 */
export interface TopluGostergeIstegi {
  id: number;
  toplu: true;
  kaynak: string;
  buffer: ArrayBuffer;
  parametreler: Record<string, number>;
  tCut?: number;
}

self.onmessage = (event: MessageEvent<GostergeIstegi | TopluGostergeIstegi>) => {
  const d = event.data;
  if ('toplu' in d) {
    const { id, kaynak, buffer, parametreler, tCut } = d;
    let yanit: unknown;
    try {
      const paket = decodeBundle(buffer);
      const seriler = (function* () {
        for (const ad of paket.names) {
          const c = paket.seriesOf(ad);
          if (c) yield [ad, c] as const;
        }
      })();
      const kesici = tCut !== undefined ? (c: Candles) => kesZaman(c, tCut) : undefined;
      const sonuc = gostergeTopluCalistir(kaynak, seriler, parametreler, kesici);
      yanit = sonuc.tamam
        ? { id, ok: true as const, ...sonuc.deger }
        : { id, ok: false as const, hata: sonuc.hata };
    } catch (err) {
      yanit = {
        id,
        ok: false as const,
        hata: `Paket okunamadı: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    (self as unknown as Worker).postMessage(yanit);
    return;
  }
  const { id, kaynak, candles, parametreler } = d;
  const sonuc = gostergeCalistir(kaynak, candles, parametreler);
  const yanit = sonuc.tamam
    ? { id, ok: true as const, ...sonuc.deger }
    : { id, ok: false as const, hata: sonuc.hata };
  (self as unknown as Worker).postMessage(yanit);
};

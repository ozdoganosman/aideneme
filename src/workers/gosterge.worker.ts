/// <reference lib="webworker" />
import { gostergeCalistir } from './gostergeCalistir';
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

self.onmessage = (event: MessageEvent<GostergeIstegi>) => {
  const { id, kaynak, candles, parametreler } = event.data;
  const sonuc = gostergeCalistir(kaynak, candles, parametreler);
  const yanit = sonuc.tamam
    ? { id, ok: true as const, ...sonuc.deger }
    : { id, ok: false as const, hata: sonuc.hata };
  (self as unknown as Worker).postMessage(yanit);
};

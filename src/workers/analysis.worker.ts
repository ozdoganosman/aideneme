/// <reference lib="webworker" />
import { createHandler } from './handler';
import type { WorkerRequest } from './protocol';

// İnce kabuk: tüm iş handler'da (test edilebilir), burada yalnızca mesaj borusu.
const handle = createHandler();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const response = handle(event.data);
  // Büyük tipli diziler kopyalanmadan AKTARILIYOR: korelasyon matrisi ve
  // para akışı karelerinin sembol × gün tamponları.
  const transfer = !response.ok
    ? undefined
    : response.type === 'correlate'
      ? [response.matrix.buffer]
      : response.type === 'akisGunleri'
        ? [response.deger.buffer, response.degisim.buffer, response.gunler.buffer]
        : undefined;
  (self as unknown as Worker).postMessage(response, { transfer });
};

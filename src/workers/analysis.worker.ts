/// <reference lib="webworker" />
import { createHandler } from './handler';
import type { WorkerRequest } from './protocol';

// İnce kabuk: tüm iş handler'da (test edilebilir), burada yalnızca mesaj borusu.
const handle = createHandler();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const response = handle(event.data);
  // Korelasyon matrisi büyük olabilir → kopyalamadan aktar.
  const transfer =
    response.ok && response.type === 'correlate' ? [response.matrix.buffer] : undefined;
  (self as unknown as Worker).postMessage(response, { transfer });
};

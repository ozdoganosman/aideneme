import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * Küçük bir Worker havuzu.
 *
 * Neden hazır kütüphane değil: ihtiyacımız olan yüzey küçük (istek/yanıt
 * eşleme + boşta olana dağıtma + hepsine yayınlama) ve `spawn`'ı enjekte
 * edebilmek testte gerçek Worker gerektirmiyor. Bağımlılık eklemeden aynı işi
 * görüyor.
 */

export interface WorkerLike {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  terminate: () => void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror?: ((event: unknown) => void) | null;
}

type Pending = {
  resolve: (r: WorkerResponse) => void;
  reject: (e: Error) => void;
};

interface Slot {
  worker: WorkerLike;
  busy: boolean;
}

export interface Pool {
  readonly size: number;
  /** Aynı isteği tüm worker'lara gönderir (her birine kendi kopyası). */
  broadcast: (
    make: (id: number) => WorkerRequest,
    transfer?: (req: WorkerRequest) => Transferable[],
  ) => Promise<WorkerResponse[]>;
  /** İsteği boştaki bir worker'a verir. */
  run: (make: (id: number) => WorkerRequest) => Promise<WorkerResponse>;
  terminate: () => void;
}

export function createPool(size: number, spawn: () => WorkerLike): Pool {
  const slots: Slot[] = [];
  const pending = new Map<number, Pending>();
  const queue: { make: (id: number) => WorkerRequest; p: Pending }[] = [];
  let nextId = 1;

  for (let i = 0; i < Math.max(1, size); i++) {
    const worker = spawn();
    const slot: Slot = { worker, busy: false };
    worker.onmessage = (event) => {
      const response = event.data;
      slot.busy = false;
      const waiter = pending.get(response.id);
      pending.delete(response.id);
      waiter?.resolve(response);
      pump();
    };
    if ('onerror' in worker) {
      worker.onerror = () => {
        slot.busy = false;
        pump();
      };
    }
    slots.push(slot);
  }

  function send(
    slot: Slot,
    make: (id: number) => WorkerRequest,
    p: Pending,
    transfer?: Transferable[],
  ) {
    const id = nextId++;
    const req = make(id);
    pending.set(id, p);
    slot.busy = true;
    try {
      slot.worker.postMessage(req, transfer);
    } catch (err) {
      pending.delete(id);
      slot.busy = false;
      p.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function pump() {
    while (queue.length) {
      const slot = slots.find((s) => !s.busy);
      if (!slot) return;
      const next = queue.shift()!;
      send(slot, next.make, next.p);
    }
  }

  return {
    size: slots.length,

    broadcast(make, transfer) {
      return Promise.all(
        slots.map(
          (slot) =>
            new Promise<WorkerResponse>((resolve, reject) => {
              const id = nextId++;
              const req = make(id);
              pending.set(id, { resolve, reject });
              try {
                slot.worker.postMessage(req, transfer?.(req));
              } catch (err) {
                pending.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
              }
            }),
        ),
      );
    },

    run(make) {
      return new Promise<WorkerResponse>((resolve, reject) => {
        const p = { resolve, reject };
        const slot = slots.find((s) => !s.busy);
        if (slot) send(slot, make, p);
        else queue.push({ make, p });
      });
    },

    terminate() {
      for (const slot of slots) slot.worker.terminate();
      slots.length = 0;
      queue.length = 0;
      pending.clear();
    },
  };
}

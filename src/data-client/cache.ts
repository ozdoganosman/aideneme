/**
 * İkili dosya önbelleği (IndexedDB).
 *
 * Anahtar içerik hash'i taşır: manifest'teki hash değişmediyse ağa hiç çıkılmaz,
 * değiştiyse eski sürüm anahtarıyla birlikte silinir. Böylece "bayat veriyi
 * gösterme" riski olmadan tekrar ziyaretler anında açılır.
 *
 * Depolama yoksa/çalışmazsa (özel sekme, kota dolu, eski tarayıcı) sessizce
 * devre dışı kalır — uygulama çalışmaya devam eder, sadece her açılışta indirir.
 */
export interface BinaryCache {
  get: (key: string) => Promise<ArrayBuffer | null>;
  put: (key: string, value: ArrayBuffer, evictPrefix?: string) => Promise<void>;
}

const DB_NAME = 'analiz-masasi';
const STORE = 'pack';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Tarayıcı önbelleği; kullanılamıyorsa her çağrı boş döner (hata fırlatmaz). */
export function indexedDbCache(): BinaryCache {
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  const db = () => (dbPromise ??= openDb());

  return {
    async get(key) {
      const database = await db();
      if (!database) return null;
      return new Promise((resolve) => {
        try {
          const req = database.transaction(STORE, 'readonly').objectStore(STORE).get(key);
          req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    },

    async put(key, value, evictPrefix) {
      const database = await db();
      if (!database) return;
      return new Promise((resolve) => {
        try {
          const tx = database.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          store.put(value, key);
          if (evictPrefix) {
            // Aynı dosyanın eski hash'li sürümlerini at — kota şişmesin.
            const cursorReq = store.openKeyCursor();
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (!cursor) return;
              const k = String(cursor.key);
              if (k !== key && k.startsWith(evictPrefix)) store.delete(cursor.key);
              cursor.continue();
            };
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
    },
  };
}

/** Bellek içi önbellek — testler ve depolamasız ortamlar için. */
export function memoryCache(): BinaryCache {
  const map = new Map<string, ArrayBuffer>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async put(key, value, evictPrefix) {
      if (evictPrefix) {
        for (const k of map.keys()) if (k !== key && k.startsWith(evictPrefix)) map.delete(k);
      }
      map.set(key, value);
    },
  };
}

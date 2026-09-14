import {
  decodeBundle,
  decodeSeries,
  isManifest,
  type Bundle,
  type Manifest,
  type ManifestEntry,
} from '../core/data/pack';
import type { Candles } from '../core/data/types';
import { indexedDbCache, type BinaryCache } from './cache';
import { packPath, type Market } from './markets';

/**
 * Veri istemcisi: manifest → (önbellek | ağ) → saf çözücü.
 *
 * Ağ ve depolama burada; çözümleme `core/data/pack.ts` içinde saf. Böylece
 * format testleri ağ kurgusu olmadan, istemci testleri de gerçek IndexedDB
 * olmadan çalışabiliyor (ikisi de enjekte edilebilir).
 */
export interface DataClientOptions {
  fetchImpl?: typeof fetch;
  cache?: BinaryCache;
}

export interface SeriesResult {
  candles: Candles;
  entry: ManifestEntry;
  /** Veri önbellekten mi geldi (ağ turu yapılmadı mı)? */
  fromCache: boolean;
}

export class DataClient {
  private readonly fetchImpl: typeof fetch;
  private readonly cache: BinaryCache;
  private readonly manifests = new Map<Market, Promise<Manifest>>();
  private readonly bundles = new Map<Market, Promise<Bundle>>();

  constructor(options: DataClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.cache = options.cache ?? indexedDbCache();
  }

  /** Manifest her oturumda bir kez indirilir (önbelleğe alınmaz: tazelik ölçüsü odur). */
  manifest(market: Market, signal?: AbortSignal): Promise<Manifest> {
    const existing = this.manifests.get(market);
    if (existing) return existing;

    const promise = (async () => {
      const res = await this.fetchImpl(packPath(market, 'manifest.json'), { signal });
      if (!res.ok) throw new Error(`${market}: manifest okunamadı (HTTP ${res.status})`);
      const json: unknown = await res.json();
      if (!isManifest(json)) throw new Error(`${market}: manifest biçimi tanınmadı`);
      return json;
    })().catch((err) => {
      this.manifests.delete(market); // başarısız denemeyi kalıcı kılma
      throw err;
    });

    this.manifests.set(market, promise);
    return promise;
  }

  /** Bir sembolün tam geçmişi. */
  async series(market: Market, symbol: string, signal?: AbortSignal): Promise<SeriesResult> {
    const manifest = await this.manifest(market, signal);
    const entry = manifest.symbols[symbol];
    if (!entry) throw new Error(`"${symbol}" bu piyasada yok`);

    const prefix = `${market}/${entry.f}@`;
    const key = `${prefix}${entry.h}`;

    const cached = await this.cache.get(key);
    if (cached) return { candles: decodeSeries(cached), entry, fromCache: true };

    const buf = await this.fetchBinary(packPath(market, `${entry.f}?h=${entry.h}`), signal);
    await this.cache.put(key, buf, prefix);
    return { candles: decodeSeries(buf), entry, fromCache: false };
  }

  /** Tüm sembollerin son N barı — tarama/ısı haritası için tek istek. */
  bundle(market: Market, signal?: AbortSignal): Promise<Bundle> {
    const existing = this.bundles.get(market);
    if (existing) return existing;

    const promise = (async () => {
      const manifest = await this.manifest(market, signal);
      const info = manifest.bundle;
      if (!info) throw new Error(`${market}: paket dosyası üretilmemiş`);

      const prefix = `${market}/${info.file}@`;
      const key = `${prefix}${info.hash}`;

      const cached = await this.cache.get(key);
      if (cached) return decodeBundle(cached);

      const buf = await this.fetchBinary(packPath(market, `${info.file}?h=${info.hash}`), signal);
      await this.cache.put(key, buf, prefix);
      return decodeBundle(buf);
    })().catch((err) => {
      this.bundles.delete(market);
      throw err;
    });

    this.bundles.set(market, promise);
    return promise;
  }

  private async fetchBinary(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const res = await this.fetchImpl(url, { signal });
    if (!res.ok) throw new Error(`Veri indirilemedi (HTTP ${res.status})`);
    return res.arrayBuffer();
  }
}

/** Uygulamanın paylaşılan istemcisi. */
export const dataClient = new DataClient();

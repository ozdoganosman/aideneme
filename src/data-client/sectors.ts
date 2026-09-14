import { isSectorMap, type SectorMap } from '../core/screen/sectors';
import { dataBase, type Market } from './markets';

/**
 * Sektör sınıflandırma istemcisi.
 *
 * Dosya yoksa (CI'da `scripts/build_sectors.py` çalışmadıysa ya da kaynak
 * erişilemediyse) `null` döner. Ekran bu durumda davranış kümelerine düşer ve
 * nedenini yazar — eksik sınıflandırma "bilinmiyor" olarak görünür, tahminle
 * doldurulmaz.
 */
export class SectorsClient {
  private readonly cache = new Map<Market, Promise<SectorMap | null>>();

  constructor(private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  map(market: Market, signal?: AbortSignal): Promise<SectorMap | null> {
    const existing = this.cache.get(market);
    if (existing) return existing;

    const promise = (async () => {
      const res = await this.fetchImpl(`${dataBase()}${market}/sectors.json`, { signal });
      if (!res.ok) return null;
      const json: unknown = await res.json();
      return isSectorMap(json) ? json : null;
    })().catch(() => {
      // Başarısız denemeyi kalıcı kılma: ağ geri geldiğinde tekrar denensin.
      this.cache.delete(market);
      return null;
    });

    this.cache.set(market, promise);
    return promise;
  }
}

export const sectorsClient = new SectorsClient();

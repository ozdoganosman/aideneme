import { isFxSeries, type FxSeries } from '../core/portfolio/fx';
import { dataBase, type Market } from './markets';

/**
 * Kur serisi istemcisi. Dosya yoksa `null` döner ve ekran "kur serisi yok"
 * der — döviz bazlı getiri tahminle doldurulmaz.
 */
export class FxClient {
  private readonly cache = new Map<Market, Promise<FxSeries | null>>();

  constructor(private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  series(market: Market, signal?: AbortSignal): Promise<FxSeries | null> {
    const existing = this.cache.get(market);
    if (existing) return existing;

    const promise = (async () => {
      const res = await this.fetchImpl(`${dataBase()}${market}/fx.json`, { signal });
      if (!res.ok) return null;
      const json: unknown = await res.json();
      return isFxSeries(json) ? json : null;
    })().catch(() => {
      this.cache.delete(market);
      return null;
    });

    this.cache.set(market, promise);
    return promise;
  }
}

export const fxClient = new FxClient();

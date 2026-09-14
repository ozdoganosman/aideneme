import { isSnapshot, type Financials, type FundamentalsSnapshot } from '../core/fundamentals/types';
import { dataBase, type Market } from './markets';

/**
 * Finansal tablo istemcisi.
 *
 * Veri henüz üretilmemişse (CI'da `scripts/build_fundamentals.py` çalışmadıysa)
 * `null` döner — ekranlar bunu "temel veri yok" olarak gösterir, boş sayılar
 * uydurmaz.
 */
export class FundamentalsClient {
  private readonly snapshots = new Map<Market, Promise<FundamentalsSnapshot | null>>();
  private readonly files = new Map<string, Promise<Financials | null>>();

  constructor(private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)) {}

  snapshot(market: Market, signal?: AbortSignal): Promise<FundamentalsSnapshot | null> {
    const existing = this.snapshots.get(market);
    if (existing) return existing;

    const promise = (async () => {
      const res = await this.fetchImpl(`${dataBase()}${market}/fundamentals/snapshot.json`, {
        signal,
      });
      if (!res.ok) return null;
      const json: unknown = await res.json();
      return isSnapshot(json) ? json : null;
    })().catch(() => {
      this.snapshots.delete(market);
      return null;
    });

    this.snapshots.set(market, promise);
    return promise;
  }

  financials(market: Market, symbol: string, signal?: AbortSignal): Promise<Financials | null> {
    const key = `${market}/${symbol}`;
    const existing = this.files.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const res = await this.fetchImpl(`${dataBase()}${market}/fundamentals/${symbol}.json`, {
        signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as Financials;
      return json && Array.isArray(json.periods) && json.fields ? json : null;
    })().catch(() => {
      this.files.delete(key);
      return null;
    });

    this.files.set(key, promise);
    return promise;
  }
}

export const fundamentalsClient = new FundamentalsClient();

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
  private readonly all = new Map<Market, Promise<Map<string, Financials> | null>>();
  private readonly noStatement = new Map<Market, Promise<ReadonlySet<string>>>();

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

  /**
   * Kaynakta finansal tablosu OLMAYAN semboller (endeks, fon, varant).
   *
   * "Eksik veri" ile "böyle bir tablo yok"u ayırmak için gerekiyor: XU100'ün
   * bilançosu yoktur, bu bir kusur değil aracın türüdür. Ölçüldü — 655
   * sembolün 97'si tablo vermiyor ve 52'si doğrudan endeks. Dosya yoksa boş
   * küme döner: ayrımı yapamadığımızda eski (temkinli) mesaj geçerli kalır.
   */
  noStatementSymbols(market: Market, signal?: AbortSignal): Promise<ReadonlySet<string>> {
    const existing = this.noStatement.get(market);
    if (existing) return existing;

    const promise = (async () => {
      const res = await this.fetchImpl(`${dataBase()}${market}/fundamentals/tablosuz.json`, {
        signal,
      });
      if (!res.ok) return new Set<string>();
      const json: unknown = await res.json();
      const list = (json as { symbols?: unknown })?.symbols;
      if (!Array.isArray(list)) return new Set<string>();
      return new Set(list.filter((s): s is string => typeof s === 'string'));
    })().catch(() => {
      this.noStatement.delete(market);
      return new Set<string>();
    });

    this.noStatement.set(market, promise);
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

  /**
   * TÜM sembollerin tam tablosu, tek istekte.
   *
   * Neden var: tarama ekranı büyüme ve karne metriklerini hesaplayabilmek için
   * dönem DİZİSİNE ihtiyaç duyuyor; anlık görüntüde yalnızca son TTM var.
   * Sembol başına dosya çekmek 562 istek demekti. Bu dosya ölçüldü: ham
   * 3,1 MB, ve yalnızca bu metrikler kullanıldığında indiriliyor.
   *
   * Dosya yoksa (eski bir veri yayını) `null` döner ve ekran ilgili
   * metrikleri "veri yok" olarak gösterir — sayı uydurulmaz.
   */
  allFinancials(market: Market, signal?: AbortSignal): Promise<Map<string, Financials> | null> {
    const existing = this.all.get(market);
    if (existing) return existing;

    const promise = (async () => {
      const res = await this.fetchImpl(`${dataBase()}${market}/fundamentals/hepsi.json`, {
        signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { symbols?: Record<string, Financials> };
      const symbols = json?.symbols;
      if (!symbols || typeof symbols !== 'object') return null;
      const out = new Map<string, Financials>();
      for (const [symbol, fin] of Object.entries(symbols)) {
        // Bozuk kayıt sessizce ATLANIR ama dosyanın tamamı çöpe atılmaz.
        if (fin && Array.isArray(fin.periods) && fin.fields) out.set(symbol, fin);
      }
      return out.size > 0 ? out : null;
    })().catch(() => {
      this.all.delete(market);
      return null;
    });

    this.all.set(market, promise);
    return promise;
  }
}

export const fundamentalsClient = new FundamentalsClient();

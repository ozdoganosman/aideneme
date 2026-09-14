export type Market = 'bist' | 'us' | 'crypto';

export const MARKETS: Market[] = ['bist', 'us', 'crypto'];

export const MARKET_LABEL: Record<Market, string> = {
  bist: 'BIST',
  us: 'ABD',
  crypto: 'Kripto',
};

/** Veri kökü — Pages'te alt yol altında da doğru çalışsın diye BASE_URL'den. */
export function dataBase(): string {
  return `${import.meta.env.BASE_URL}data/`;
}

export function packPath(market: Market, file: string): string {
  return `${dataBase()}${market}/pack/${file}`;
}

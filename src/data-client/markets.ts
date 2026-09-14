export type Market = 'bist' | 'us' | 'crypto';

export const MARKETS: Market[] = ['bist', 'us', 'crypto'];

export const MARKET_LABEL: Record<Market, string> = {
  bist: 'BIST',
  us: 'ABD',
  crypto: 'Kripto',
};

/**
 * Veri kökü — Pages'te alt yol altında da doğru çalışsın diye BASE_URL'den.
 *
 * `VITE_DATA_BASE` verilirse o kazanır. Önizleme dağıtımı için: uygulama
 * `/aideneme/onizleme/` altında yayımlanıyor ama veri KÖKTEKİ tek kopyadan
 * okunuyor. Yoksa ~29 MB'lık paket her önizleme için ikinci kez yayımlanırdı
 * ve iki kopya farklı tarihlerde tazelenip birbirini tutmazdı.
 */
export function dataBase(): string {
  const override = import.meta.env.VITE_DATA_BASE;
  if (override) return override.endsWith('/') ? override : `${override}/`;
  return `${import.meta.env.BASE_URL}data/`;
}

export function packPath(market: Market, file: string): string {
  return `${dataBase()}${market}/pack/${file}`;
}

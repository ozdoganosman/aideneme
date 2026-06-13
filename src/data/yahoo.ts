import { Candles, emptyCandles } from './types';

// Yahoo Finance chart API (free, no key). It does NOT send CORS headers, so from
// a static site we must go through a CORS proxy. The proxy URL is configurable in
// the UI; ship your own Cloudflare Worker (see cloudflare-worker.js) for a
// reliable one. Use `.IS` symbols for BIST (e.g. THYAO.IS, GARAN.IS).

// How much history to request per interval (Yahoo caps intraday ranges).
const RANGE_FOR: Record<string, string> = {
  '1m': '7d',
  '5m': '60d',
  '15m': '60d',
  '60m': '730d',
  '1d': 'max',
};

interface YahooQuote {
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  volume: (number | null)[];
}

export async function fetchYahoo(
  symbol: string,
  interval: string,
  proxy: string,
  signal?: AbortSignal,
): Promise<Candles> {
  const range = RANGE_FOR[interval] ?? '1y';
  const target =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}`;
  const url = proxy ? proxy + encodeURIComponent(target) : target;

  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    throw new Error('Proxy/ağ hatası. Proxy URL geçerli mi? (CORS) — ' + (e as Error).message);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} (proxy ya da Yahoo). Proxy'yi değiştirmeyi dene.`);

  const j = (await res.json()) as {
    chart?: { result?: { timestamp?: number[]; indicators: { quote: YahooQuote[] } }[]; error?: { description?: string } };
  };
  const r = j?.chart?.result?.[0];
  if (!r || !r.timestamp || !r.indicators?.quote?.[0]) {
    throw new Error(j?.chart?.error?.description ?? 'Veri yok (sembol geçerli mi? örn. THYAO)');
  }

  const ts = r.timestamp;
  const q = r.indicators.quote[0];
  const idx: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open[i] != null && q.close[i] != null && q.high[i] != null && q.low[i] != null) idx.push(i);
  }

  const c = emptyCandles(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    c.time[k] = ts[i];
    c.open[k] = q.open[i] as number;
    c.high[k] = q.high[i] as number;
    c.low[k] = q.low[i] as number;
    c.close[k] = q.close[i] as number;
    c.volume[k] = (q.volume[i] as number) ?? 0;
  }
  return c;
}

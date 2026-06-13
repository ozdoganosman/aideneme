import { Candles, LiveBar, emptyCandles } from './types';

// Binance public market data — free and requires NO API key. The REST endpoints
// send permissive CORS headers, so they work straight from the browser.
const REST = 'https://api.binance.com';

// Cap how many bars one REST load pulls (paginating too hard gets rate-limited).
// Synthetic mode covers the "millions" stress test without hammering the API.
const REST_MAX = 100_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchHistory(
  symbol: string,
  interval: string,
  maxBars: number,
  onProgress?: (cur: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Candles> {
  const want = Math.min(maxBars, REST_MAX);
  const pages: number[][][] = [];
  let endTime = 0;
  let collected = 0;

  while (collected < want) {
    const limit = Math.min(1000, want - collected);
    let url = `${REST}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (endTime > 0) url += `&endTime=${endTime}`;

    const res = await fetch(url, { signal });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 140)}`);
    }
    const arr = (await res.json()) as number[][];
    if (!Array.isArray(arr) || arr.length === 0) break;

    pages.push(arr);
    endTime = (arr[0][0] as number) - 1; // page back from the oldest bar
    collected += arr.length;
    onProgress?.(collected, want);

    if (arr.length < limit) break; // reached the start of history
    await sleep(110);
  }

  // Pages were gathered newest-first; emit oldest-first.
  let total = 0;
  for (const p of pages) total += p.length;
  const c = emptyCandles(total);
  let i = 0;
  for (let p = pages.length - 1; p >= 0; p--) {
    for (const k of pages[p]) {
      c.time[i] = Math.floor((k[0] as number) / 1000);
      c.open[i] = +k[1];
      c.high[i] = +k[2];
      c.low[i] = +k[3];
      c.close[i] = +k[4];
      c.volume[i] = +k[5];
      i++;
    }
  }
  return c;
}

let symbolCache: string[] | null = null;

export async function fetchSymbols(signal?: AbortSignal): Promise<string[]> {
  if (symbolCache) return symbolCache;
  const res = await fetch(`${REST}/api/v3/exchangeInfo`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { symbols?: { symbol: string; status: string }[] };
  const out: string[] = [];
  for (const s of j.symbols ?? []) {
    if (s.status === 'TRADING') out.push(s.symbol);
  }
  out.sort();
  symbolCache = out;
  return out;
}

// Live kline stream over WebSocket (free, no key). Returns a disposer.
export function openKlineStream(
  symbol: string,
  interval: string,
  onBar: (b: LiveBar) => void,
): () => void {
  const ws = new WebSocket(
    `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`,
  );
  ws.onmessage = (ev) => {
    try {
      const k = JSON.parse(ev.data).k;
      if (!k) return;
      onBar({
        time: Math.floor(k.t / 1000),
        open: +k.o,
        high: +k.h,
        low: +k.l,
        close: +k.c,
        volume: +k.v,
        closed: !!k.x,
      });
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  };
}

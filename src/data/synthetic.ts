import { Candles, emptyCandles } from './types';

// Geometric-Brownian-motion OHLCV generator. Produces millions of bars in a
// fraction of a second with no network — the offline stress test for the
// "no lag on huge data" claim.
export function generateSynthetic(symbol: string, n: number, barSec: number): Candles {
  const c = emptyCandles(n);
  if (n === 0) return c;

  let seed = 0x9e3779b9;
  for (let i = 0; i < symbol.length; i++) seed = (Math.imul(seed, 31) + symbol.charCodeAt(i)) >>> 0;
  const rng = mulberry32(seed ^ 0xc0ffee);

  const now = Math.floor(Date.now() / 1000);
  const end = now - (now % barSec);
  const start = end - (n - 1) * barSec;

  let price = 100 + (seed % 50000);
  const drift = 0.00002;
  const vol = 0.004;

  for (let i = 0; i < n; i++) {
    const open = price;
    const close = open * Math.exp(drift + vol * gauss(rng));
    const hi = Math.max(open, close) * (1 + Math.abs(vol * gauss(rng)) * 0.5);
    const lo = Math.min(open, close) * (1 - Math.abs(vol * gauss(rng)) * 0.5);
    const v = 10 + Math.abs(gauss(rng)) * 1000;

    c.time[i] = start + i * barSec;
    c.open[i] = open;
    c.high[i] = hi;
    c.low[i] = lo;
    c.close[i] = close;
    c.volume[i] = v;
    price = close;
  }
  return c;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal via Box-Muller.
function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

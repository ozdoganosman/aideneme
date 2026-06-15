import { Candles } from '../data/types';

// ── Automatic support/resistance ─────────────────────────────────────────────
// Swing pivots (a high/low that is the extreme of ±`strength` bars) clustered
// into horizontal levels; more touches = stronger level.
export interface SRLevel {
  price: number;
  touches: number;
}
export function detectSR(c: Candles, lookback = 400, strength = 5, maxLevels = 6): SRLevel[] {
  const n = c.length;
  if (n < strength * 2 + 2) return [];
  const start = Math.max(strength, n - lookback);
  const pivots: number[] = [];
  for (let i = start; i < n - strength; i++) {
    let ph = true;
    let pl = true;
    for (let k = 1; k <= strength; k++) {
      if (c.high[i] < c.high[i - k] || c.high[i] < c.high[i + k]) ph = false;
      if (c.low[i] > c.low[i - k] || c.low[i] > c.low[i + k]) pl = false;
      if (!ph && !pl) break;
    }
    if (ph) pivots.push(c.high[i]);
    if (pl) pivots.push(c.low[i]);
  }
  if (pivots.length < 2) return [];
  pivots.sort((a, b) => a - b);
  const tol = (c.close[n - 1] || pivots[pivots.length - 1]) * 0.01; // ~1% band
  const clusters: { sum: number; count: number; max: number }[] = [];
  for (const p of pivots) {
    const last = clusters[clusters.length - 1];
    if (last && p - last.max <= tol) {
      last.sum += p;
      last.count++;
      last.max = p;
    } else {
      clusters.push({ sum: p, count: 1, max: p });
    }
  }
  return clusters
    .filter((cl) => cl.count >= 2) // a real level needs at least two touches
    .map((cl) => ({ price: cl.sum / cl.count, touches: cl.count }))
    .sort((a, b) => b.touches - a.touches)
    .slice(0, maxLevels);
}

// ── Candlestick patterns ─────────────────────────────────────────────────────
export interface PatHit {
  idx: number;
  time: number;
  dir: 'bull' | 'bear' | 'neutral';
  label: string;
}
// Detects hammer, shooting star, bullish/bearish engulfing and doji over the
// most recent `lookback` bars (recent signals matter, and it keeps clutter down).
export function detectPatterns(c: Candles, lookback = 250): PatHit[] {
  const n = c.length;
  const start = Math.max(1, n - lookback);
  const out: PatHit[] = [];
  for (let i = start; i < n; i++) {
    const o = c.open[i];
    const h = c.high[i];
    const l = c.low[i];
    const cl = c.close[i];
    const range = h - l;
    if (range <= 0) continue;
    const body = Math.abs(cl - o);
    const upper = h - Math.max(o, cl);
    const lower = Math.min(o, cl) - l;
    const t = c.time[i];

    if (body <= range * 0.08) {
      out.push({ idx: i, time: t, dir: 'neutral', label: 'Doji' });
      continue;
    }
    if (lower >= body * 2 && upper <= body * 0.6 && body <= range * 0.4) {
      out.push({ idx: i, time: t, dir: 'bull', label: 'Çekiç' });
      continue;
    }
    if (upper >= body * 2 && lower <= body * 0.6 && body <= range * 0.4) {
      out.push({ idx: i, time: t, dir: 'bear', label: 'Yıldız' });
      continue;
    }
    const po = c.open[i - 1];
    const pc = c.close[i - 1];
    const pBody = Math.abs(pc - po);
    if (pc < po && cl > o && cl >= po && o <= pc && body > pBody) {
      out.push({ idx: i, time: t, dir: 'bull', label: 'Yutan↑' });
      continue;
    }
    if (pc > po && cl < o && o >= pc && cl <= po && body > pBody) {
      out.push({ idx: i, time: t, dir: 'bear', label: 'Yutan↓' });
      continue;
    }
  }
  return out;
}

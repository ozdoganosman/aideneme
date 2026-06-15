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

// ── Chart formations (triangle, wedge, double top/bottom, head & shoulders) ───
export interface FPoint {
  t: number;
  p: number;
}
export interface Formation {
  kind: string;
  label: string;
  dir: 'bull' | 'bear' | 'neutral';
  segs: [FPoint, FPoint][]; // trendlines / neckline
  pts: FPoint[]; // pivot anchors
}
interface Piv {
  i: number;
  t: number;
  p: number;
  hi: boolean;
}
// Alternating swing highs/lows (zigzag). Consecutive same-type pivots are merged
// to the more extreme one, so the result strictly alternates H,L,H,L…
function zigzag(c: Candles, strength: number, lookback: number): Piv[] {
  const n = c.length;
  const start = Math.max(strength, n - lookback);
  const raw: Piv[] = [];
  for (let i = start; i < n - strength; i++) {
    let ph = true;
    let pl = true;
    for (let k = 1; k <= strength; k++) {
      if (c.high[i] < c.high[i - k] || c.high[i] < c.high[i + k]) ph = false;
      if (c.low[i] > c.low[i - k] || c.low[i] > c.low[i + k]) pl = false;
      if (!ph && !pl) break;
    }
    if (ph) raw.push({ i, t: c.time[i], p: c.high[i], hi: true });
    if (pl) raw.push({ i, t: c.time[i], p: c.low[i], hi: false });
  }
  raw.sort((a, b) => a.i - b.i || (a.hi ? -1 : 1));
  const piv: Piv[] = [];
  for (const r of raw) {
    const last = piv[piv.length - 1];
    if (last && last.hi === r.hi) {
      if ((r.hi && r.p > last.p) || (!r.hi && r.p < last.p)) piv[piv.length - 1] = r;
    } else {
      piv.push(r);
    }
  }
  return piv;
}

// Heuristic detector for the most recent forming pattern (matches templates on
// the latest swing pivots). Approximate by nature — clear cases over noise.
export function detectFormations(c: Candles, strength = 6, lookback = 340): Formation[] {
  const piv = zigzag(c, strength, lookback);
  const L = piv.length;
  if (L < 3) return [];
  const last = c.close[c.length - 1] || 1;
  const tol = last * 0.03;
  const near = (a: number, b: number) => Math.abs(a - b) <= tol;
  const fp = (x: Piv): FPoint => ({ t: x.t, p: x.p });
  const seg = (a: Piv, b: Piv): [FPoint, FPoint] => [fp(a), fp(b)];

  // Head & shoulders / inverse. Scan the few most recent 5-pivot windows (a
  // trailing breakout pivot can shift the last-5 onto the wrong parity), and
  // require proper geometry so an OBO is never mistaken for a TOBO:
  //   OBO  → 3 peaks, head highest, shoulders ~equal and ABOVE a level neckline
  //   TOBO → 3 troughs, head lowest, shoulders ~equal and BELOW a level neckline
  for (let end = L; end >= Math.max(5, L - 2); end--) {
    const [a, b, d, e, f] = piv.slice(end - 5, end);
    const neck: [FPoint, FPoint] = [fp(b), { t: f.t, p: b.p + ((e.p - b.p) / (e.t - b.t || 1)) * (f.t - b.t) }];
    if (
      a.hi && !b.hi && d.hi && !e.hi && f.hi &&
      near(a.p, f.p) && near(b.p, e.p) &&
      d.p - Math.max(a.p, f.p) > tol && // head clearly above shoulders
      Math.min(a.p, f.p) > Math.max(b.p, e.p) // shoulders above the neckline
    ) {
      return [{ kind: 'obo', label: 'OBO (Omuz-Baş-Omuz)', dir: 'bear', segs: [seg(a, b), seg(b, d), seg(d, e), seg(e, f), neck], pts: [a, b, d, e, f].map(fp) }];
    }
    if (
      !a.hi && b.hi && !d.hi && e.hi && !f.hi &&
      near(a.p, f.p) && near(b.p, e.p) &&
      Math.min(a.p, f.p) - d.p > tol && // head clearly below shoulders
      Math.max(a.p, f.p) < Math.min(b.p, e.p) // shoulders below the neckline
    ) {
      return [{ kind: 'tobo', label: 'TOBO (Ters O-B-O)', dir: 'bull', segs: [seg(a, b), seg(b, d), seg(d, e), seg(e, f), neck], pts: [a, b, d, e, f].map(fp) }];
    }
  }

  // Triangle / wedge — fit a line through the recent highs and another through
  // the recent lows, then classify by their slopes. Checked before double
  // top/bottom because a rising-lows/falling-highs triangle also ends in an
  // H,L,H (or L,H,L) that would otherwise look like a double.
  if (L >= 4) {
    const win = piv.slice(Math.max(0, L - 6));
    const highs = win.filter((x) => x.hi);
    const lows = win.filter((x) => !x.hi);
    if (highs.length >= 2 && lows.length >= 2) {
      const h1 = highs[0];
      const h2 = highs[highs.length - 1];
      const l1 = lows[0];
      const l2 = lows[lows.length - 1];
      const dH = h2.p - h1.p;
      const dL = l2.p - l1.p;
      const m = tol * 0.4;
      const flatH = Math.abs(dH) <= tol * 0.5;
      const flatL = Math.abs(dL) <= tol * 0.5;
      let kind = '';
      let label = '';
      let dir: Formation['dir'] = 'neutral';
      if (flatH && dL > m) {
        kind = 'asc'; label = 'Yükselen Üçgen'; dir = 'bull';
      } else if (flatL && dH < -m) {
        kind = 'desc'; label = 'Alçalan Üçgen'; dir = 'bear';
      } else if (dH < -m && dL > m) {
        kind = 'sym'; label = 'Simetrik Üçgen'; dir = 'neutral';
      } else if (dH > m && dL > m) {
        kind = 'rwedge'; label = 'Yükselen Kama'; dir = 'bear';
      } else if (dH < -m && dL < -m) {
        kind = 'fwedge'; label = 'Düşen Kama'; dir = 'bull';
      }
      if (kind) {
        return [{ kind, label, dir, segs: [seg(h1, h2), seg(l1, l2)], pts: [h1, h2, l1, l2].map(fp) }];
      }
    }
  }

  // Double top / bottom — three alternating pivots with matching outer levels.
  if (L >= 3) {
    const [a, b, d] = piv.slice(L - 3);
    if (a.hi && !b.hi && d.hi && near(a.p, d.p) && Math.min(a.p, d.p) - b.p > tol * 0.6) {
      const lvl = (a.p + d.p) / 2;
      return [{ kind: '2top', label: 'Çift Tepe', dir: 'bear', segs: [[{ t: a.t, p: lvl }, { t: d.t, p: lvl }], [{ t: a.t, p: b.p }, { t: d.t, p: b.p }]], pts: [a, b, d].map(fp) }];
    }
    if (!a.hi && b.hi && !d.hi && near(a.p, d.p) && b.p - Math.max(a.p, d.p) > tol * 0.6) {
      const lvl = (a.p + d.p) / 2;
      return [{ kind: '2bot', label: 'Çift Dip', dir: 'bull', segs: [[{ t: a.t, p: lvl }, { t: d.t, p: lvl }], [{ t: a.t, p: b.p }, { t: d.t, p: b.p }]], pts: [a, b, d].map(fp) }];
    }
  }
  return [];
}

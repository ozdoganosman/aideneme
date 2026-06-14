import { Candles } from '../data/types';
import { emaArr, rollingHighest, rollingLowest } from './calc';
import { inflationDailyRates } from '../data/inflation';

export interface StrategyResult {
  name: string;
  retPct: number; // total return % (price only, cash idle)
  annPct: number; // annualized return % (price only, period-normalized)
  trades: number;
  winRate: number;
  maxDD: number;
  holdPct: number;
  holdAnn: number; // buy & hold annualized %
  // ── day stats + interest-on-cash (so a strategy that sits in cash still
  // competes with Buy & Hold: the idle money earns the TCMB rate) ──────────────
  daysIn?: number; // total calendar days holding a position
  daysOut?: number; // total calendar days in cash
  avgHoldDays?: number; // average calendar days per trade
  retRate?: number; // total return % incl. inflation (TÜFE) credited on cash days
  annRate?: number; // annualized return % incl. inflation on cash (the Al-Tut rival)
}

export interface StrategyDef {
  name: string;
  build: (c: Candles) => Uint8Array; // position per bar (1 = long, 0 = flat)
}

function emaCross(a: number, b: number): StrategyDef {
  return {
    name: `EMA ${a}/${b} kesişimi`,
    build: (c) => {
      const n = c.length;
      const ea = emaArr(c.close, a);
      const eb = emaArr(c.close, b);
      const p = new Uint8Array(n);
      for (let i = 0; i < n; i++) p[i] = ea[i] > eb[i] ? 1 : 0;
      return p;
    },
  };
}

function prArr(c: Candles, len: number): Float64Array {
  const n = c.length;
  const hh = rollingHighest(c.high, len);
  const ll = rollingLowest(c.low, len);
  const pr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = hh[i] - ll[i];
    pr[i] = d !== 0 ? (100 * (c.close[i] - hh[i])) / d + 100 : NaN;
  }
  return pr;
}

// ── Extra building blocks for the stronger strategies ──────────────────────

// Wilder ATR (average true range).
function atrArr(c: Candles, len: number): Float64Array {
  const n = c.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  let prev = c.high[0] - c.low[0];
  out[0] = prev;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      c.high[i] - c.low[i],
      Math.abs(c.high[i] - c.close[i - 1]),
      Math.abs(c.low[i] - c.close[i - 1]),
    );
    prev = (prev * (len - 1) + tr) / len;
    out[i] = prev;
  }
  return out;
}

// Supertrend: long while price holds above an ATR-based trailing line.
function supertrend(c: Candles, len: number, mult: number): Uint8Array {
  const n = c.length;
  const atr = atrArr(c, len);
  const p = new Uint8Array(n);
  if (n === 0) return p;
  let fu = (c.high[0] + c.low[0]) / 2 + mult * atr[0];
  let fl = (c.high[0] + c.low[0]) / 2 - mult * atr[0];
  let dir = 1;
  p[0] = 1;
  for (let i = 1; i < n; i++) {
    const hl2 = (c.high[i] + c.low[i]) / 2;
    const ub = hl2 + mult * atr[i];
    const lb = hl2 - mult * atr[i];
    fu = ub < fu || c.close[i - 1] > fu ? ub : fu;
    fl = lb > fl || c.close[i - 1] < fl ? lb : fl;
    if (c.close[i] > fu) dir = 1;
    else if (c.close[i] < fl) dir = 0;
    p[i] = dir;
  }
  return p;
}

// Donchian / Turtle breakout: enter on an N-bar high, exit on an M-bar low.
function donchian(c: Candles, entryN: number, exitN: number): Uint8Array {
  const n = c.length;
  const hh = rollingHighest(c.high, entryN);
  const ll = rollingLowest(c.low, exitN);
  const p = new Uint8Array(n);
  let cur = 0;
  for (let i = 1; i < n; i++) {
    if (cur === 0 && c.high[i] >= hh[i - 1]) cur = 1;
    else if (cur === 1 && c.low[i] <= ll[i - 1]) cur = 0;
    p[i] = cur;
  }
  return p;
}

// Time-series momentum: long when price is above where it was `len` bars ago.
function roc(c: Candles, len: number): Uint8Array {
  const n = c.length;
  const p = new Uint8Array(n);
  for (let i = len; i < n; i++) p[i] = c.close[i] > c.close[i - len] ? 1 : 0;
  return p;
}

// Wilder RSI.
function rsiArr(close: Float64Array, len: number): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NaN);
  if (n <= len) return out;
  let ag = 0;
  let al = 0;
  for (let i = 1; i <= len; i++) {
    const ch = close[i] - close[i - 1];
    ag += Math.max(ch, 0);
    al += Math.max(-ch, 0);
  }
  ag /= len;
  al /= len;
  out[len] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = len + 1; i < n; i++) {
    const ch = close[i] - close[i - 1];
    ag = (ag * (len - 1) + Math.max(ch, 0)) / len;
    al = (al * (len - 1) + Math.max(-ch, 0)) / len;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

// Bollinger breakout: buy a push above the upper band, exit back at the mean.
function bollinger(c: Candles, len: number, k: number): Uint8Array {
  const close = c.close;
  const n = close.length;
  const p = new Uint8Array(n);
  let cur = 0;
  for (let i = 0; i < n; i++) {
    if (i < len - 1) {
      p[i] = cur;
      continue;
    }
    let sum = 0;
    for (let j = i - len + 1; j <= i; j++) sum += close[j];
    const mean = sum / len;
    let v = 0;
    for (let j = i - len + 1; j <= i; j++) {
      const d = close[j] - mean;
      v += d * d;
    }
    const sd = Math.sqrt(v / len);
    const upper = mean + k * sd;
    if (cur === 0 && close[i] > upper) cur = 1;
    else if (cur === 1 && close[i] < mean) cur = 0;
    p[i] = cur;
  }
  return p;
}

function emaCrossFiltered(c: Candles, a: number, b: number, filt: number): Uint8Array {
  const n = c.length;
  const ea = emaArr(c.close, a);
  const eb = emaArr(c.close, b);
  const ef = emaArr(c.close, filt);
  const p = new Uint8Array(n);
  for (let i = 0; i < n; i++) p[i] = ea[i] > eb[i] && c.close[i] > ef[i] ? 1 : 0;
  return p;
}

// User's own confluence ("Williams Paşa" long EMAs + "NizamiCedid" MACD): buy the
// accumulation / reclaim while the long-term trend is up, ride it, and exit only
// when the long trend (EMA 610) breaks — matching "where I'd buy" on the chart.
function pasaCedid(c: Candles): Uint8Array {
  const n = c.length;
  const e377 = emaArr(c.close, 377);
  const e610 = emaArr(c.close, 610);
  const fast = emaArr(c.close, 120);
  const slow = emaArr(c.close, 260);
  const macd = new Float64Array(n);
  for (let i = 0; i < n; i++) macd[i] = fast[i] - slow[i];
  const sig = emaArr(macd, 50);
  const p = new Uint8Array(n);
  let cur = 0;
  for (let i = 0; i < n; i++) {
    if (cur === 0) {
      if (c.close[i] > e610[i] && c.close[i] > e377[i] && macd[i] > sig[i]) cur = 1;
    } else if (c.close[i] < e610[i]) cur = 0;
    p[i] = cur;
  }
  return p;
}

// User's combined rule: BUY when Williams %R is strong (>50) AND price is above
// EMA 377 (trend up) AND Supertrend 10/3 is up; SELL when %R drops below 50.
function pasaBirlesik(c: Candles): Uint8Array {
  const n = c.length;
  const pr = prArr(c, 260);
  const e377 = emaArr(c.close, 377);
  const st = supertrend(c, 10, 3);
  const p = new Uint8Array(n);
  let cur = 0;
  for (let i = 0; i < n; i++) {
    if (cur === 0) {
      if (Number.isFinite(pr[i]) && pr[i] > 50 && c.close[i] > e377[i] && st[i] === 1) cur = 1;
    } else if (Number.isFinite(pr[i]) && pr[i] < 50) {
      cur = 0;
    }
    p[i] = cur;
  }
  return p;
}

// The full strategy registry — used both by the optimizer and to redraw a chosen
// strategy's signals on the chart.
export function strategyList(): StrategyDef[] {
  const defs: StrategyDef[] = [];

  for (const [a, b] of [[9, 21], [20, 50], [50, 200], [89, 377], [377, 610]]) {
    defs.push(emaCross(a, b));
  }

  for (const [f, sl, sg] of [[12, 26, 9], [120, 260, 50], [50, 100, 20], [8, 21, 5]]) {
    defs.push({
      name: `MACD ${f}/${sl}/${sg} > Sinyal`,
      build: (c) => {
        const n = c.length;
        const fast = emaArr(c.close, f);
        const slow = emaArr(c.close, sl);
        const macd = new Float64Array(n);
        for (let i = 0; i < n; i++) macd[i] = fast[i] - slow[i];
        const sig = emaArr(macd, sg);
        const p = new Uint8Array(n);
        for (let i = 0; i < n; i++) p[i] = macd[i] > sig[i] ? 1 : 0;
        return p;
      },
    });
    defs.push({
      name: `MACD ${f}/${sl} > 0`,
      build: (c) => {
        const n = c.length;
        const fast = emaArr(c.close, f);
        const slow = emaArr(c.close, sl);
        const p = new Uint8Array(n);
        for (let i = 0; i < n; i++) p[i] = fast[i] - slow[i] > 0 ? 1 : 0;
        return p;
      },
    });
  }

  for (const len of [14, 50, 260]) {
    defs.push({
      name: `%R ${len} > 50`,
      build: (c) => {
        const pr = prArr(c, len);
        const n = c.length;
        const p = new Uint8Array(n);
        for (let i = 0; i < n; i++) p[i] = Number.isFinite(pr[i]) && pr[i] > 50 ? 1 : 0;
        return p;
      },
    });
  }

  // ── Stronger trend / breakout / volatility strategies ──────────────────────
  defs.push({ name: 'Supertrend 10/3', build: (c) => supertrend(c, 10, 3) });
  defs.push({ name: 'Supertrend 20/4', build: (c) => supertrend(c, 20, 4) });
  defs.push({ name: 'Donchian 20/10 kırılımı', build: (c) => donchian(c, 20, 10) });
  defs.push({ name: 'Donchian 55/20 kırılımı', build: (c) => donchian(c, 55, 20) });
  defs.push({ name: 'Momentum 120 (ROC>0)', build: (c) => roc(c, 120) });
  defs.push({ name: 'Momentum 252 (ROC>0)', build: (c) => roc(c, 252) });
  defs.push({ name: 'EMA 9/21 + Trend 200', build: (c) => emaCrossFiltered(c, 9, 21, 200) });
  defs.push({ name: 'EMA 20/50 + Trend 200', build: (c) => emaCrossFiltered(c, 20, 50, 200) });
  defs.push({
    name: '%R 260 > 50 + Trend 200',
    build: (c) => {
      const pr = prArr(c, 260);
      const ef = emaArr(c.close, 200);
      const n = c.length;
      const p = new Uint8Array(n);
      for (let i = 0; i < n; i++) p[i] = Number.isFinite(pr[i]) && pr[i] > 50 && c.close[i] > ef[i] ? 1 : 0;
      return p;
    },
  });
  for (const L of [14, 50]) {
    defs.push({
      name: `RSI ${L} > 50`,
      build: (c) => {
        const r = rsiArr(c.close, L);
        const n = c.length;
        const p = new Uint8Array(n);
        for (let i = 0; i < n; i++) p[i] = Number.isFinite(r[i]) && r[i] > 50 ? 1 : 0;
        return p;
      },
    });
  }
  defs.push({ name: 'Bollinger 20 kırılımı', build: (c) => bollinger(c, 20, 2) });
  defs.push({ name: 'Paşa+Cedid (Trend 610 + MACD)', build: pasaCedid });
  defs.push({ name: 'Paşa Birleşik (%R+EMA+Supertrend)', build: pasaBirlesik });

  return defs;
}

// Plain-language LOGIC of a strategy (no jargon) for beginners.
export function explainStrategy(name: string): string {
  let m: RegExpMatchArray | null;
  if (name.startsWith('Paşa Birleşik'))
    return "🧭 Birleşik AL kuralı (senin göstergelerin): Williams %R güçlüyken (>50) + fiyat EMA 377'nin üstündeyken (trend yukarı) + Supertrend 10/3 yukarı yöndeyken AL. SAT: Williams %R 50'nin altına düşünce (güç kaybı).";
  if (name.startsWith('Paşa+Cedid'))
    return '🧭 Birleşik kurulum (senin göstergelerin): Uzun vadeli trend yukarıyken (fiyat 610 günlük ortalamanın üstünde) ve momentum dönünce (fiyat 377 ortalamayı geçip NizamiCedid MACD sinyalini yukarı kestiğinde) AL; fiyat 610 ortalamanın altına düşüp trend bozulunca SAT. Toparlanan trende, dip-toplama bölgesinde girer ve trendi sonuna kadar taşır.';
  if (name.includes('+ Trend 200'))
    return '🛡️ Trend filtreli: Yalnızca uzun vadeli trend yukarıyken (fiyat 200 günlük ortalamanın üstünde) AL sinyali verir; trend aşağıyken nakitte bekler. Yatay/düşen piyasadaki yanlış alımları eler, düşüşü (drawdown) azaltır.';
  if (name.startsWith('Supertrend'))
    return '📈 Trend takibi + otomatik stop: Fiyat, oynaklığa (ATR) göre ayarlanan bir takip çizgisinin üstündeyken AL; çizginin altına sarkınca SAT. Yükselen trende biner, sert dönüşte erken çıkıp düşüşü sınırlar.';
  if (name.startsWith('Donchian'))
    return '🚀 Kırılım (Turtle): Fiyat son haftaların en yükseğini aşıp yeni zirve yapınca AL; son günlerin en düşüğüne inince SAT. Güçlü trendleri en baştan yakalamaya çalışır.';
  if (name.startsWith('Momentum'))
    return '🚀 Momentum: Fiyat birkaç ay öncesine göre daha yüksekse (yukarı gidiyorsa) AL, daha düşükse SAT. "Kazanan kazanmaya devam eder" mantığı.';
  if (name.startsWith('Bollinger'))
    return '🚀 Oynaklık kırılımı: Fiyat üst banda taşacak kadar güçlü hareket edince AL, ortalamasına geri dönünce SAT.';
  if (name.startsWith('RSI'))
    return '💪 Güç takibi: Güç göstergesi (RSI) 50 eşiğinin üstüne çıkınca (alıcılar baskın) AL, altına inince SAT.';
  if ((m = name.match(/^EMA (\d+)\//)))
    return '📈 Trend takibi: Fiyat yükseliş eğilimine girince AL, eğilim bozulup düşüşe dönünce SAT. "Yükselen trende katıl, dönünce çık."' + speed(+m[1]);
  if ((m = name.match(/^MACD (\d+)\/.* > Sinyal/)))
    return '🚀 Momentum: Yükseliş ivmesi güç kazanınca AL, ivme zayıflamaya başlayınca SAT. Hızlanmayı yakalar.' + speed(+m[1]);
  if ((m = name.match(/^MACD (\d+)\/.* > 0/)))
    return '📈 Trend filtresi: Fiyat uzun vadeli ortalamasının üstüne (yükselişe) geçince AL, altına inince SAT.' + speed(+m[1]);
  if ((m = name.match(/^%R (\d+) > 50/)))
    return '💪 Güç takibi: Fiyat son dönemin üst yarısında (güçlüyken) AL, alt yarısına düşünce (zayıflayınca) SAT.' + speed(+m[1]);
  return 'Gösterge tabanlı al/sat stratejisi.';
}

function speed(len: number): string {
  return len <= 20
    ? ' (Hızlı: sık işlem, kısa vadeli.)'
    : len >= 100
      ? ' (Yavaş: az işlem, uzun vadeli.)'
      : ' (Orta hızlı.)';
}

function simulate(
  close: Float64Array,
  long: Uint8Array,
  holdPct: number,
  holdAnn: number,
  name: string,
  years: number,
  time?: ArrayLike<number>,
  dailyRates?: ArrayLike<number>, // per-bar per-calendar-day rate earned while flat
  fromIdx = 0, // measure only from this bar (keeps full indicator warmup before it)
  toIdx?: number, // …up to this bar (defaults to the last); enables train/test windows
): StrategyResult {
  const n = close.length;
  const to = toIdx === undefined ? n - 1 : Math.max(fromIdx, Math.min(toIdx, n - 1));
  let equity = 1; // realistic: invested days track price, cash days earn inflation
  let priceEq = 1; // pure: cash idle (price-only)
  let peak = 1;
  let maxDD = 0;
  let trades = 0;
  let wins = 0;
  let entry = 0;
  let inPos = false;
  let daysIn = 0;
  let daysOut = 0;
  for (let i = Math.max(1, fromIdx + 1); i <= to; i++) {
    // Calendar days between bars (cash earns interest every real day, weekends
    // included). Cap a single gap so a trading halt can't fabricate interest.
    const cal = time ? Math.min(Math.max((time[i] - time[i - 1]) / 86400, 0), 31) : 1;
    if (long[i - 1]) {
      const g = close[i] / close[i - 1];
      equity *= g;
      priceEq *= g;
      daysIn += cal;
    } else {
      if (dailyRates) equity *= Math.pow(1 + dailyRates[i], cal);
      daysOut += cal;
    }
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
    if (long[i - 1] && !inPos) {
      inPos = true;
      entry = close[i - 1];
    } else if (!long[i - 1] && inPos) {
      inPos = false;
      trades++;
      if (close[i - 1] > entry) wins++;
    }
  }
  if (inPos) {
    trades++;
    if (close[to] > entry) wins++;
  }
  // Annualized (compound) return — normalizes by how long it ran so a huge total
  // that took 20 years can be compared fairly to a quick winner.
  const annPct = years > 0 && priceEq > 0 ? (Math.pow(priceEq, 1 / years) - 1) * 100 : 0;
  const annRate = years > 0 && equity > 0 ? (Math.pow(equity, 1 / years) - 1) * 100 : 0;
  return {
    name,
    retPct: (priceEq - 1) * 100,
    annPct,
    trades,
    winRate: trades ? (wins / trades) * 100 : 0,
    maxDD: maxDD * 100,
    holdPct,
    holdAnn,
    daysIn: Math.round(daysIn),
    daysOut: Math.round(daysOut),
    avgHoldDays: trades ? daysIn / trades : 0,
    retRate: (equity - 1) * 100,
    annRate,
  };
}

export function optimize(c: Candles): { results: StrategyResult[]; holdPct: number; holdAnn: number } {
  const close = c.close;
  const n = c.length;
  const holdPct = n > 1 ? (close[n - 1] / close[0] - 1) * 100 : 0;
  // Real calendar span (time is unix seconds) — works for daily/weekly/monthly.
  const years = n > 1 ? Math.max((c.time[n - 1] - c.time[0]) / (365.25 * 86400), 1e-6) : 0;
  const holdAnn = years > 0 && close[0] > 0 ? (Math.pow(close[n - 1] / close[0], 1 / years) - 1) * 100 : 0;
  const out = strategyList().map((d) => simulate(close, d.build(c), holdPct, holdAnn, d.name, years, c.time));
  // Rank by annualized (per-day-normalized) return, not raw total.
  out.sort((x, y) => y.annPct - x.annPct);
  return { results: out, holdPct, holdAnn };
}

// Strategies discovered via the optimizer get registered here so the chart and
// trades panel can redraw them by name (they aren't in the static registry).
const customStrategies: StrategyDef[] = [];
export function registerCustomStrategy(def: StrategyDef): void {
  const i = customStrategies.findIndex((d) => d.name === def.name);
  if (i >= 0) customStrategies[i] = def;
  else customStrategies.push(def);
}

// Backtest an arbitrary precomputed position array on a symbol's candles.
// `dailyRates` is the per-bar per-calendar-day rate earned while in cash; it
// defaults to year-specific inflation (TÜFE), so a strategy sitting in cash
// keeps pace with inflation and competes fairly with Buy & Hold.
export function evalPosition(
  c: Candles,
  pos: Uint8Array,
  dailyRates: ArrayLike<number> = inflationDailyRates(c.time, c.length),
  fromIdx = 0, // measure only the window [fromIdx … toIdx] (full warmup kept before it)
  toIdx?: number,
): StrategyResult {
  const close = c.close;
  const n = c.length;
  const f = Math.max(0, Math.min(fromIdx, n - 1));
  const t = toIdx === undefined ? n - 1 : Math.max(f, Math.min(toIdx, n - 1));
  const years = n > 1 ? Math.max((c.time[t] - c.time[f]) / (365.25 * 86400), 1e-6) : 0;
  const holdPct = n > 1 ? (close[t] / close[f] - 1) * 100 : 0;
  const holdAnn = years > 0 && close[f] > 0 ? (Math.pow(close[t] / close[f], 1 / years) - 1) * 100 : 0;
  return simulate(close, pos, holdPct, holdAnn, '', years, c.time, dailyRates, f, t);
}

// First bar index at or after `years` ago (from the last bar). Binary search.
export function idxYearsAgo(time: ArrayLike<number>, n: number, years: number): number {
  if (n < 1) return 0;
  const cutoff = time[n - 1] - years * 365.25 * 86400;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (time[m] < cutoff) lo = m + 1;
    else hi = m;
  }
  return lo;
}

export function buildPositionByName(name: string, c: Candles): Uint8Array | null {
  const d = strategyList().find((d) => d.name === name) || customStrategies.find((d) => d.name === name);
  return d ? d.build(c) : null;
}

// ── Parameter optimizer (per-symbol): sweep a family and rank by annualized ───
export function optFamilies(): string[] {
  return ['Supertrend (ATR)', 'Williams %R > eşik', 'EMA kesişimi', 'Paşa Birleşik (%R+EMA+ST)'];
}

function prAbove(c: Candles, len: number, th: number): Uint8Array {
  const pr = prArr(c, len);
  const n = c.length;
  const p = new Uint8Array(n);
  for (let i = 0; i < n; i++) p[i] = Number.isFinite(pr[i]) && pr[i] > th ? 1 : 0;
  return p;
}

function pasaVariant(c: Candles, th: number, emaP: number): Uint8Array {
  const pr = prArr(c, 260);
  const ef = emaArr(c.close, emaP);
  const st = supertrend(c, 10, 3);
  const n = c.length;
  const p = new Uint8Array(n);
  let cur = 0;
  for (let i = 0; i < n; i++) {
    if (cur === 0) {
      if (Number.isFinite(pr[i]) && pr[i] > th && c.close[i] > ef[i] && st[i] === 1) cur = 1;
    } else if (Number.isFinite(pr[i]) && pr[i] < th) {
      cur = 0;
    }
    p[i] = cur;
  }
  return p;
}

function paramVariants(family: string): StrategyDef[] {
  const defs: StrategyDef[] = [];
  if (family === 'Supertrend (ATR)') {
    for (const len of [7, 10, 14, 20]) for (const mult of [2, 3, 4]) defs.push({ name: `Supertrend ${len}/${mult}`, build: (c) => supertrend(c, len, mult) });
  } else if (family === 'Williams %R > eşik') {
    for (const len of [50, 100, 260]) for (const th of [40, 50, 60]) defs.push({ name: `%R ${len} > ${th}`, build: (c) => prAbove(c, len, th) });
  } else if (family === 'EMA kesişimi') {
    for (const [a, b] of [[9, 21], [20, 50], [50, 100], [50, 200], [89, 377], [100, 200]]) defs.push(emaCross(a, b));
  } else if (family === 'Paşa Birleşik (%R+EMA+ST)') {
    for (const th of [50, 55, 60]) for (const emaP of [200, 377, 610]) defs.push({ name: `Paşa %R>${th} + EMA${emaP} + ST`, build: (c) => pasaVariant(c, th, emaP) });
  }
  return defs;
}

export interface OptResult {
  name: string;
  res: StrategyResult;
  def: StrategyDef;
}

export function optimizeFamily(c: Candles, family: string): OptResult[] {
  const close = c.close;
  const n = c.length;
  const holdPct = n > 1 ? (close[n - 1] / close[0] - 1) * 100 : 0;
  const years = n > 1 ? Math.max((c.time[n - 1] - c.time[0]) / (365.25 * 86400), 1e-6) : 0;
  const holdAnn = years > 0 && close[0] > 0 ? (Math.pow(close[n - 1] / close[0], 1 / years) - 1) * 100 : 0;
  const out = paramVariants(family).map((d) => ({ name: d.name, def: d, res: simulate(close, d.build(c), holdPct, holdAnn, d.name, years, c.time) }));
  out.sort((a, b) => b.res.annPct - a.res.annPct);
  return out;
}

export interface Trade {
  entryTime: number;
  exitTime: number | null;
  entryPrice: number;
  exitPrice: number;
  retPct: number;
  open: boolean;
}

// Trades of a named strategy, newest first.
export function tradesFor(name: string, c: Candles): Trade[] {
  const pos = buildPositionByName(name, c);
  if (!pos) return [];
  const trades: Trade[] = [];
  const mk = (ei: number, xi: number, open: boolean): Trade => {
    const ep = c.close[ei];
    const xp = c.close[xi];
    return { entryTime: c.time[ei], exitTime: open ? null : c.time[xi], entryPrice: ep, exitPrice: xp, retPct: (xp / ep - 1) * 100, open };
  };
  let inPos = false;
  let ei = 0;
  for (let i = 1; i < c.length; i++) {
    if (pos[i] && !pos[i - 1]) {
      inPos = true;
      ei = i;
    } else if (!pos[i] && pos[i - 1] && inPos) {
      inPos = false;
      trades.push(mk(ei, i, false));
    }
  }
  if (inPos) trades.push(mk(ei, c.length - 1, true));
  return trades.reverse();
}

// Entry/exit signals (for chart markers) of a named strategy.
export function signalsFor(name: string, c: Candles): { time: number; kind: 'buy' | 'sell' }[] {
  const pos = buildPositionByName(name, c);
  if (!pos) return [];
  const out: { time: number; kind: 'buy' | 'sell' }[] = [];
  for (let i = 1; i < c.length; i++) {
    if (pos[i] && !pos[i - 1]) out.push({ time: c.time[i], kind: 'buy' });
    else if (!pos[i] && pos[i - 1]) out.push({ time: c.time[i], kind: 'sell' });
  }
  return out;
}

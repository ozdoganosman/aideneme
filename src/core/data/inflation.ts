// Turkey annual CPI (TÜFE) inflation, year-over-year % — official TÜİK year-end
// figures. 2025–2026 are estimates near the data cutoff (disinflation period).
//
// Used to model the CASH leg of a strategy: when a strategy is flat, the idle
// money isn't dead — it keeps pace with inflation (e.g. an inflation-linked
// deposit), so the strategy competes with Buy & Hold on a realistic footing.
// Rates are applied PER YEAR (the bar's calendar year), not a flat constant.
const TUFE: Record<number, number> = {
  2000: 39.0,
  2001: 68.5,
  2002: 29.7,
  2003: 18.36,
  2004: 9.35,
  2005: 7.72,
  2006: 9.65,
  2007: 8.39,
  2008: 10.06,
  2009: 6.53,
  2010: 6.4,
  2011: 10.45,
  2012: 6.16,
  2013: 7.4,
  2014: 8.17,
  2015: 8.81,
  2016: 8.53,
  2017: 11.92,
  2018: 20.3,
  2019: 11.84,
  2020: 14.6,
  2021: 36.08,
  2022: 64.27,
  2023: 64.77,
  2024: 44.38,
  2025: 32.0, // estimate
  2026: 26.0, // estimate (year in progress)
};

const YEARS = Object.keys(TUFE).map(Number).sort((a, b) => a - b);
const MIN_Y = YEARS[0];
const MAX_Y = YEARS[YEARS.length - 1];

// Annual inflation % for a year, clamped to the table's range for out-of-range
// dates (older history → earliest known year; future → latest estimate).
export function inflationAnnualPct(year: number): number {
  if (year <= MIN_Y) return TUFE[MIN_Y];
  if (year >= MAX_Y) return TUFE[MAX_Y];
  return TUFE[year] ?? TUFE[MAX_Y];
}

// Per-bar, per-CALENDAR-day inflation rate aligned to `time` (unix seconds):
// the daily rate that compounds to that year's annual TÜFE over a full year.
export function inflationDailyRates(time: ArrayLike<number>, n: number): Float64Array {
  const out = new Float64Array(n);
  const cache = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const y = new Date(time[i] * 1000).getUTCFullYear();
    let d = cache.get(y);
    if (d === undefined) {
      d = Math.pow(1 + inflationAnnualPct(y) / 100, 1 / 365.25) - 1;
      cache.set(y, d);
    }
    out[i] = d;
  }
  return out;
}

// Bar-weighted average annual inflation over the candles' span (for the UI hint).
export function inflationAvgAnnual(time: ArrayLike<number>, n: number): number {
  if (n < 1) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += inflationAnnualPct(new Date(time[i] * 1000).getUTCFullYear());
  return s / n;
}

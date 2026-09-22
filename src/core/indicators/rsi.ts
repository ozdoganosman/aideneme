/**
 * Wilder RSI. calc.ts devralınan (dondurulmuş) dosya olduğu için yeni
 * göstergeler ayrı modüllere yazılıyor — taşıma diff'i temiz kalsın.
 */
export function rsiArr(close: Float64Array, length = 14): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NaN);
  if (n < length + 1 || length < 1) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i++) {
    const d = close[i] - close[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= length;
  loss /= length;
  out[length] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);

  // Wilder yumuşatması: ani sıçramalarda basit ortalamadan daha kararlı.
  for (let i = length + 1; i < n; i++) {
    const d = close[i] - close[i - 1];
    const up = d > 0 ? d : 0;
    const down = d < 0 ? -d : 0;
    gain = (gain * (length - 1) + up) / length;
    loss = (loss * (length - 1) + down) / length;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** Wilder ATR (mutlak) — yüzde volatilite ölçüsü olarak da kullanılır. */
export function atrArr(
  high: Float64Array,
  low: Float64Array,
  close: Float64Array,
  length = 14,
): Float64Array {
  const n = close.length;
  const out = new Float64Array(n).fill(NaN);
  if (n < length + 1) return out;

  let sum = 0;
  for (let i = 1; i <= length; i++) {
    sum += trueRange(high[i], low[i], close[i - 1]);
  }
  let atr = sum / length;
  out[length] = atr;
  for (let i = length + 1; i < n; i++) {
    atr = (atr * (length - 1) + trueRange(high[i], low[i], close[i - 1])) / length;
    out[i] = atr;
  }
  return out;
}

function trueRange(high: number, low: number, prevClose: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

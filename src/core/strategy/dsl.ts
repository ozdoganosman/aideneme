import type { Candles } from '../data/types';
import { adxArr, emaArr, rocArr, rollingHighest, rollingLowest } from '../indicators/calc';
import { atrArr, rsiArr } from '../indicators/rsi';

/**
 * Kural dili (DSL).
 *
 * Strateji JSON olarak serileşir: URL'e sığar, kaydedilebilir, paylaşılabilir,
 * worker'a mesajla gider. Referans projede kombinasyon mantığı 1.037 satırlık
 * bir bileşenin içine gömülüydü; burada mantık VERİ, bileşen yalnızca editör.
 */

export type Operand =
  | { kind: 'close' }
  | { kind: 'open' }
  | { kind: 'high' }
  | { kind: 'low' }
  | { kind: 'volume' }
  | { kind: 'const'; value: number }
  | { kind: 'ema'; length: number }
  | { kind: 'sma'; length: number }
  | { kind: 'rsi'; length: number }
  | { kind: 'adx'; length: number }
  | { kind: 'atr'; length: number }
  | { kind: 'roc'; length: number }
  | { kind: 'highest'; length: number }
  | { kind: 'lowest'; length: number }
  /** Bir operandın yüzdesi: EMA200'ün %95'i gibi eşikler için. */
  | { kind: 'scale'; of: Operand; factor: number }
  /**
   * Operandın N bar önceki değeri.
   *
   * Kırılım kuralları bunu ZORUNLU kılar: `highest(55)` İÇİNDE BULUNULAN barı
   * da kapsar, dolayısıyla "kapanış > 55 barın en yükseği" hiçbir zaman doğru
   * olamaz (kapanış, o barın yükseğini aşamaz). Doğru kural "kapanış, ÖNCEKİ
   * 55 barın en yükseğinin üstünde" — yani `prev(highest(55), 1)`.
   */
  | { kind: 'prev'; of: Operand; bars: number };

export type Condition =
  | { op: 'gt' | 'gte' | 'lt' | 'lte'; left: Operand; right: Operand }
  | { op: 'crossAbove' | 'crossBelow'; left: Operand; right: Operand }
  | { op: 'all' | 'any'; of: Condition[] }
  | { op: 'not'; of: Condition };

export interface Strategy {
  name?: string;
  entry: Condition;
  /** Çıkış kuralı; stop/hedef ile birlikte kullanılabilir. */
  exit?: Condition;
  /** Girişe göre yüzde zarar durdur (pozitif sayı, ör. 8 = %8). */
  stopLossPct?: number;
  /** Girişe göre yüzde kâr al. */
  takeProfitPct?: number;
  /** ATR katı takip eden stop. */
  atrStop?: { length: number; mult: number };
  /** Aynı anda en fazla bir pozisyon; yön şimdilik yalnızca alış. */
  direction?: 'long';
}

export const EMPTY_STRATEGY: Strategy = {
  entry: {
    op: 'crossAbove',
    left: { kind: 'ema', length: 20 },
    right: { kind: 'ema', length: 50 },
  },
  exit: { op: 'crossBelow', left: { kind: 'ema', length: 20 }, right: { kind: 'ema', length: 50 } },
};

// ── Operand → seri ───────────────────────────────────────────────────────────

function smaArr(src: Float64Array, length: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n).fill(NaN);
  if (length < 1) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += src[i];
    if (i >= length) sum -= src[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

function key(operand: Operand): string {
  switch (operand.kind) {
    case 'const':
      return `const:${operand.value}`;
    case 'scale':
      return `scale:${operand.factor}:${key(operand.of)}`;
    case 'prev':
      return `prev:${operand.bars}:${key(operand.of)}`;
    case 'close':
    case 'open':
    case 'high':
    case 'low':
    case 'volume':
      return operand.kind;
    default:
      return `${operand.kind}:${operand.length}`;
  }
}

/** Operandı seriye çevirir; aynı operand bir kez hesaplanır (memoize). */
export function evaluateOperand(
  operand: Operand,
  c: Candles,
  cache = new Map<string, Float64Array>(),
): Float64Array {
  const cacheKey = key(operand);
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  let out: Float64Array;
  switch (operand.kind) {
    case 'close':
      out = c.close;
      break;
    case 'open':
      out = c.open;
      break;
    case 'high':
      out = c.high;
      break;
    case 'low':
      out = c.low;
      break;
    case 'volume':
      out = c.volume;
      break;
    case 'const':
      out = new Float64Array(c.length).fill(operand.value);
      break;
    case 'ema':
      out = emaArr(c.close, operand.length);
      break;
    case 'sma':
      out = smaArr(c.close, operand.length);
      break;
    case 'rsi':
      out = rsiArr(c.close, operand.length);
      break;
    case 'adx':
      out = adxArr(c, operand.length);
      break;
    case 'atr':
      out = atrArr(c.high, c.low, c.close, operand.length);
      break;
    case 'roc':
      out = rocArr(c.close, operand.length);
      break;
    case 'highest':
      out = rollingHighest(c.high, operand.length);
      break;
    case 'lowest':
      out = rollingLowest(c.low, operand.length);
      break;
    case 'scale': {
      const base = evaluateOperand(operand.of, c, cache);
      out = new Float64Array(base.length);
      for (let i = 0; i < base.length; i++) out[i] = base[i] * operand.factor;
      break;
    }
    case 'prev': {
      const base = evaluateOperand(operand.of, c, cache);
      const bars = Math.max(0, Math.floor(operand.bars));
      out = new Float64Array(base.length).fill(NaN);
      for (let i = bars; i < base.length; i++) out[i] = base[i - bars];
      break;
    }
  }

  cache.set(cacheKey, out);
  return out;
}

// ── Koşul → bar başına doğruluk ──────────────────────────────────────────────

/**
 * Koşulu bar bar değerlendirir. NaN (ısınma) her zaman FALSE üretir: veri
 * olmadan sinyal üretmek, backtest'i ısınma penceresinden beslemek olurdu.
 */
export function evaluateCondition(
  condition: Condition,
  c: Candles,
  cache = new Map<string, Float64Array>(),
): Uint8Array {
  const n = c.length;
  const out = new Uint8Array(n);

  switch (condition.op) {
    case 'all':
    case 'any': {
      const parts = condition.of.map((sub) => evaluateCondition(sub, c, cache));
      if (parts.length === 0) return out;
      for (let i = 0; i < n; i++) {
        let value = condition.op === 'all' ? 1 : 0;
        for (const part of parts) {
          if (condition.op === 'all') value = value && part[i] ? 1 : 0;
          else value = value || part[i] ? 1 : 0;
        }
        out[i] = value;
      }
      return out;
    }

    case 'not': {
      const inner = evaluateCondition(condition.of, c, cache);
      for (let i = 0; i < n; i++) out[i] = inner[i] ? 0 : 1;
      return out;
    }

    default: {
      const left = evaluateOperand(condition.left, c, cache);
      const right = evaluateOperand(condition.right, c, cache);

      for (let i = 0; i < n; i++) {
        const a = left[i];
        const b = right[i];
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

        if (condition.op === 'gt') out[i] = a > b ? 1 : 0;
        else if (condition.op === 'gte') out[i] = a >= b ? 1 : 0;
        else if (condition.op === 'lt') out[i] = a < b ? 1 : 0;
        else if (condition.op === 'lte') out[i] = a <= b ? 1 : 0;
        else {
          // Kesişim iki bar ister; ilk barda ve ısınmada sinyal yok.
          if (i === 0) continue;
          const pa = left[i - 1];
          const pb = right[i - 1];
          if (!Number.isFinite(pa) || !Number.isFinite(pb)) continue;
          if (condition.op === 'crossAbove') out[i] = pa <= pb && a > b ? 1 : 0;
          else out[i] = pa >= pb && a < b ? 1 : 0;
        }
      }
      return out;
    }
  }
}

/** Stratejinin kullandığı en uzun pencere — ısınma barlarını atlamak için. */
export function warmupBars(strategy: Strategy): number {
  let max = 0;
  let shift = 0;
  const visitOperand = (operand: Operand) => {
    if (operand.kind === 'scale') visitOperand(operand.of);
    else if (operand.kind === 'prev') {
      shift = Math.max(shift, operand.bars);
      visitOperand(operand.of);
    } else if ('length' in operand) max = Math.max(max, operand.length);
  };
  const visit = (condition: Condition) => {
    switch (condition.op) {
      case 'all':
      case 'any':
        condition.of.forEach(visit);
        break;
      case 'not':
        visit(condition.of);
        break;
      default:
        visitOperand(condition.left);
        visitOperand(condition.right);
    }
  };
  visit(strategy.entry);
  if (strategy.exit) visit(strategy.exit);
  if (strategy.atrStop) max = Math.max(max, strategy.atrStop.length);
  // Kaydırma pencereye EKLENİR: 55 barlık en yüksek + 1 bar geri = 56 bar veri.
  return max + shift;
}

/** İnsan okunur özet — rapor ve kayıtlı stratejilerde gösterilir. */
export function describeCondition(condition: Condition): string {
  const operand = (o: Operand): string => {
    switch (o.kind) {
      case 'const':
        return String(o.value);
      case 'scale':
        return `${operand(o.of)} × ${o.factor}`;
      case 'prev':
        return `${o.bars} bar önceki ${operand(o.of)}`;
      case 'close':
        return 'kapanış';
      case 'open':
        return 'açılış';
      case 'high':
        return 'yüksek';
      case 'low':
        return 'düşük';
      case 'volume':
        return 'hacim';
      default:
        return `${o.kind.toUpperCase()}(${o.length})`;
    }
  };

  switch (condition.op) {
    case 'all':
      return condition.of.map(describeCondition).join(' VE ');
    case 'any':
      return condition.of.map(describeCondition).join(' VEYA ');
    case 'not':
      return `DEĞİL (${describeCondition(condition.of)})`;
    case 'gt':
      return `${operand(condition.left)} > ${operand(condition.right)}`;
    case 'gte':
      return `${operand(condition.left)} ≥ ${operand(condition.right)}`;
    case 'lt':
      return `${operand(condition.left)} < ${operand(condition.right)}`;
    case 'lte':
      return `${operand(condition.left)} ≤ ${operand(condition.right)}`;
    case 'crossAbove':
      return `${operand(condition.left)} yukarı keser ${operand(condition.right)}`;
    case 'crossBelow':
      return `${operand(condition.left)} aşağı keser ${operand(condition.right)}`;
  }
}

import { describe, expect, it } from 'vitest';
import {
  describeCondition,
  evaluateCondition,
  evaluateOperand,
  warmupBars,
  type Condition,
} from './dsl';
import { DAY_SECONDS } from '../data/pack';
import { emptyCandles, type Candles } from '../data/types';

function series(closes: number[]): Candles {
  const c = emptyCandles(closes.length);
  closes.forEach((v, i) => {
    c.time[i] = (20000 + i) * DAY_SECONDS;
    c.open[i] = v;
    c.high[i] = v * 1.01;
    c.low[i] = v * 0.99;
    c.close[i] = v;
    c.volume[i] = 1000;
  });
  return c;
}

describe('evaluateOperand', () => {
  it("'prev' operandı seriyi geri kaydırır, ilk barlar NaN kalır", () => {
    const c = series([10, 11, 12, 13]);
    const shifted = evaluateOperand({ kind: 'prev', of: { kind: 'close' }, bars: 1 }, c);
    expect(Number.isNaN(shifted[0])).toBe(true);
    expect(Array.from(shifted.slice(1))).toEqual([10, 11, 12]);
  });

  it('kırılım kuralı ancak prev ile doğru olabilir', () => {
    // highest(N) İÇİNDE BULUNULAN barı da kapsar: kapanış onu asla aşamaz.
    const c = series([10, 11, 12, 20, 12]);
    const naive: Condition = {
      op: 'gt',
      left: { kind: 'close' },
      right: { kind: 'highest', length: 3 },
    };
    expect(Array.from(evaluateCondition(naive, c))).toEqual([0, 0, 0, 0, 0]);

    const correct: Condition = {
      op: 'gt',
      left: { kind: 'close' },
      right: { kind: 'prev', of: { kind: 'highest', length: 3 }, bars: 1 },
    };
    // 20, önceki 3 barın en yükseğini (12 × 1.01) aşıyor.
    expect(Array.from(evaluateCondition(correct, c))[3]).toBe(1);
  });

  it('kaydırma ısınmaya EKLENİR', () => {
    const base = warmupBars({
      entry: { op: 'gt', left: { kind: 'close' }, right: { kind: 'highest', length: 55 } },
    });
    const shifted = warmupBars({
      entry: {
        op: 'gt',
        left: { kind: 'close' },
        right: { kind: 'prev', of: { kind: 'highest', length: 55 }, bars: 2 },
      },
    });
    expect(base).toBe(55);
    expect(shifted).toBe(57);
  });

  const c = series([10, 11, 12, 13, 14]);

  it('fiyat kolonlarını doğrudan verir', () => {
    expect(Array.from(evaluateOperand({ kind: 'close' }, c))).toEqual([10, 11, 12, 13, 14]);
  });

  it('sabit ve ölçek', () => {
    expect(Array.from(evaluateOperand({ kind: 'const', value: 7 }, c))).toEqual([7, 7, 7, 7, 7]);
    const scaled = evaluateOperand({ kind: 'scale', of: { kind: 'close' }, factor: 0.5 }, c);
    expect(Array.from(scaled)).toEqual([5, 5.5, 6, 6.5, 7]);
  });

  it('aynı operandı iki kez hesaplamaz (memoize)', () => {
    const cache = new Map<string, Float64Array>();
    const first = evaluateOperand({ kind: 'ema', length: 3 }, c, cache);
    const second = evaluateOperand({ kind: 'ema', length: 3 }, c, cache);
    expect(second).toBe(first);
  });
});

describe('evaluateCondition', () => {
  const c = series([10, 12, 11, 13, 9]);

  it('karşılaştırma operatörleri', () => {
    const cond: Condition = {
      op: 'gt',
      left: { kind: 'close' },
      right: { kind: 'const', value: 11 },
    };
    expect(Array.from(evaluateCondition(cond, c))).toEqual([0, 1, 0, 1, 0]);
  });

  it('kesişim iki bar ister; ilk barda sinyal üretmez', () => {
    const cond: Condition = {
      op: 'crossAbove',
      left: { kind: 'close' },
      right: { kind: 'const', value: 11 },
    };
    // 10→12 yukarı keser (bar 1), 11→13 yeniden keser (bar 3).
    expect(Array.from(evaluateCondition(cond, c))).toEqual([0, 1, 0, 1, 0]);
  });

  it('ısınmadaki NaN değerler FALSE üretir', () => {
    const cond: Condition = {
      op: 'gt',
      left: { kind: 'rsi', length: 14 },
      right: { kind: 'const', value: 0 },
    };
    const out = evaluateCondition(cond, series(Array.from({ length: 10 }, (_, i) => 10 + i)));
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it('all / any / not', () => {
    const gt10: Condition = {
      op: 'gt',
      left: { kind: 'close' },
      right: { kind: 'const', value: 10 },
    };
    const lt12: Condition = {
      op: 'lt',
      left: { kind: 'close' },
      right: { kind: 'const', value: 12 },
    };

    expect(Array.from(evaluateCondition({ op: 'all', of: [gt10, lt12] }, c))).toEqual([
      0, 0, 1, 0, 0,
    ]);
    expect(Array.from(evaluateCondition({ op: 'any', of: [gt10, lt12] }, c))).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(Array.from(evaluateCondition({ op: 'not', of: gt10 }, c))).toEqual([1, 0, 0, 0, 1]);
  });

  it('boş all/any hiçbir sinyal üretmez', () => {
    expect(Array.from(evaluateCondition({ op: 'all', of: [] }, c)).every((v) => v === 0)).toBe(
      true,
    );
  });
});

describe('warmupBars', () => {
  it('en uzun pencereyi bulur (iç içe koşullarda da)', () => {
    expect(
      warmupBars({
        entry: {
          op: 'all',
          of: [
            { op: 'gt', left: { kind: 'ema', length: 20 }, right: { kind: 'ema', length: 200 } },
            { op: 'lt', left: { kind: 'rsi', length: 14 }, right: { kind: 'const', value: 70 } },
          ],
        },
        exit: { op: 'crossBelow', left: { kind: 'close' }, right: { kind: 'sma', length: 50 } },
        atrStop: { length: 30, mult: 2 },
      }),
    ).toBe(200);
  });
});

describe('describeCondition', () => {
  it('kuralı okunur metne çevirir', () => {
    const text = describeCondition({
      op: 'all',
      of: [
        { op: 'crossAbove', left: { kind: 'ema', length: 20 }, right: { kind: 'ema', length: 50 } },
        { op: 'lt', left: { kind: 'rsi', length: 14 }, right: { kind: 'const', value: 70 } },
      ],
    });
    expect(text).toBe('EMA(20) yukarı keser EMA(50) VE RSI(14) < 70');
  });
});

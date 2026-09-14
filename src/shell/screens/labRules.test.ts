import { describe, expect, it } from 'vitest';
import { emptyCandles, type Candles } from '../../core/data/types';
import { evaluateCondition, type Condition } from '../../core/strategy/dsl';
import { STRATEGY_PRESETS } from '../../core/strategy/presets';
import { baseOf, factorOf, fromForm, toForm, withFactor } from './labRules';

/** Yeterince uzun, dalgalı bir seri: her kural sinyal üretebilsin. */
function series(n: number): Candles {
  const c = emptyCandles(n);
  let price = 100;
  for (let i = 0; i < n; i++) {
    price *= 1 + Math.sin(i / 9) * 0.01 + Math.cos(i / 31) * 0.004;
    c.time[i] = (19000 + i) * 86400;
    c.open[i] = price;
    c.high[i] = price * 1.01;
    c.low[i] = price * 0.99;
    c.close[i] = price;
    c.volume[i] = 1_000_000;
  }
  return c;
}

const signals = (condition: Condition, c: Candles) => Array.from(evaluateCondition(condition, c));

describe('strateji ↔ kural editörü', () => {
  it('hazır stratejilerin tamamı editöre sığar', () => {
    for (const preset of STRATEGY_PRESETS) {
      const { form, unsupported } = toForm(preset.strategy);
      expect(unsupported, `${preset.id}: ${unsupported.join(', ')}`).toEqual([]);
      expect(form).not.toBeNull();
    }
  });

  it('çevirim kayıpsızdır: geri dönen kural aynı sinyalleri üretir', () => {
    // Biçim aynı olmak zorunda değil (tek kural "all" listesine sarılır);
    // ÖNEMLİ olan üretilen sinyal dizisinin bar bar aynı kalması.
    const data = series(600);
    for (const preset of STRATEGY_PRESETS) {
      const { form } = toForm(preset.strategy);
      const back = fromForm(form!);
      expect(signals(back.entry, data), preset.id).toEqual(signals(preset.strategy.entry, data));
      if (preset.strategy.exit) {
        expect(signals(back.exit!, data), preset.id).toEqual(signals(preset.strategy.exit, data));
      }
      expect(back.stopLossPct).toEqual(preset.strategy.stopLossPct);
      expect(back.atrStop).toEqual(preset.strategy.atrStop);
    }
  });

  it('VEYA bağlacını sessizce kırpmaz, reddeder', () => {
    const { form, unsupported } = toForm({
      entry: {
        op: 'any',
        of: [
          { op: 'gt', left: { kind: 'close' }, right: { kind: 'ema', length: 50 } },
          { op: 'lt', left: { kind: 'rsi', length: 14 }, right: { kind: 'const', value: 30 } },
        ],
      },
    });
    expect(form).toBeNull();
    expect(unsupported[0]).toMatch(/VEYA/);
  });

  it('DEĞİL bağlacını da reddeder', () => {
    const { form, unsupported } = toForm({
      entry: {
        op: 'not',
        of: { op: 'gt', left: { kind: 'close' }, right: { kind: 'ema', length: 50 } },
      },
    });
    expect(form).toBeNull();
    expect(unsupported[0]).toMatch(/DEĞİL/);
  });

  it('iç içe VE listesini düzleştirir', () => {
    const { form } = toForm({
      entry: {
        op: 'all',
        of: [
          { op: 'gt', left: { kind: 'close' }, right: { kind: 'ema', length: 200 } },
          {
            op: 'all',
            of: [
              { op: 'lt', left: { kind: 'rsi', length: 14 }, right: { kind: 'const', value: 40 } },
            ],
          },
        ],
      },
    });
    expect(form!.entry).toHaveLength(2);
  });

  it('ATR stopu taşır; mult 0 ise stop yok sayılır', () => {
    const withAtr = toForm({
      entry: { op: 'gt', left: { kind: 'close' }, right: { kind: 'ema', length: 50 } },
      atrStop: { length: 14, mult: 3 },
    }).form!;
    expect(withAtr.atrStopMult).toBe(3);
    expect(fromForm(withAtr).atrStop).toEqual({ length: 14, mult: 3 });
    expect(fromForm({ ...withAtr, atrStopMult: 0 }).atrStop).toBeUndefined();
  });

  it('ölçek katsayısı operanddan ayrılıp geri takılabilir', () => {
    const scaled = {
      kind: 'scale' as const,
      of: { kind: 'ema' as const, length: 50 },
      factor: 0.97,
    };
    expect(factorOf(scaled)).toBe(0.97);
    expect(baseOf(scaled)).toEqual({ kind: 'ema', length: 50 });
    expect(withFactor(scaled, 1)).toEqual({ kind: 'ema', length: 50 });
    expect(withFactor({ kind: 'ema', length: 50 }, 0.9)).toEqual({
      kind: 'scale',
      of: { kind: 'ema', length: 50 },
      factor: 0.9,
    });
  });
});

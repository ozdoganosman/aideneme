import { describe, expect, it } from 'vitest';
import { emptyCandles, type Candles } from '../data/types';
import { evaluateCondition, type Strategy } from './dsl';
import { STRATEGY_PRESETS } from './presets';
import { decodeStrategy, encodeStrategy } from './share';

function series(n: number): Candles {
  const c = emptyCandles(n);
  let price = 100;
  for (let i = 0; i < n; i++) {
    price *= 1 + Math.sin(i / 8) * 0.012 + Math.cos(i / 27) * 0.005;
    c.time[i] = (19000 + i) * 86400;
    c.open[i] = price;
    c.high[i] = price * 1.01;
    c.low[i] = price * 0.99;
    c.close[i] = price;
    c.volume[i] = 1_000_000;
  }
  return c;
}

const data = series(600);
const signals = (s: Strategy) => Array.from(evaluateCondition(s.entry, data));

describe('strateji bağlantısı', () => {
  it('hazır stratejilerin hepsi kodlanıp aynı sinyalleri üretecek şekilde çözülür', () => {
    for (const preset of STRATEGY_PRESETS) {
      const { text, unsupported } = encodeStrategy(preset.strategy);
      expect(unsupported, preset.id).toEqual([]);
      const { strategy, dropped } = decodeStrategy(text);
      expect(dropped, preset.id).toEqual([]);
      // Biçim değil DAVRANIŞ korunmalı: bar bar aynı sinyaller.
      expect(signals(strategy!), preset.id).toEqual(signals(preset.strategy));
      expect(strategy!.stopLossPct).toBe(preset.strategy.stopLossPct);
      expect(strategy!.atrStop).toEqual(preset.strategy.atrStop);
    }
  });

  it('kodlama kısa ve okunabilir', () => {
    // Hazır listenin SIRASINA bağlanmıyor: liste değiştiğinde kırılan bir
    // test, kodlamayla ilgili hiçbir şey söylemeden kırmızı yanıyordu.
    const emaCross: Strategy = {
      name: 'EMA 20/50 kesişimi',
      entry: {
        op: 'crossAbove',
        left: { kind: 'ema', length: 20 },
        right: { kind: 'ema', length: 50 },
      },
      exit: {
        op: 'crossBelow',
        left: { kind: 'ema', length: 20 },
        right: { kind: 'ema', length: 50 },
      },
    };
    expect(encodeStrategy(emaCross).text).toBe('1|ema20~x~ema50|ema20~y~ema50|0_0_14_0');
  });

  it('çok parametreli indikatörler de kısa kodlanır', () => {
    const s: Strategy = {
      name: 'MACD + Supertrend',
      entry: {
        op: 'all',
        of: [
          {
            op: 'gt',
            left: { kind: 'macd', fast: 12, slow: 26 },
            right: { kind: 'macdSignal', fast: 12, slow: 26, signal: 9 },
          },
          { op: 'gt', left: { kind: 'close' }, right: { kind: 'supertrend', length: 10, mult: 3 } },
        ],
      },
    };
    const { text } = encodeStrategy(s);
    expect(text).toContain('macd12-26');
    expect(text).toContain('macdsig12-26-9');
    expect(text).toContain('st10-3');
    // Ve geri çözülünce aynı kural.
    expect(decodeStrategy(text).strategy!.entry).toEqual(s.entry);
  });

  it('ölçek ve geri kaydırma sarmalayıcıları korunur', () => {
    const strategy: Strategy = {
      entry: {
        op: 'gt',
        left: { kind: 'close' },
        right: { kind: 'prev', of: { kind: 'highest', length: 55 }, bars: 1 },
      },
      exit: {
        op: 'lt',
        left: { kind: 'close' },
        right: { kind: 'scale', of: { kind: 'ema', length: 50 }, factor: 0.97 },
      },
    };
    const { text } = encodeStrategy(strategy);
    expect(text).toContain('highest55@1');
    expect(text).toContain('ema50*0.97');
    const { strategy: back } = decodeStrategy(text);
    expect(back!.entry).toEqual({ op: 'all', of: [strategy.entry] });
    expect(back!.exit).toEqual({ op: 'all', of: [strategy.exit] });
  });

  it('VEYA/DEĞİL bağlacını sessizce basitleştirmez, kodlamayı reddeder', () => {
    const or = encodeStrategy({
      entry: {
        op: 'any',
        of: [
          { op: 'gt', left: { kind: 'close' }, right: { kind: 'ema', length: 50 } },
          { op: 'lt', left: { kind: 'rsi', length: 14 }, right: { kind: 'const', value: 30 } },
        ],
      },
    });
    expect(or.text).toBe('');
    expect(or.unsupported[0]).toMatch(/VEYA/);

    const not = encodeStrategy({
      entry: {
        op: 'not',
        of: { op: 'gt', left: { kind: 'close' }, right: { kind: 'ema', length: 50 } },
      },
    });
    expect(not.text).toBe('');
    expect(not.unsupported[0]).toMatch(/DEĞİL/);
  });

  it('gösterge adındaki harf operatör sanılmaz (adx içindeki x)', () => {
    const { text } = encodeStrategy({
      entry: {
        op: 'gt',
        left: { kind: 'adx', length: 14 },
        right: { kind: 'const', value: 25 },
      },
    });
    const { strategy, dropped } = decodeStrategy(text);
    expect(dropped).toEqual([]);
    expect(strategy!.entry).toEqual({
      op: 'all',
      of: [{ op: 'gt', left: { kind: 'adx', length: 14 }, right: { kind: 'const', value: 25 } }],
    });
  });

  it('bozuk metinden strateji uydurmaz', () => {
    expect(decodeStrategy('1|zzz9~g~ema20||').strategy).toBeNull();
    expect(decodeStrategy('').strategy).toBeNull();
    const wrongVersion = decodeStrategy('7|ema20~x~ema50||');
    expect(wrongVersion.strategy).toBeNull();
    expect(wrongVersion.dropped[0]).toMatch(/sürüm 7/);
  });

  it('çıkış kuralı bozuksa giriş korunur ama sessizce değil', () => {
    const { strategy, dropped } = decodeStrategy('1|ema20~x~ema50|bozuk|0_0_14_0');
    expect(strategy).not.toBeNull();
    expect(strategy!.exit).toBeUndefined();
    expect(dropped.join(' ')).toMatch(/çıkış/);
  });

  it('ondalıklı ATR katı alanlara bölünmez (ayırıcı çakışması)', () => {
    const { text } = encodeStrategy({
      entry: { op: 'gt', left: { kind: 'close' }, right: { kind: 'ema', length: 50 } },
      atrStop: { length: 14, mult: 2.5 },
    });
    // Nokta ayırıcı olsaydı "2.5" iki alana bölünüp sessizce 2'ye düşerdi.
    expect(decodeStrategy(text).strategy!.atrStop).toEqual({ length: 14, mult: 2.5 });
  });

  it('stop/hedef/ATR alanları taşınır, sıfır "yok" demektir', () => {
    const { text } = encodeStrategy({
      entry: { op: 'gt', left: { kind: 'close' }, right: { kind: 'ema', length: 50 } },
      stopLossPct: 8,
      takeProfitPct: 25,
      atrStop: { length: 20, mult: 2.5 },
    });
    const { strategy } = decodeStrategy(text);
    expect(strategy!.stopLossPct).toBe(8);
    expect(strategy!.takeProfitPct).toBe(25);
    expect(strategy!.atrStop).toEqual({ length: 20, mult: 2.5 });

    const bare = decodeStrategy('1|c~g~ema50||0_0_14_0').strategy!;
    expect(bare.stopLossPct).toBeUndefined();
    expect(bare.atrStop).toBeUndefined();
  });
});

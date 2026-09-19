import { describe, expect, it } from 'vitest';
import { DEFAULT_COSTS, ZERO_COSTS, runBacktest, type CostModel } from './engine';
import { DAY_SECONDS } from '../data/pack';
import { emptyCandles, type Candles } from '../data/types';
import type { Strategy } from '../strategy/dsl';

interface Bar {
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

function bars(list: Bar[]): Candles {
  const c = emptyCandles(list.length);
  list.forEach((b, i) => {
    c.time[i] = (20000 + i) * DAY_SECONDS;
    c.open[i] = b.o;
    c.high[i] = b.h;
    c.low[i] = b.l;
    c.close[i] = b.c;
    c.volume[i] = b.v ?? 1_000_000;
  });
  return c;
}

/** Kapanış > açılış olan barda gir, tersinde çık. Isınma gerektirmez. */
const SIMPLE: Strategy = {
  entry: { op: 'gt', left: { kind: 'close' }, right: { kind: 'open' } },
  exit: { op: 'lt', left: { kind: 'close' }, right: { kind: 'open' } },
};

const NO_COST: CostModel = ZERO_COSTS;

describe('emir zamanlaması', () => {
  it('sinyal barında değil, SONRAKİ barın açılışında dolar', () => {
    // Bar 0: yeşil (sinyal). Bar 1: açılış 20 → giriş burada olmalı.
    const c = bars([
      { o: 10, h: 11, l: 9, c: 11 },
      { o: 20, h: 21, l: 19, c: 21 },
      { o: 30, h: 31, l: 29, c: 29 },
      { o: 28, h: 29, l: 27, c: 27 },
    ]);
    const result = runBacktest(c, SIMPLE, { costs: NO_COST, extraWarmup: -1 });

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.entryIndex).toBe(1);
    expect(trade.entryPrice).toBeCloseTo(20, 6); // bar 1 açılışı
    expect(trade.exitIndex).toBe(3);
    expect(trade.exitPrice).toBeCloseTo(28, 6); // bar 3 açılışı
  });

  it('geleceği kesmek geçmişteki işlemleri DEĞİŞTİRMEZ (look-ahead dedektörü)', () => {
    // Rastgele ama deterministik seri.
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };
    const list: Bar[] = [];
    let price = 100;
    for (let i = 0; i < 200; i++) {
      const open = price;
      price = Math.max(1, price * (1 + rnd() * 0.05));
      list.push({
        o: open,
        h: Math.max(open, price) * 1.01,
        l: Math.min(open, price) * 0.99,
        c: price,
      });
    }

    const full = runBacktest(bars(list), SIMPLE, { costs: NO_COST, extraWarmup: -1 });
    const truncated = runBacktest(bars(list.slice(0, 120)), SIMPLE, {
      costs: NO_COST,
      extraWarmup: -1,
    });

    // Kesilen seride kapanan işlemler, tam seride birebir aynı olmalı.
    const closedInTruncated = truncated.trades.filter((t) => t.reason !== 'end');
    expect(closedInTruncated.length).toBeGreaterThan(3);
    closedInTruncated.forEach((t, i) => {
      expect(full.trades[i].entryIndex).toBe(t.entryIndex);
      expect(full.trades[i].exitIndex).toBe(t.exitIndex);
      expect(full.trades[i].entryPrice).toBeCloseTo(t.entryPrice, 9);
      expect(full.trades[i].exitPrice).toBeCloseTo(t.exitPrice, 9);
    });
  });
});

describe('maliyet modeli', () => {
  const trending = bars(
    Array.from({ length: 60 }, (_, i) => {
      const base = 100 + i;
      return { o: base, h: base + 2, l: base - 2, c: base + 1 };
    }),
  );

  it('maliyet eklemek getiriyi ASLA artırmaz', () => {
    const free = runBacktest(trending, SIMPLE, { costs: NO_COST, extraWarmup: -1 });
    const paid = runBacktest(trending, SIMPLE, { costs: DEFAULT_COSTS, extraWarmup: -1 });
    const end = (r: typeof free) => r.equity[r.equity.length - 1];
    expect(end(paid)).toBeLessThanOrEqual(end(free));
    expect(paid.costPaid).toBeGreaterThan(0);
    expect(free.costPaid).toBe(0);
  });

  it('işlem kaydı brüt ve net getiriyi ayrı tutar', () => {
    const paid = runBacktest(trending, SIMPLE, { costs: DEFAULT_COSTS, extraWarmup: -1 });
    for (const trade of paid.trades) {
      expect(trade.netPct).toBeLessThan(trade.grossPct);
      expect(trade.costPct).toBeCloseTo(0.2, 6); // 10 bps × 2 yön
    }
  });

  it('likidite tavanı aşılırsa işlem açılmaz', () => {
    const illiquid = bars([
      { o: 10, h: 11, l: 9, c: 11, v: 1 },
      { o: 20, h: 21, l: 19, c: 21, v: 1 },
      { o: 22, h: 23, l: 21, c: 23, v: 1 },
    ]);
    const result = runBacktest(illiquid, SIMPLE, {
      costs: { commissionBps: 0, slippageBps: 0, volumeCapPct: 10 },
      extraWarmup: -1,
    });
    expect(result.trades).toHaveLength(0);
    expect(result.skippedByLiquidity).toBeGreaterThan(0);
  });
});

describe('stop ve hedef', () => {
  const strategy: Strategy = {
    entry: { op: 'gt', left: { kind: 'close' }, right: { kind: 'open' } },
    stopLossPct: 10,
    takeProfitPct: 10,
  };

  it('stop tetiklenince stop fiyatından çıkar', () => {
    const c = bars([
      { o: 100, h: 101, l: 99, c: 101 }, // sinyal
      { o: 100, h: 102, l: 99, c: 100 }, // giriş @100, stop 90
      { o: 99, h: 99, l: 85, c: 88 }, // stop görülür
    ]);
    const result = runBacktest(c, strategy, { costs: NO_COST, extraWarmup: -1 });
    expect(result.trades[0].reason).toBe('stop');
    expect(result.trades[0].exitPrice).toBeCloseTo(90, 6);
  });

  it('boşluklu açılışta gerçek (daha kötü) fiyattan çıkar', () => {
    const c = bars([
      { o: 100, h: 101, l: 99, c: 101 },
      { o: 100, h: 102, l: 99, c: 100 }, // giriş @100, stop 90
      { o: 80, h: 82, l: 78, c: 79 }, // 80'den açtı: stop fiyatı bulunamaz
    ]);
    const result = runBacktest(c, strategy, { costs: NO_COST, extraWarmup: -1 });
    expect(result.trades[0].exitPrice).toBeCloseTo(80, 6);
  });

  it('aynı barda hem stop hem hedef görülürse KÖTÜMSER varsayım (stop)', () => {
    const c = bars([
      { o: 100, h: 101, l: 99, c: 101 },
      { o: 100, h: 102, l: 99, c: 100 },
      { o: 100, h: 115, l: 85, c: 100 }, // hem 110 hem 90 görüldü
    ]);
    const result = runBacktest(c, strategy, { costs: NO_COST, extraWarmup: -1 });
    expect(result.trades[0].reason).toBe('stop');
  });

  it('hedef tetiklenince hedef fiyatından çıkar', () => {
    const c = bars([
      { o: 100, h: 101, l: 99, c: 101 },
      { o: 100, h: 102, l: 99, c: 100 },
      { o: 101, h: 115, l: 100, c: 114 },
    ]);
    const result = runBacktest(c, strategy, { costs: NO_COST, extraWarmup: -1 });
    expect(result.trades[0].reason).toBe('target');
    expect(result.trades[0].exitPrice).toBeCloseTo(110, 6);
  });
});

describe('sonuç bütünlüğü', () => {
  const c = bars(
    Array.from({ length: 40 }, (_, i) => {
      const base = 100 + Math.sin(i / 3) * 10;
      return { o: base, h: base + 2, l: base - 2, c: base + Math.cos(i / 3) };
    }),
  );

  it('açık pozisyon son barda kapanır', () => {
    const always: Strategy = {
      entry: { op: 'gt', left: { kind: 'close' }, right: { kind: 'const', value: 0 } },
    };
    const result = runBacktest(c, always, { costs: NO_COST, extraWarmup: -1 });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].reason).toBe('end');
    expect(result.inPosition[c.length - 1]).toBe(1);
  });

  it('al-tut eğrisi aynı maliyet modelini öder', () => {
    const free = runBacktest(c, SIMPLE, { costs: NO_COST, extraWarmup: -1 });
    const paid = runBacktest(c, SIMPLE, { costs: DEFAULT_COSTS, extraWarmup: -1 });
    const last = (r: typeof free) => r.buyHold[r.buyHold.length - 1];
    expect(last(paid)).toBeLessThan(last(free));
  });

  it('hiç pozisyon açılmazsa sermaye korunur; nakit getirisi işler', () => {
    const never: Strategy = {
      entry: { op: 'gt', left: { kind: 'close' }, right: { kind: 'const', value: 1e9 } },
    };
    const flat = runBacktest(c, never, { costs: NO_COST, initialCash: 1000, extraWarmup: -1 });
    expect(flat.trades).toHaveLength(0);
    expect(flat.equity[flat.equity.length - 1]).toBeCloseTo(1000, 6);

    const withCash = runBacktest(c, never, {
      costs: NO_COST,
      initialCash: 1000,
      cashAnnualPct: 50,
      extraWarmup: -1,
    });
    expect(withCash.equity[withCash.equity.length - 1]).toBeGreaterThan(1000);
  });

  it('boş seride çökmez', () => {
    const result = runBacktest(emptyCandles(0), SIMPLE);
    expect(result.trades).toHaveLength(0);
    expect(result.equity).toHaveLength(0);
  });
});

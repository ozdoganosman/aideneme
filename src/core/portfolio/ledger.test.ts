import { describe, expect, it } from 'vitest';
import { buildLedger, moneyWeightedReturn, valuePortfolio, type Txn } from './ledger';

const DAY = 86400;
const day = (n: number) => 20000 * DAY + n * DAY;

const txn = (over: Partial<Txn> & Pick<Txn, 'symbol' | 'side' | 'shares' | 'price'>): Txn => ({
  id: `${over.symbol}-${over.side}-${over.shares}-${over.price}`,
  date: day(0),
  ...over,
});

describe('buildLedger', () => {
  it('ağırlıklı ortalama maliyeti komisyonla birlikte hesaplar', () => {
    // 10 @ 100 (+10 komisyon) ve 10 @ 120 (+10) → (1000+10+1200+10)/20 = 111
    const ledger = buildLedger([
      txn({ symbol: 'AAA', side: 'buy', shares: 10, price: 100, fee: 10, date: day(0) }),
      txn({ symbol: 'AAA', side: 'buy', shares: 10, price: 120, fee: 10, date: day(1) }),
    ]);
    const position = ledger.positions[0];
    expect(position.shares).toBe(20);
    expect(position.avgCost).toBeCloseTo(111, 6);
    expect(ledger.fees).toBe(20);
  });

  it('satışta gerçekleşen kâr/zararı ortalama maliyetten hesaplar', () => {
    const ledger = buildLedger([
      txn({ symbol: 'AAA', side: 'buy', shares: 10, price: 100, date: day(0) }),
      txn({ symbol: 'AAA', side: 'sell', shares: 4, price: 150, fee: 5, date: day(2) }),
    ]);
    // 4 × (150 − 100) − 5 = 195
    expect(ledger.realizedPnl).toBeCloseTo(195, 6);
    expect(ledger.positions[0].shares).toBe(6);
    expect(ledger.positions[0].avgCost).toBeCloseTo(100, 6);
  });

  it('pozisyon tamamen kapanınca maliyet sıfırlanır', () => {
    const ledger = buildLedger([
      txn({ symbol: 'AAA', side: 'buy', shares: 5, price: 50, date: day(0) }),
      txn({ symbol: 'AAA', side: 'sell', shares: 5, price: 60, date: day(1) }),
    ]);
    expect(ledger.positions[0].shares).toBe(0);
    expect(ledger.positions[0].avgCost).toBe(0);
    expect(ledger.realizedPnl).toBeCloseTo(50, 6);
  });

  it('elde olmayan hisse satışı uyarı üretir, sessizce yutulmaz', () => {
    const ledger = buildLedger([
      txn({ symbol: 'AAA', side: 'buy', shares: 2, price: 10, date: day(0) }),
      txn({ symbol: 'AAA', side: 'sell', shares: 5, price: 12, date: day(1) }),
    ]);
    expect(ledger.warnings.join(' ')).toMatch(/açığa satış/);
    expect(ledger.positions[0].shares).toBe(0);
    expect(ledger.realizedPnl).toBeCloseTo(4, 6); // yalnızca eldeki 2 adet
  });

  it('işlemler tarih sırasına göre işlenir (girdi sırası önemsiz)', () => {
    const late = txn({ symbol: 'AAA', side: 'sell', shares: 1, price: 200, date: day(5) });
    const early = txn({ symbol: 'AAA', side: 'buy', shares: 1, price: 100, date: day(1) });
    const a = buildLedger([late, early]);
    const b = buildLedger([early, late]);
    expect(a.realizedPnl).toBeCloseTo(b.realizedPnl, 9);
    expect(a.realizedPnl).toBeCloseTo(100, 6);
  });

  it('geçersiz işlem atlanır ve uyarılır', () => {
    const ledger = buildLedger([txn({ symbol: 'AAA', side: 'buy', shares: 0, price: 10 })]);
    expect(ledger.positions).toHaveLength(0);
    expect(ledger.warnings).toHaveLength(1);
  });
});

describe('valuePortfolio', () => {
  const ledger = buildLedger([
    txn({ symbol: 'AAA', side: 'buy', shares: 10, price: 100, date: day(0) }),
    txn({ symbol: 'BBB', side: 'buy', shares: 5, price: 40, date: day(0) }),
  ]);

  it('değer, kâr/zarar ve ağırlıkları hesaplar', () => {
    const value = valuePortfolio(ledger.positions, (s) => ({ AAA: 120, BBB: 50 })[s]);
    expect(value.totalValue).toBeCloseTo(10 * 120 + 5 * 50, 6);
    expect(value.totalCost).toBeCloseTo(10 * 100 + 5 * 40, 6);
    expect(value.unrealizedPnl).toBeCloseTo(250, 6); // AAA +200, BBB +50

    const aaa = value.rows.find((r) => r.symbol === 'AAA')!;
    expect(aaa.weightPct).toBeCloseTo((1200 / 1450) * 100, 6);
    expect(aaa.unrealizedPct).toBeCloseTo(20, 6);
  });

  it('fiyatı olmayan sembolü gizlemez, ayrıca bildirir', () => {
    const value = valuePortfolio(ledger.positions, (s) => (s === 'AAA' ? 120 : undefined));
    expect(value.missingPrices).toEqual(['BBB']);
    expect(value.rows).toHaveLength(1);
  });
});

describe('moneyWeightedReturn (IRR)', () => {
  it('tek yatırımda bilinen yıllık getiriyi verir', () => {
    // 1 yılda 100 → 120: IRR ≈ %20
    const irr = moneyWeightedReturn(
      [{ date: day(0), amount: -100 }],
      120,
      day(0) + Math.round(365.25 * DAY),
    );
    expect(irr).toBeCloseTo(20, 1);
  });

  it('zirvede eklenen para getiriyi düşürür (zaman ağırlıklının göremediği)', () => {
    const start = day(0);
    const year = Math.round(365.25 * DAY);
    const early = moneyWeightedReturn([{ date: start, amount: -100 }], 150, start + year);
    const late = moneyWeightedReturn(
      [
        { date: start, amount: -100 },
        { date: start + year - DAY, amount: -100 }, // son gün 100 daha ekle
      ],
      250,
      start + year,
    );
    expect(late).toBeLessThan(early);
  });

  it('çözülemeyen akışta NaN döner (uydurma yok)', () => {
    expect(Number.isNaN(moneyWeightedReturn([], 100, day(1)))).toBe(true);
    expect(Number.isNaN(moneyWeightedReturn([{ date: day(0), amount: 100 }], 100, day(10)))).toBe(
      true,
    );
  });
});

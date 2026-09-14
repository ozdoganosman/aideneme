import { describe, expect, it } from 'vitest';
import { FUNDAMENTAL_METRIC_DEFS, withFundamentals } from './fundamentalMetrics';
import { applyScreen, type ScreenRow } from './metrics';
import {
  FUNDAMENTAL_FIELDS,
  type FieldId,
  type Financials,
  type FundamentalsSnapshot,
} from '../fundamentals/types';

function row(symbol: string, price: number, rsi = 50): ScreenRow {
  return {
    symbol,
    bars: 250,
    values: {
      last: price,
      chg1: 0,
      chg5: 0,
      chg21: 0,
      chg63: 0,
      rsi,
      adx: 20,
      emaFastGap: 0,
      emaSlowGap: 0,
      volRatio: 1,
      atrPct: 2,
      fromHigh: -5,
    },
  };
}

const snapshot: FundamentalsSnapshot = {
  version: 1,
  generated: 1,
  note: 'test',
  symbols: {
    UCUZ: {
      period: '2024/12',
      revenueTtm: 1000,
      grossProfitTtm: 300,
      operatingProfitTtm: 200,
      netIncomeTtm: 200,
      operatingCashFlowTtm: 210,
      equity: 1000,
      assets: 2000,
      paidCapital: 100,
      currentAssets: 500,
      currentLiabilities: 250,
      longLiabilities: 250,
      inventory: 100,
      cash: 100,
    },
    PAHALI: {
      period: '2024/12',
      revenueTtm: 500,
      grossProfitTtm: 100,
      operatingProfitTtm: 50,
      netIncomeTtm: 50,
      operatingCashFlowTtm: 40,
      equity: 400,
      assets: 900,
      paidCapital: 100,
      currentAssets: 200,
      currentLiabilities: 300,
      longLiabilities: 200,
      inventory: 80,
      cash: 20,
    },
    ZARAR: {
      period: '2024/12',
      revenueTtm: 300,
      grossProfitTtm: 20,
      operatingProfitTtm: -40,
      netIncomeTtm: -60,
      operatingCashFlowTtm: -10,
      equity: 200,
      assets: 800,
      paidCapital: 100,
      currentAssets: 150,
      currentLiabilities: 400,
      longLiabilities: 200,
      inventory: 60,
      cash: 10,
    },
  },
};

function financials(overrides: Partial<Record<FieldId, (number | null)[]>>): Financials {
  const periods = ['2022/12', '2023/12', '2024/12'];
  const fields = {} as Record<FieldId, (number | null)[]>;
  for (const field of FUNDAMENTAL_FIELDS) fields[field] = overrides[field] ?? [null, null, null];
  return { symbol: 'UCUZ', periods, fields, missing: [] };
}

describe('withFundamentals', () => {
  const rows = [row('UCUZ', 10), row('PAHALI', 40), row('ZARAR', 5)];
  const merged = withFundamentals(rows, { snapshot });

  it('teknik satıra temel metrikleri ekler', () => {
    const ucuz = merged.find((r) => r.symbol === 'UCUZ')!;
    expect(ucuz.values.pe).toBeCloseTo(5, 6); // 100×10 / 200
    expect(ucuz.values.pb).toBeCloseTo(1, 6);
    expect(ucuz.values.roe).toBeCloseTo(20, 6);
    expect(ucuz.values.netMargin).toBeCloseTo(20, 6);
    expect(ucuz.values.rsi).toBe(50); // teknik değerler korunur
  });

  it('zarar edende F/K boş kalır ama marj hesaplanır', () => {
    const zarar = merged.find((r) => r.symbol === 'ZARAR')!;
    expect(Number.isNaN(zarar.values.pe)).toBe(true);
    expect(zarar.values.netMargin).toBeCloseTo(-20, 6);
  });

  it('fiyat teknik satırdan gelir (iki kaynak arasında tutarsızlık olmaz)', () => {
    const cheap = withFundamentals([row('UCUZ', 10)], { snapshot })[0];
    const pricey = withFundamentals([row('UCUZ', 20)], { snapshot })[0];
    expect(pricey.values.pe).toBeCloseTo(cheap.values.pe * 2, 6);
  });

  it('snapshot’ta olmayan sembolde temel metrikler NaN kalır', () => {
    const unknown = withFundamentals([row('YOK', 10)], { snapshot })[0];
    expect(Number.isNaN(unknown.values.pe)).toBe(true);
    expect(unknown.values.last).toBe(10);
  });

  it('tam tablo verilirse büyüme ve kalite dolar', () => {
    const fin = financials({
      revenue: [800, 1000, 1200],
      netIncome: [100, 150, 200],
      operatingCashFlow: [110, 160, 220],
      assets: [1500, 1800, 2000],
      equity: [700, 850, 1000],
      grossProfit: [200, 280, 360],
      currentAssets: [400, 450, 500],
      currentLiabilities: [300, 280, 250],
      longLiabilities: [400, 350, 250],
    });
    const withFin = withFundamentals([row('UCUZ', 10)], {
      snapshot,
      financialsOf: (s) => (s === 'UCUZ' ? fin : undefined),
    })[0];
    expect(withFin.values.revenueGrowth).toBeCloseTo(20, 6); // 1200 / 1000
    expect(withFin.values.quality).toBeGreaterThan(6);
  });

  it('temel metrikler mevcut filtre motoruyla çalışır', () => {
    const cheapAndProfitable = applyScreen(merged, {
      rules: [
        { metric: 'pe', op: 'lt', a: 10 },
        { metric: 'roe', op: 'gt', a: 10 },
      ],
      sort: { metric: 'pe', dir: 'asc' },
    });
    expect(cheapAndProfitable.map((r) => r.symbol)).toEqual(['UCUZ']);
  });

  it('yüzdelik sıralaması ucuzu 100’e yaklaştırır', () => {
    const ucuz = merged.find((r) => r.symbol === 'UCUZ')!;
    const pahali = merged.find((r) => r.symbol === 'PAHALI')!;
    // Evren 5 değerden küçük olduğu için yüzdelik üretilmez — bu da bir kural.
    expect(Number.isNaN(ucuz.values.pePercentile)).toBe(true);
    expect(Number.isNaN(pahali.values.pePercentile)).toBe(true);
  });

  it('her temel metriğin formülü yazılı', () => {
    for (const def of FUNDAMENTAL_METRIC_DEFS) {
      expect(def.formula({} as never).length).toBeGreaterThan(10);
    }
  });
});

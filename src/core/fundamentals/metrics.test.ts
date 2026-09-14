import { describe, expect, it } from 'vitest';
import {
  annualSeries,
  computeRatios,
  growth,
  latest,
  percentileRank,
  qualityScore,
  ttm,
} from './metrics';
import { FUNDAMENTAL_FIELDS, type FieldId, type Financials, type SnapshotRow } from './types';

function financials(
  periods: string[],
  overrides: Partial<Record<FieldId, (number | null)[]>>,
): Financials {
  const fields = {} as Record<FieldId, (number | null)[]>;
  for (const field of FUNDAMENTAL_FIELDS) {
    fields[field] = overrides[field] ?? periods.map(() => null);
  }
  return { symbol: 'TEST', periods, fields, missing: [] };
}

describe('ttm (kümülatif çeyrek tuzağı)', () => {
  const periods = ['2022/12', '2023/3', '2023/6', '2023/9', '2023/12', '2024/3', '2024/6'];
  const revenue = [300, 80, 180, 290, 400, 100, 250];

  it('yıl sonu dönemi doğrudan yıllıktır', () => {
    expect(ttm(periods, revenue, 4)).toBe(400);
  });

  it('ara dönemde geçen yıl sonu + bu yıl − geçen yıl aynı dönem', () => {
    // 400 + 250 − 180 = 470 (2023 ikinci yarısı + 2024 ilk yarısı)
    expect(ttm(periods, revenue, 6)).toBe(470);
  });

  it('kümülatifi çeyrek sanıp toplamak yanlış sonucu verirdi', () => {
    const naive = revenue[5] + revenue[6]; // 350 — kümülatifleri toplamak
    expect(ttm(periods, revenue, 6)).not.toBe(naive);
  });

  it('karşılaştırma dönemi yoksa null (uydurma TTM yok)', () => {
    expect(ttm(['2024/6'], [100], 0)).toBeNull();
    expect(ttm(periods, [300, null, null, null, null, null, null], 6)).toBeNull();
  });
});

describe('annualSeries / latest', () => {
  const fin = financials(['2022/12', '2023/6', '2023/12'], {
    revenue: [100, 60, 130],
    equity: [500, 520, null],
  });

  it('yalnızca yıl sonu dönemlerini alır', () => {
    const series = annualSeries(fin, 'revenue');
    expect(series.labels).toEqual(['2022', '2023']);
    expect(series.values).toEqual([100, 130]);
  });

  it('latest son DOLU değeri döndürür', () => {
    expect(latest(fin, 'equity')).toBe(520);
    expect(latest(fin, 'inventory')).toBeNull();
  });
});

describe('computeRatios', () => {
  const row: SnapshotRow = {
    period: '2024/12',
    revenueTtm: 1000,
    grossProfitTtm: 400,
    operatingProfitTtm: 250,
    netIncomeTtm: 200,
    operatingCashFlowTtm: 240,
    equity: 800,
    assets: 2000,
    paidCapital: 100,
    currentAssets: 600,
    currentLiabilities: 300,
    longLiabilities: 500,
    inventory: 150,
    cash: 200,
  };

  it('çarpanları ödenmiş sermaye üzerinden hesaplar', () => {
    const r = computeRatios({ row, price: 40 });
    expect(r.marketCap).toBe(4000); // 100 pay × 40
    expect(r.pe).toBe(20); // 4000 / 200
    expect(r.pb).toBe(5); // 4000 / 800
    expect(r.ps).toBe(4);
    expect(r.roePct).toBeCloseTo(25, 6);
    expect(r.netMarginPct).toBeCloseTo(20, 6);
    expect(r.debtToEquity).toBeCloseTo(1, 6); // (300+500)/800
    expect(r.currentRatio).toBeCloseTo(2, 6);
    expect(r.netDebt).toBe(600);
    expect(r.cashConversion).toBeCloseTo(1.2, 6);
  });

  it('zarar eden şirkette F/K null — negatif çarpan "ucuz" sıralanmasın', () => {
    const loss = { ...row, netIncomeTtm: -50 };
    const r = computeRatios({ row: loss, price: 40 });
    expect(r.pe).toBeNull();
    expect(r.netMarginPct).toBeCloseTo(-5, 6); // marj yine de gösterilir
  });

  it('pay sayısı açıkça verilebilir (nominal değeri 1 TL olmayan şirketler)', () => {
    const r = computeRatios({ row, price: 40, shares: 200 });
    expect(r.marketCap).toBe(8000);
    expect(r.pe).toBe(40);
  });

  it('eksik veri null üretir, sıfır değil', () => {
    const sparse = { ...row, equity: null, revenueTtm: null };
    const r = computeRatios({ row: sparse, price: 40 });
    expect(r.pb).toBeNull();
    expect(r.ps).toBeNull();
    expect(r.roePct).toBeNull();
    expect(r.netMarginPct).toBeNull();
  });
});

describe('qualityScore', () => {
  const periods = ['2022/12', '2023/12', '2024/12'];

  it('iyileşen şirkette yüksek skor verir', () => {
    const fin = financials(periods, {
      netIncome: [50, 80, 120],
      operatingCashFlow: [60, 100, 150],
      assets: [900, 950, 1000],
      equity: [400, 500, 650],
      revenue: [700, 900, 1200],
      grossProfit: [200, 280, 400],
      currentAssets: [300, 400, 500],
      currentLiabilities: [200, 220, 210],
      longLiabilities: [300, 250, 200],
    });
    const quality = qualityScore(fin);
    expect(quality.available).toBe(9);
    expect(quality.score).toBeGreaterThanOrEqual(8);
  });

  it('eksik veride madde değerlendirilmez, payda küçülür', () => {
    const fin = financials(periods, { netIncome: [10, 20, 30] });
    const quality = qualityScore(fin);
    expect(quality.available).toBeLessThan(9);
    expect(quality.checks.filter((c) => c.passed === null).length).toBeGreaterThan(0);
  });

  it('her ölçüt etiketli — kara kutu değil', () => {
    const fin = financials(periods, { netIncome: [10, 20, 30] });
    for (const check of qualityScore(fin).checks) {
      expect(check.label.length).toBeGreaterThan(5);
      expect(check.id.length).toBeGreaterThan(1);
    }
  });
});

describe('growth', () => {
  const periods = ['2022/12', '2023/6', '2023/12', '2024/6'];

  it('TTM bazlı yıllık büyümeyi hesaplar', () => {
    const fin = financials(periods, {
      revenue: [1000, 600, 1200, 900],
      equity: [500, 550, 600, 700],
    });
    // TTM(2024/6) = 1200 + 900 − 600 = 1500; TTM(2023/6) = 1000 + 600 − ? (2022/6 yok) → null
    expect(growth(fin).revenueYoyPct).toBeNull();

    const longer = financials(['2021/12', '2022/6', '2022/12', '2023/6', '2023/12', '2024/6'], {
      revenue: [800, 400, 1000, 600, 1200, 900],
    });
    // TTM(2024/6) = 1200 + 900 − 600 = 1500; TTM(2023/6) = 1000 + 600 − 400 = 1200 → +%25
    expect(growth(longer).revenueYoyPct).toBeCloseTo(25, 6);
  });

  it('negatif tabanda yüzde değişim üretmez (anlamsız olurdu)', () => {
    const fin = financials(['2022/12', '2023/12', '2024/12'], {
      netIncome: [-100, -50, 80],
    });
    expect(growth(fin).netIncomeYoyPct).toBeNull();
  });
});

describe('percentileRank', () => {
  const universe = [5, 10, 15, 20, 25, 30, null];

  it('yüksek iyi ise büyük değer yüksek yüzdelik alır', () => {
    expect(percentileRank(universe, 30)).toBeCloseTo((5 / 6) * 100, 6);
    expect(percentileRank(universe, 5)).toBe(0);
  });

  it('düşük iyi ise sıralama ters çevrilir (F/K gibi)', () => {
    expect(percentileRank(universe, 5, true)).toBeCloseTo((5 / 6) * 100, 6);
  });

  it('evren küçükse yüzdelik üretilmez', () => {
    expect(percentileRank([1, 2, 3], 2)).toBeNull();
    expect(percentileRank(universe, null)).toBeNull();
  });
});

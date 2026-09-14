import { describe, expect, it } from 'vitest';
import type { PulseRow } from './pulse';
import { UNCLASSIFIED, flowBySector, isSectorMap, sectorCoverage } from './sectors';

function row(symbol: string, value: number, changePct: number): PulseRow {
  return {
    symbol,
    last: 100,
    changePct,
    value,
    fromHigh: -5,
    fromLow: 10,
    newHigh: false,
    newLow: false,
    bars: 250,
  };
}

const MAP = {
  source: 'test',
  generated: 1,
  of: { GARAN: 'Bankacılık', AKBNK: 'Bankacılık', EREGL: 'Demir Çelik' },
};

describe('sektör bazlı para akışı', () => {
  it('sembolleri sektöre göre toplar, lideri işlem değerine göre seçer', () => {
    const flows = flowBySector(
      [row('GARAN', 600, 2), row('AKBNK', 400, -1), row('EREGL', 300, 1)],
      MAP,
    );
    const banks = flows.find((f) => f.sector === 'Bankacılık')!;
    expect(banks.symbols).toBe(2);
    expect(banks.value).toBe(1000);
    expect(banks.leader).toBe('GARAN');
    // Ağırlıklı değişim: (600×2 + 400×−1) / 1000 = 0.8
    expect(banks.weightedChangePct).toBeCloseTo(0.8, 12);
    // Akış: (600 − 400) / 1000 = %20
    expect(banks.flowPct).toBeCloseTo(20, 12);
    expect(banks.advancing).toBe(1);
    expect(banks.declining).toBe(1);
  });

  it('sınıflandırması olmayan sembolü gizlemez, ayrı grupta gösterir', () => {
    const flows = flowBySector([row('GARAN', 600, 1), row('XXXXX', 400, 1)], MAP);
    const unknown = flows.find((f) => f.sector === UNCLASSIFIED)!;
    expect(unknown.value).toBe(400);
    // Paylar toplam işlem değerinin TAMAMI üzerinden: gizleseydik %100 olurdu.
    expect(flows.find((f) => f.sector === 'Bankacılık')!.sharePct).toBeCloseTo(60, 12);
  });

  it('sınıflandırılmamış grup her zaman en sonda durur', () => {
    const flows = flowBySector([row('XXXXX', 5000, 1), row('GARAN', 10, 1)], MAP);
    expect(flows[flows.length - 1].sector).toBe(UNCLASSIFIED);
  });

  it('payların toplamı %100 eder', () => {
    const flows = flowBySector(
      [row('GARAN', 600, 1), row('EREGL', 300, -2), row('XXXXX', 100, 0)],
      MAP,
    );
    const total = flows.reduce((a, f) => a + f.sharePct, 0);
    expect(total).toBeCloseTo(100, 10);
  });

  it('sınıflandırma yoksa boş döner — sektör uydurulmaz', () => {
    expect(flowBySector([row('GARAN', 600, 1)], null)).toEqual([]);
  });

  it('kapsama oranını dürüst sayar', () => {
    expect(sectorCoverage(['GARAN', 'AKBNK', 'XXXXX', 'YYYYY'], MAP)).toEqual({
      known: 2,
      total: 4,
      pct: 50,
    });
    expect(sectorCoverage(['GARAN'], null)).toEqual({ known: 0, total: 1, pct: 0 });
  });

  it('bozuk dosyayı sektör haritası saymaz', () => {
    expect(isSectorMap(MAP)).toBe(true);
    expect(isSectorMap({ of: {} })).toBe(false);
    expect(isSectorMap(null)).toBe(false);
    expect(isSectorMap({ source: 'x', generated: 1 })).toBe(false);
  });
});

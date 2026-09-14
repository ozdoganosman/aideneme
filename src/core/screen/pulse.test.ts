import { describe, expect, it } from 'vitest';
import { flowByCluster, pulseRow, summarizePulse, type PulseRow } from './pulse';
import { DAY_SECONDS } from '../data/pack';
import { emptyCandles, type Candles } from '../data/types';

function series(closes: number[], volumes?: number[]): Candles {
  const c = emptyCandles(closes.length);
  closes.forEach((v, i) => {
    c.time[i] = (20000 + i) * DAY_SECONDS;
    c.open[i] = v;
    c.high[i] = v;
    c.low[i] = v;
    c.close[i] = v;
    c.volume[i] = volumes?.[i] ?? 1000;
  });
  return c;
}

const flat = Array.from({ length: 60 }, () => 100);

describe('pulseRow', () => {
  it('son bar değişimini ve işlem değerini verir', () => {
    const closes = [...flat.slice(0, 59), 110];
    const row = pulseRow(
      'AAA',
      series(
        closes,
        closes.map(() => 2000),
      ),
    )!;
    expect(row.changePct).toBeCloseTo(10, 6);
    expect(row.value).toBeCloseTo(110 * 2000, 6);
  });

  it('yeni zirveyi ve dibi işaretler', () => {
    const up = pulseRow('AAA', series([...flat.slice(0, 59), 150]))!;
    expect(up.newHigh).toBe(true);
    expect(up.newLow).toBe(false);
    expect(up.fromHigh).toBeCloseTo(0, 6);

    const down = pulseRow('BBB', series([...flat.slice(0, 59), 50]))!;
    expect(down.newLow).toBe(true);
    expect(down.fromLow).toBeCloseTo(0, 6);
  });

  it('kısa seriyi atlar (uydurma nabız üretmez)', () => {
    expect(pulseRow('AAA', series([100, 101]))).toBeNull();
    expect(pulseRow('AAA', emptyCandles(0))).toBeNull();
  });
});

describe('summarizePulse', () => {
  const rows: PulseRow[] = [
    {
      symbol: 'A',
      last: 10,
      changePct: 2,
      value: 1000,
      fromHigh: 0,
      fromLow: 10,
      newHigh: true,
      newLow: false,
      bars: 60,
    },
    {
      symbol: 'B',
      last: 10,
      changePct: -1,
      value: 3000,
      fromHigh: -5,
      fromLow: 2,
      newHigh: false,
      newLow: false,
      bars: 60,
    },
    {
      symbol: 'C',
      last: 10,
      changePct: 0,
      value: 500,
      fromHigh: -2,
      fromLow: 1,
      newHigh: false,
      newLow: false,
      bars: 60,
    },
    {
      symbol: 'D',
      last: 10,
      changePct: 4,
      value: 500,
      fromHigh: 0,
      fromLow: 20,
      newHigh: false,
      newLow: true,
      bars: 60,
    },
  ];

  it('genişliği yön veren semboller üzerinden hesaplar', () => {
    const s = summarizePulse(rows);
    expect(s.advancing).toBe(2);
    expect(s.declining).toBe(1);
    expect(s.unchanged).toBe(1);
    expect(s.breadthPct).toBeCloseTo((2 / 3) * 100, 6); // değişmeyen sayılmaz
  });

  it('para akışını hacimle ağırlıklandırır, sayıyla değil', () => {
    const s = summarizePulse(rows);
    // Sayıca yükselen çok (2 vs 1) ama para düşenlerde: 1500 yukarı, 3000 aşağı.
    expect(s.upValue).toBe(1500);
    expect(s.downValue).toBe(3000);
    expect(s.flowPct).toBeLessThan(0);
  });

  it('medyan değişimi ortalamadan ayrı verir', () => {
    expect(summarizePulse(rows).medianChangePct).toBeCloseTo(1, 6); // (0 + 2) / 2
  });

  it('boş girdide çökmez', () => {
    const s = summarizePulse([]);
    expect(s.symbols).toBe(0);
    expect(Number.isNaN(s.breadthPct)).toBe(true);
  });
});

describe('flowByCluster', () => {
  const rows: PulseRow[] = [
    {
      symbol: 'A1',
      last: 10,
      changePct: 3,
      value: 5000,
      fromHigh: 0,
      fromLow: 5,
      newHigh: true,
      newLow: false,
      bars: 60,
    },
    {
      symbol: 'A2',
      last: 10,
      changePct: 1,
      value: 1000,
      fromHigh: -1,
      fromLow: 3,
      newHigh: false,
      newLow: false,
      bars: 60,
    },
    {
      symbol: 'B1',
      last: 10,
      changePct: -2,
      value: 9000,
      fromHigh: -8,
      fromLow: 1,
      newHigh: false,
      newLow: false,
      bars: 60,
    },
    {
      symbol: 'B2',
      last: 10,
      changePct: -1,
      value: 100,
      fromHigh: -4,
      fromLow: 2,
      newHigh: false,
      newLow: false,
      bars: 60,
    },
    {
      symbol: 'C1',
      last: 10,
      changePct: 5,
      value: 700,
      fromHigh: 0,
      fromLow: 9,
      newHigh: true,
      newLow: false,
      bars: 60,
    },
  ];
  const clusterOf = new Map([
    ['A1', 0],
    ['A2', 0],
    ['B1', 1],
    ['B2', 1],
    ['C1', 2],
  ]);

  it('grupları işlem değerine göre sıralar ve en çok işlem görenle etiketler', () => {
    const flows = flowByCluster(rows, clusterOf);
    expect(flows[0].label).toBe('B1');
    expect(flows[0].value).toBe(9100);
    expect(flows[1].label).toBe('A1');
  });

  it('tek üyeli grupları eler (gürültü)', () => {
    const flows = flowByCluster(rows, clusterOf);
    expect(flows.some((f) => f.label === 'C1')).toBe(false);
    expect(flowByCluster(rows, clusterOf, 1).some((f) => f.label === 'C1')).toBe(true);
  });

  it('ağırlıklı değişim büyük hisseyi öne çıkarır', () => {
    const flows = flowByCluster(rows, clusterOf);
    const a = flows.find((f) => f.label === 'A1')!;
    // 5000×3 + 1000×1 = 16000 / 6000 = 2,67 (basit ortalama 2,0 olurdu)
    expect(a.weightedChangePct).toBeCloseTo(16000 / 6000, 6);
  });

  it('kümesi bilinmeyen semboller atlanır', () => {
    const flows = flowByCluster(rows, new Map([['A1', 0]]), 1);
    expect(flows).toHaveLength(1);
    expect(flows[0].symbols).toBe(1);
  });
});

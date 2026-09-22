import { describe, expect, it } from 'vitest';
import { ILERI_GETIRI_ID, ileriOzet, zamanMakinesiSatiri } from './zamanMakinesi';
import { DEFAULT_SCREEN_PARAMS, type ScreenRow } from './metrics';
import { emptyCandles, type Candles } from '../data/types';

function seri(kapanis: number[]): Candles {
  const c = emptyCandles(kapanis.length);
  for (let i = 0; i < kapanis.length; i++) {
    c.time[i] = (1000 + i) * 86_400;
    c.open[i] = c.high[i] = c.low[i] = c.close[i] = kapanis[i];
    c.volume[i] = 1000;
  }
  return c;
}

const satir = (symbol: string, ileri: number): ScreenRow => ({
  symbol,
  values: { [ILERI_GETIRI_ID]: ileri },
  bars: 100,
});

describe('zamanMakinesiSatiri', () => {
  it('ölçütler kesik seriden: "fiyat" o günün kapanışı, bugünün değil', () => {
    const k: number[] = [];
    for (let i = 0; i < 300; i++) k.push(100 + i);
    const c = seri(k);
    // 1249. gün = 250. bar (i=249, kapanış 349); sonrası 50 bar daha var.
    const row = zamanMakinesiSatiri('X', c, 1249 * 86_400, DEFAULT_SCREEN_PARAMS)!;
    expect(row.values.last).toBe(349);
    expect(row.bars).toBe(250);
    // İleri: 349 → 399
    expect(row.values[ILERI_GETIRI_ID]).toBeCloseTo((399 / 349 - 1) * 100, 10);
  });

  it('kesik seride iki bardan az kalırsa satır YOK — o gün evrende yoktu', () => {
    const c = seri([1, 2, 3, 4, 5]);
    expect(zamanMakinesiSatiri('X', c, 1000 * 86_400, DEFAULT_SCREEN_PARAMS)).toBeNull();
  });
});

describe('ileriOzet', () => {
  it('medyan, ortalama değil — tek uçan hisse sürüklemesin', () => {
    const o = ileriOzet([satir('A', 1), satir('B', 2), satir('C', 3), satir('D', 1000)]);
    expect(o.medyan).toBe(2.5);
    expect(o.n).toBe(4);
  });

  it('kazanan payı sıfırın ÜSTÜ; sıfır kazanan sayılmaz', () => {
    const o = ileriOzet([satir('A', -1), satir('B', 0), satir('C', 5), satir('D', 7)]);
    expect(o.kazananPay).toBe(0.5);
  });

  it('NaN sayıma girmiyor ve sayısı söyleniyor', () => {
    // Ölçülemeyen sembol "sıfır getirdi" sayılmaz; payda küçülünce söylenir.
    const o = ileriOzet([satir('A', 4), satir('B', Number.NaN), satir('C', 6)]);
    expect(o.n).toBe(2);
    expect(o.olculemeyen).toBe(1);
    expect(o.medyan).toBe(5);
  });

  it('hiç ölçülebilen yoksa medyan NaN — sayı uydurmuyor', () => {
    const o = ileriOzet([satir('A', Number.NaN)]);
    expect(o.n).toBe(0);
    expect(Number.isNaN(o.medyan)).toBe(true);
    expect(Number.isNaN(o.kazananPay)).toBe(true);
  });
});

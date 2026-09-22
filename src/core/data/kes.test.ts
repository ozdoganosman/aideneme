import { describe, expect, it } from 'vitest';
import { ileriGetiri, kesZaman, kesimIndeksi } from './kes';
import { emptyCandles, type Candles } from './types';

/** Günlük seri: i. bar = (1000 + i). gün, kapanış `kapanis[i]`. */
function seri(kapanis: number[], gunler?: number[]): Candles {
  const c = emptyCandles(kapanis.length);
  for (let i = 0; i < kapanis.length; i++) {
    c.time[i] = (gunler ? gunler[i] : 1000 + i) * 86_400;
    c.open[i] = c.high[i] = c.low[i] = c.close[i] = kapanis[i];
    c.volume[i] = 1;
  }
  return c;
}

describe('kesimIndeksi', () => {
  it('tCut dahil, sonrası hariç', () => {
    const c = seri([1, 2, 3, 4, 5]);
    expect(kesimIndeksi(c, 1002 * 86_400)).toBe(3); // günler 1000,1001,1002 kalır
  });

  it('tam gün üstünde değilse en yakın ÖNCEKİ bara kesiyor', () => {
    // Boşluklu seri: 1000, 1001, 1005. tCut = 1003 → yalnızca ilk iki bar.
    const c = seri([1, 2, 3], [1000, 1001, 1005]);
    expect(kesimIndeksi(c, 1003 * 86_400)).toBe(2);
  });

  it('serinin başından önce → 0, sonundan sonra → uzunluk', () => {
    const c = seri([1, 2, 3]);
    expect(kesimIndeksi(c, 999 * 86_400)).toBe(0);
    expect(kesimIndeksi(c, 5000 * 86_400)).toBe(3);
  });
});

describe('kesZaman', () => {
  it('kesilen seri kesim anından sonrasını GÖRMÜYOR', () => {
    // Look-ahead'in yapısal engeli: gelecekteki bar dizide hiç yok.
    const c = seri([10, 20, 30, 40]);
    const k = kesZaman(c, 1001 * 86_400);
    expect(k.length).toBe(2);
    expect(Array.from(k.close)).toEqual([10, 20]);
    expect(k.time.length).toBe(2);
  });

  it('kopya değil görünüm — aynı belleğe bakıyor', () => {
    const c = seri([10, 20, 30]);
    const k = kesZaman(c, 1001 * 86_400);
    expect(k.close.buffer).toBe(c.close.buffer);
  });

  it('kesim serinin sonunda ise aynı nesne dönüyor', () => {
    const c = seri([10, 20, 30]);
    expect(kesZaman(c, 1002 * 86_400)).toBe(c);
  });
});

describe('ileriGetiri', () => {
  it('kesim barından son bara yüzde', () => {
    const c = seri([100, 110, 120, 150]);
    // tCut = 1001. gün → taban 110, son 150 → +%36,36
    expect(ileriGetiri(c, 1001 * 86_400)).toBeCloseTo((150 / 110 - 1) * 100, 10);
  });

  it('kesim son barsa ileri getiri TANIMSIZ — sıfır değil', () => {
    // "Bugünden bugüne" bir getiri yok; sıfır yazmak "değişmedi" iddiasıdır.
    const c = seri([100, 110, 120]);
    expect(Number.isNaN(ileriGetiri(c, 1002 * 86_400))).toBe(true);
  });

  it('kesimden önce hiç bar yoksa NaN', () => {
    const c = seri([100, 110, 120]);
    expect(Number.isNaN(ileriGetiri(c, 500 * 86_400))).toBe(true);
  });

  it('boşluklu seride aynı tarih aynı barı seçiyor — sembol başına kayma yok', () => {
    // İki sembol, aynı takvim günü: biri boşluklu. tCut = 1003. gün.
    // Dolu seride 1003 barı var (kapanış 40); boşluklu seride son <=1003 olan
    // bar 1001 (kapanış 20). İkisi de AYNI TARİHE göre kesiliyor.
    const dolu = seri([10, 20, 30, 40, 50], [1000, 1001, 1002, 1003, 1004]);
    const bosluklu = seri([10, 20, 60], [1000, 1001, 1005]);
    const t = 1003 * 86_400;
    expect(ileriGetiri(dolu, t)).toBeCloseTo((50 / 40 - 1) * 100, 10);
    expect(ileriGetiri(bosluklu, t)).toBeCloseTo((60 / 20 - 1) * 100, 10);
  });
});

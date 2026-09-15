import { describe, expect, it } from 'vitest';
import type { Candles } from '../data/types';
import {
  BIST_SEKTOR_ENDEKSLERI,
  sektorAdi,
  sektorEslesmeleri,
  eslesmeHaritasi,
  sektorGetirileri,
  sektorOzeti,
  sektorunHisseleri,
} from './sectorIndices';

/** Verilen kapanışlardan seri kurar; diğer kolonlar testi ilgilendirmiyor. */
function seri(kapanislar: number[]): Candles {
  const n = kapanislar.length;
  const c = Float64Array.from(kapanislar);
  return {
    time: Float64Array.from({ length: n }, (_, i) => i * 86400),
    open: c,
    high: c,
    low: c,
    close: c,
    volume: new Float64Array(n),
    length: n,
  };
}

describe('BIST_SEKTOR_ENDEKSLERI', () => {
  it('kodlar benzersiz ve adlar dolu', () => {
    const kodlar = BIST_SEKTOR_ENDEKSLERI.map((s) => s.kod);
    expect(new Set(kodlar).size).toBe(kodlar.length);
    expect(BIST_SEKTOR_ENDEKSLERI.every((s) => s.ad.trim().length > 0)).toBe(true);
  });

  // Üst kümeler (XUSIN sınai, XUMAL mali) ve ana endeksler listede OLMAMALI:
  // bir şirket hem XBANK'ta hem XUMAL'da; ikisini yan yana sıralamak aynı
  // parayı iki kez saymak olurdu.
  it('ana endeks ve üst küme içermiyor', () => {
    const kodlar = new Set(BIST_SEKTOR_ENDEKSLERI.map((s) => s.kod));
    for (const yasak of ['XU100', 'XU030', 'XUSIN', 'XUMAL', 'XUTUM', 'XUHIZ']) {
      expect(kodlar.has(yasak), `${yasak} listede olmamalı`).toBe(false);
    }
  });

  it('kod → ad çevirisi, bilinmeyen kodda null', () => {
    expect(sektorAdi('XBANK')).toBe('Banka');
    expect(sektorAdi('XU100')).toBeNull();
  });
});

describe('sektorGetirileri', () => {
  it('pencere getirisini hesaplar ve büyükten küçüğe sıralar', () => {
    const seriler = new Map<string, Candles>([
      ['XBANK', seri([100, 101, 102, 103, 110])], // 4 barda +%10
      ['XGIDA', seri([100, 99, 98, 97, 95])], // 4 barda -%5
      ['XELKT', seri([100, 100, 100, 100, 100])], // yatay
    ]);
    const r = sektorGetirileri(seriler, 4);
    expect(r.map((s) => s.kod)).toEqual(['XBANK', 'XELKT', 'XGIDA']);
    expect(r[0].getiri).toBeCloseTo(10, 10);
    expect(r[2].getiri).toBeCloseTo(-5, 10);
    expect(r[0].son).toBe(110);
  });

  // Pencere son bardan GERİYE sayılıyor: 2 barlık pencere son üç kapanışın
  // ilkine göre değil, sondan İKİNCİ öncekine göre ölçülür.
  it('pencereyi son bardan geriye sayıyor', () => {
    const seriler = new Map<string, Candles>([['XBANK', seri([10, 20, 40, 80])]]);
    expect(sektorGetirileri(seriler, 1)[0].getiri).toBeCloseTo(100, 10); // 40 → 80
    expect(sektorGetirileri(seriler, 3)[0].getiri).toBeCloseTo(700, 10); // 10 → 80
  });

  // Eksik veri SIFIR GETİRİ sayılmıyor: öyle olsaydı verisi olmayan sektör
  // "yatay seyretti" diye okunurdu ve bu yanlış bilgidir.
  it('penceresi dolmayan, olmayan ve tabanı geçersiz seriyi atlar', () => {
    const seriler = new Map<string, Candles>([
      ['XBANK', seri([100, 110])], // 4 barlık pencere için kısa
      ['XGIDA', seri([0, 0, 0, 0, 50])], // taban 0 → yüzde tanımsız
      ['XELKT', seri([100, 100, 100, 100, 120])], // geçerli
    ]);
    const r = sektorGetirileri(seriler, 4);
    expect(r.map((s) => s.kod)).toEqual(['XELKT']);
  });

  it('listede olmayan sembolleri yok sayar', () => {
    const seriler = new Map<string, Candles>([
      ['XU100', seri([100, 200])],
      ['THYAO', seri([100, 200])],
    ]);
    expect(sektorGetirileri(seriler, 1)).toEqual([]);
  });
});

describe('sektorOzeti', () => {
  it('kaç sektörün artıda olduğunu ve uçları söylüyor', () => {
    const seriler = new Map<string, Candles>([
      ['XBANK', seri([100, 110])],
      ['XGIDA', seri([100, 95])],
      ['XELKT', seri([100, 105])],
    ]);
    const ozet = sektorOzeti(sektorGetirileri(seriler, 1));
    expect(ozet).toBe('3 sektörün 2 tanesi artıda. Başta Banka, sonda Gıda, İçecek.');
  });

  // Ölçüm yoksa cümle de yok: "hiçbir sektör artıda değil" demek, ölçemediğimiz
  // bir şeyi ölçmüş gibi göstermek olurdu.
  it('boş listede cümle uydurmuyor', () => {
    expect(sektorOzeti([])).toBeNull();
  });
});

describe('sektorEslesmeleri', () => {
  /** Seriyi verilen günlük getirilerden kurar (zaman ekseni ortak). */
  function getiriSerisi(getiriler: number[], baslangic = 100): Candles {
    const kapanis = [baslangic];
    for (const g of getiriler) kapanis.push(kapanis[kapanis.length - 1] * (1 + g));
    return seri(kapanis);
  }

  // 120 barlık gürültü; iki seri AYNI gürültüyü paylaşınca korelasyon 1'e yakın.
  const gurultu = Array.from({ length: 120 }, (_, i) => Math.sin(i * 1.7) * 0.02);
  const baska = Array.from({ length: 120 }, (_, i) => Math.cos(i * 0.9) * 0.02);

  it('hisseyi en çok birlikte hareket ettiği endeksle eşleştirir', () => {
    const endeksler = new Map<string, Candles>([
      ['XBANK', getiriSerisi(gurultu)],
      ['XGIDA', getiriSerisi(baska)],
    ]);
    const hisseler = new Map<string, Candles>([
      ['AAA', getiriSerisi(gurultu.map((g) => g * 1.3))], // XBANK ile aynı ritim
      ['BBB', getiriSerisi(baska.map((g) => g * 0.8))], // XGIDA ile aynı ritim
    ]);
    const r = sektorEslesmeleri(hisseler, endeksler, { minOrtak: 50 });
    const eslesme = Object.fromEntries(r.map((e) => [e.symbol, e.kod]));
    expect(eslesme).toEqual({ AAA: 'XBANK', BBB: 'XGIDA' });
    expect(r.every((e) => e.korelasyon > 0.9)).toBe(true);
  });

  // Eşiğin ALTINDA kalan hisse bildirilmiyor: zayıf bir benzerliğe sektör
  // etiketi yapıştırmak, ölçmediğimiz bir şeyi ölçmüş gibi göstermek olurdu.
  it('eşiğin altındaki eşleşmeyi bildirmiyor', () => {
    const endeksler = new Map<string, Candles>([['XBANK', getiriSerisi(gurultu)]]);
    const hisseler = new Map<string, Candles>([['AAA', getiriSerisi(baska)]]);
    expect(sektorEslesmeleri(hisseler, endeksler, { minOrtak: 50 })).toEqual([]);
    // Eşik düşürülünce aynı hisse görünüyor — eleyen şey eşik, hesap değil.
    const gevsek = sektorEslesmeleri(hisseler, endeksler, { minOrtak: 50, esik: -1 });
    expect(gevsek).toHaveLength(1);
    expect(Math.abs(gevsek[0].korelasyon)).toBeLessThan(0.7);
  });

  it('ortak gün sayısı yetersizse eşleştirmiyor', () => {
    const endeksler = new Map<string, Candles>([['XBANK', getiriSerisi(gurultu)]]);
    const hisseler = new Map<string, Candles>([['AAA', getiriSerisi(gurultu)]]);
    expect(sektorEslesmeleri(hisseler, endeksler, { minOrtak: 500 })).toEqual([]);
  });

  it('endeks yoksa boş döner, patlamaz', () => {
    const hisseler = new Map<string, Candles>([['AAA', getiriSerisi(gurultu)]]);
    expect(sektorEslesmeleri(hisseler, new Map(), { minOrtak: 50 })).toEqual([]);
  });

  it('sektörün hisselerini kodla süzer', () => {
    const endeksler = new Map<string, Candles>([
      ['XBANK', getiriSerisi(gurultu)],
      ['XGIDA', getiriSerisi(baska)],
    ]);
    const hisseler = new Map<string, Candles>([
      ['AAA', getiriSerisi(gurultu.map((g) => g * 1.3))],
      ['BBB', getiriSerisi(baska.map((g) => g * 0.8))],
      ['CCC', getiriSerisi(gurultu.map((g) => g * 0.7))],
    ]);
    const hepsi = sektorEslesmeleri(hisseler, endeksler, { minOrtak: 50 });
    expect(
      sektorunHisseleri(hepsi, 'XBANK')
        .map((e) => e.symbol)
        .sort(),
    ).toEqual(['AAA', 'CCC']);
    expect(sektorunHisseleri(hepsi, 'XGIDA').map((e) => e.symbol)).toEqual(['BBB']);
  });
});

describe('eslesmeHaritasi', () => {
  it('eşleşmeleri sembol → sektör adı haritasına çevirir', () => {
    const harita = eslesmeHaritasi([
      { symbol: 'AAA', kod: 'XBANK', ad: 'Banka', korelasyon: 0.9, ortak: 200 },
      { symbol: 'BBB', kod: 'XGIDA', ad: 'Gıda, İçecek', korelasyon: 0.8, ortak: 200 },
    ]);
    expect(harita.of).toEqual({ AAA: 'Banka', BBB: 'Gıda, İçecek' });
  });

  // Kaynak adı, bunun resmî sınıflandırma OLMADIĞINI söylemeli: haritayı
  // kullanan yüzey kaynağı ekrana yazıyor.
  it('kaynağı resmî sınıflandırma diye sunmuyor', () => {
    const harita = eslesmeHaritasi([]);
    expect(harita.source).toMatch(/korelasyon/i);
    expect(harita.of).toEqual({});
  });
});

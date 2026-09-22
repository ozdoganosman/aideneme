import { describe, expect, it } from 'vitest';
import { akisGunleriHesapla, gunSatirlari } from './akisGunleri';
import { flowBySector } from './sectors';
import type { Bundle } from '../data/pack';

/**
 * Elle kurulan küçük paket: 3 sembol, 5 gün. NaN = o gün işlem yok.
 * Hacim her yerde 10 (değer = kapanış × 10).
 */
function paket(kapanis: number[][], gunler = [100, 101, 102, 103, 104]): Bundle {
  const bars = gunler.length;
  const names = kapanis.map((_, i) => `S${i}`);
  return {
    names,
    days: Int32Array.from(gunler),
    bars,
    closeAt: (si, di) => kapanis[si][di],
    volumeAt: (si, di) => (Number.isNaN(kapanis[si][di]) ? Number.NaN : 10),
    seriesOf: () => null,
  };
}

describe('akisGunleriHesapla', () => {
  it('son N günün karelerini gün eksenine hizalı üretiyor', () => {
    const p = paket([
      [10, 11, 12, 13, 14],
      [20, 20, 20, 20, 20],
    ]);
    const a = akisGunleriHesapla(p, 3);
    expect(Array.from(a.gunler)).toEqual([102, 103, 104]);
    expect(a.semboller).toEqual(['S0', 'S1']);
    // S0, kare 0 (gün 102): değer 12×10, değişim 12/11−1
    expect(a.deger[0]).toBe(120);
    expect(a.degisim[0]).toBeCloseTo((12 / 11 - 1) * 100, 5);
    // S1 hiç değişmiyor
    expect(a.degisim[3 + 0]).toBeCloseTo(0, 10);
  });

  it('boşluklu sembolde değişim ÖNCEKİ SONLU kapanışa göre — kare başka güne kaymıyor', () => {
    // S0 103. gün işlem görmüyor. 104. günün değişimi 102'ye göre olmalı;
    // 103. günün değeri 0, değişimi NaN.
    const p = paket([[10, 10, 12, Number.NaN, 15]]);
    const a = akisGunleriHesapla(p, 3); // günler 102,103,104
    expect(a.deger[1]).toBe(0);
    expect(Number.isNaN(a.degisim[1])).toBe(true);
    expect(a.degisim[2]).toBeCloseTo((15 / 12 - 1) * 100, 5);
    // Gün ekseni sabit: kayma yok.
    expect(Array.from(a.gunler)).toEqual([102, 103, 104]);
  });

  it('ilk karenin değişimi pencere ÖNCESİNDEKİ kapanışa dayanıyor', () => {
    // Pencere 102'den başlıyor ama 102'nin değişimi 101'e göre; pencere
    // dışına bakılmasa ilk kare "değişim yok" olurdu.
    const p = paket([[10, 20, 30, 30, 30]]);
    const a = akisGunleriHesapla(p, 3);
    expect(a.degisim[0]).toBeCloseTo(50, 10);
  });

  it('N paketten büyükse pakete kırpılıyor', () => {
    const p = paket([[1, 2, 3, 4, 5]]);
    const a = akisGunleriHesapla(p, 99);
    expect(a.gunler.length).toBe(5);
  });
});

describe('gunSatirlari + flowBySector', () => {
  it('işlem görmeyen sembol kareye GİRMİYOR — 0 × NaN sektörü NaN yapmasın', () => {
    const p = paket([
      [10, 10, 12, Number.NaN, 15],
      [20, 20, 22, 24, 26],
    ]);
    const a = akisGunleriHesapla(p, 3);
    const kare1 = gunSatirlari(a, 1); // gün 103: S0 yok
    expect(kare1.map((r) => r.symbol)).toEqual(['S1']);
    const akis = flowBySector(kare1, { of: { S0: 'A', S1: 'A' }, source: 't' } as never);
    expect(akis).toHaveLength(1);
    expect(Number.isFinite(akis[0].weightedChangePct)).toBe(true);
  });

  it('her kare aynı toplama kuralından geçiyor: bugünkü kare flowBySector ile birebir', () => {
    // Oynatıcının son karesi ile Nabız'ın bugünkü tablosu aynı sayıyı vermeli;
    // iki ayrı toplama semantiği olmadığının kanıtı.
    const p = paket([
      [10, 11, 12, 13, 14],
      [20, 21, 22, 23, 24],
      [5, 5, 5, 5, 6],
    ]);
    const a = akisGunleriHesapla(p, 2);
    const son = gunSatirlari(a, 1);
    const harita = { of: { S0: 'X', S1: 'X', S2: 'Y' }, source: 't' } as never;
    const akis = flowBySector(son, harita);
    const x = akis.find((f) => f.sector === 'X')!;
    // X: değerler 140 ve 240; değişimler 14/13−1 ve 24/23−1, değerle ağırlıklı.
    const w = (140 * (14 / 13 - 1) * 100 + 240 * (24 / 23 - 1) * 100) / 380;
    expect(x.value).toBeCloseTo(380, 3);
    expect(x.weightedChangePct).toBeCloseTo(w, 3);
  });

  it('geçersiz kare indeksi boş', () => {
    const a = akisGunleriHesapla(paket([[1, 2, 3, 4, 5]]), 3);
    expect(gunSatirlari(a, -1)).toEqual([]);
    expect(gunSatirlari(a, 3)).toEqual([]);
  });
});

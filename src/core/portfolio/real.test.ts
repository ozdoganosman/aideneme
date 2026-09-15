import { describe, expect, it } from 'vitest';
import { inflationFactor, realCostBasis, realReturnOfLots, realReturnPct } from './real';

const unix = (y: number, m = 0, d = 1) => Date.UTC(y, m, d) / 1000;

describe('inflationFactor', () => {
  it('aynı tarihte 1 döner', () => {
    expect(inflationFactor(unix(2020), unix(2020))).toBe(1);
    expect(inflationFactor(unix(2020), unix(2019))).toBe(1);
  });

  it('yüksek enflasyon yılında belirgin biçimde 1’in üstünde', () => {
    // 2022: TÜFE çok yüksek — bir yılda çarpan 1,5'in üzerinde olmalı.
    const factor = inflationFactor(unix(2022), unix(2023));
    expect(factor).toBeGreaterThan(1.5);
  });

  it('daha uzun dönem daha büyük çarpan verir (birikimli)', () => {
    const short = inflationFactor(unix(2021), unix(2022));
    const long = inflationFactor(unix(2021), unix(2024));
    expect(long).toBeGreaterThan(short);
  });
});

describe('realReturnPct', () => {
  it('enflasyonun altındaki nominal getiri reelde negatiftir', () => {
    const real = realReturnPct(20, unix(2022), unix(2023));
    expect(real).toBeLessThan(0);
  });

  it('enflasyonun üstündeki getiri reelde pozitif kalır', () => {
    const real = realReturnPct(300, unix(2022), unix(2023));
    expect(real).toBeGreaterThan(0);
  });

  it('sıfır süre nominali korur', () => {
    expect(realReturnPct(12, unix(2020), unix(2020))).toBeCloseTo(12, 6);
  });
});

/**
 * LOT BAZINDA REEL GETİRİ.
 *
 * Kusur gerçek veride ölçüldü: reel getiri portföyün TAMAMINI ilk işlem
 * tarihinden düşürüyordu. 15 Ocak 2025'te THYAO, 10 Mart 2025'te GARAN
 * alınan bir portföyde ekran -%18,6 diyordu; her lot kendi tarihinden
 * düşürülünce -%17,1 çıkıyor. 1,5 puan ve yönü SİSTEMATİK: sonradan
 * eklenen para baştan beri enflasyona maruz sayıldığı için kayıp her zaman
 * abartılıyordu.
 */
describe('realReturnOfLots', () => {
  const DEGERLEME = unix(2026, 8, 14);

  it('geç bağlanan para daha az enflasyona maruz kalıyor', () => {
    const erken = realCostBasis([{ cost: 1000, date: unix(2024, 0, 1) }], DEGERLEME);
    const gec = realCostBasis([{ cost: 1000, date: unix(2025, 0, 1) }], DEGERLEME);
    expect(erken).toBeGreaterThan(gec);
    // İkisi de enflasyonlu dönemde: maliyet nominalin üstüne çıkmalı.
    expect(gec).toBeGreaterThan(1000);
  });

  /*
    ASIL KUSURUN TESTİ. İki lot, biri geç. Tek tarihli (eski) hesap, geç
    lotu da ERKEN tarihten düşürür ve reel getiriyi olduğundan KÖTÜ gösterir.
  */
  it('tek tarihli hesaba göre kaybı abartmıyor', () => {
    const lots = [
      { cost: 25_025, date: unix(2025, 0, 15) },
      { cost: 20_020, date: unix(2025, 2, 10) },
    ];
    const deger = 56_330;
    const lotBazli = realReturnOfLots(deger, lots, DEGERLEME);

    // Eski davranış: nominal getiri TEK bir çarpana bölünüyordu (ilk tarih).
    const nominalPct = (deger / (25_025 + 20_020) - 1) * 100;
    const tekTarihli = realReturnPct(nominalPct, unix(2025, 0, 15), DEGERLEME);

    expect(lotBazli).toBeGreaterThan(tekTarihli);
    // Fark göz ardı edilebilir değil: en az yarım puan.
    expect(lotBazli - tekTarihli).toBeGreaterThan(0.5);
  });

  it('tek lotta tek tarihli hesapla AYNI sonucu veriyor', () => {
    const tarih = unix(2025, 0, 15);
    const lots = [{ cost: 1000, date: tarih }];
    const deger = 1500;
    const nominalPct = (deger / 1000 - 1) * 100;
    expect(realReturnOfLots(deger, lots, DEGERLEME)).toBeCloseTo(
      realReturnPct(nominalPct, tarih, DEGERLEME),
      8,
    );
  });

  it('maliyetsiz portföyde sayı UYDURMUYOR', () => {
    expect(realReturnOfLots(1000, [], DEGERLEME)).toBeNaN();
    expect(realReturnOfLots(1000, [{ cost: 0, date: unix(2025) }], DEGERLEME)).toBeNaN();
  });
});

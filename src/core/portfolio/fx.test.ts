import { describe, expect, it } from 'vitest';
import { fxRange, isFxSeries, rateAt, returnInCurrency, type FxSeries } from './fx';

const FX: FxSeries = {
  source: 'Test',
  generated: 1,
  currency: 'USD',
  days: [19000, 19010, 19020, 19030],
  rates: [30, 32, 35, 34],
};

describe('kur serisi', () => {
  it('tam eşleşen günün kurunu verir', () => {
    expect(rateAt(FX, 19010)).toBe(32);
    expect(rateAt(FX, 19030)).toBe(34);
  });

  it('ara günlerde SON BİLİNEN kuru taşır, enterpolasyon yapmaz', () => {
    // 19015 için 32 ile 35 arasında bir değer uydurmak, olmayan bir fiyat
    // üretmek olurdu.
    expect(rateAt(FX, 19015)).toBe(32);
    expect(rateAt(FX, 19029)).toBe(35);
  });

  it('serinin sonundan sonrası için son kuru kullanır', () => {
    expect(rateAt(FX, 19999)).toBe(34);
  });

  it('serinin başlangıcından öncesi için NaN döner', () => {
    // "En eski kuru kullan" demek geçmişi çarpıtmak olurdu.
    expect(Number.isNaN(rateAt(FX, 18999))).toBe(true);
  });

  it('döviz bazlı getiriyi kurlarıyla birlikte verir', () => {
    // 3000 TL @30 = 100 USD → 3400 TL @34 = 100 USD: TL'de +%13,3, dolarda %0.
    const out = returnInCurrency(FX, 19000, 19030, 3000, 3400)!;
    expect(out.from).toBeCloseTo(100, 10);
    expect(out.to).toBeCloseTo(100, 10);
    expect(out.returnPct).toBeCloseTo(0, 10);
    expect(out.rateFrom).toBe(30);
    expect(out.rateTo).toBe(34);
  });

  it('TL kazancı kur artışını yenemezse dolar bazında kayıp gösterir', () => {
    // TL'de +%20 ama kur +%13,3 → dolarda +%5,9.
    const out = returnInCurrency(FX, 19000, 19030, 3000, 3600)!;
    expect(out.returnPct).toBeCloseTo(5.88, 2);
  });

  it('kur bilinmiyorsa sonuç ÜRETMEZ', () => {
    expect(returnInCurrency(null, 19000, 19030, 100, 200)).toBeNull();
    // Başlangıç günü serinin öncesinde: hesap yapılamaz.
    expect(returnInCurrency(FX, 18000, 19030, 100, 200)).toBeNull();
  });

  it('başlangıç bitişten sonraysa hesap yapmaz', () => {
    // Bayat fiyat verisinde bugün girilen bir işlem bu durumu yaratıyor. İki
    // uçta da son kur kullanılsaydı kur etkisi sıfırlanır ve TL getirisi
    // "döviz getirisi" diye gösterilirdi.
    expect(returnInCurrency(FX, 19030, 19000, 1000, 1200)).toBeNull();
  });

  it('bozuk dosyayı kur serisi saymaz', () => {
    expect(isFxSeries(FX)).toBe(true);
    expect(isFxSeries({ source: 'x', currency: 'USD', days: [1], rates: [] })).toBe(false);
    expect(isFxSeries({ days: [1], rates: [2] })).toBe(false);
    expect(isFxSeries(null)).toBe(false);
  });

  it('kapsadığı aralığı bildirir', () => {
    expect(fxRange(FX)).toEqual({ first: 19000, last: 19030 });
    expect(fxRange(null)).toBeNull();
  });
});

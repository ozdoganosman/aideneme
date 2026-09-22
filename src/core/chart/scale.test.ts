import { describe, expect, it } from 'vitest';
import { eksenAraligi } from './scale';

describe('eksenAraligi', () => {
  it('seriyi kenara yapıştırmıyor', () => {
    const { min, max } = eksenAraligi(100, 200);
    expect(min).toBeLessThan(100);
    expect(max).toBeGreaterThan(200);
    // Payanda aralığın %8'i, iki uçta da aynı.
    expect(100 - min).toBeCloseTo(8, 10);
    expect(max - 200).toBeCloseTo(8, 10);
  });

  /**
   * NEGATİF FİYAT DİYE BİR ŞEY YOK.
   *
   * Gerçek veride görüldü: THYAO'nun 14 yıllık fiyat serisi (en düşük ~5,
   * en yüksek ~350) alt eksen etiketini "-26" yapıyordu. Payanda sıfırın
   * altına inemez — orada veri olamaz.
   */
  it('negatif olmayan seride eksen sıfırın altına inmiyor', () => {
    const { min } = eksenAraligi(5, 350);
    expect(min).toBe(0);
  });

  it('sıfırdan başlayan seride de sıfırda kalıyor', () => {
    expect(eksenAraligi(0, 100).min).toBe(0);
  });

  // Gerçekten negatif değer taşıyan seri ETKİLENMEMELİ: getiri ve net kâr
  // eksiye iner ve payanda orada gereklidir.
  it('negatif değer taşıyan seride payanda korunuyor', () => {
    const { min } = eksenAraligi(-20, 40);
    expect(min).toBeLessThan(-20);
    expect(min).toBeCloseTo(-24.8, 10);
  });

  // Uzaktaki seri kırpılmıyor: min 300 iken sıfıra çekmek grafiği okunmaz
  // yapardı (tüm hareket üstteki ince bir şeride sıkışırdı).
  it('sıfırdan uzak seriyi sıfıra çekmiyor', () => {
    const { min } = eksenAraligi(300, 310);
    expect(min).toBeCloseTo(299.2, 10);
  });

  describe('sıfır çizgisi', () => {
    // Tamamı negatif bir seri, sıfır ölçek dışında kalırsa grafikte
    // YÜKSELİYORMUŞ gibi görünür.
    it('tamamı negatif seride sıfırı ölçeğe alıyor', () => {
      const { max } = eksenAraligi(-50, -10, { sifirCizgisi: true });
      expect(max).toBeGreaterThanOrEqual(0);
    });

    it('tamamı pozitif seride sıfırı ölçeğe alıyor ama altına inmiyor', () => {
      const { min } = eksenAraligi(10, 50, { sifirCizgisi: true });
      expect(min).toBe(0);
    });
  });

  it('düz seride aralık üretiyor, sıfıra bölmüyor', () => {
    const { min, max } = eksenAraligi(42, 42);
    expect(max).toBeGreaterThan(min);
  });

  it('geçersiz girdide güvenli aralık dönüyor', () => {
    expect(eksenAraligi(NaN, 10)).toEqual({ min: 0, max: 1 });
    expect(eksenAraligi(0, Infinity)).toEqual({ min: 0, max: 1 });
  });
});

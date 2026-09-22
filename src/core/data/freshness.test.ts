import { describe, expect, it } from 'vitest';
import { marketFreshness } from './freshness';

/** 2026-09-14 Pazartesi = epoch gün 20709. */
const MONDAY = Math.floor(Date.UTC(2026, 8, 14) / 86_400_000);

describe('marketFreshness', () => {
  it('en yeni barı alır, ortancayı değil', () => {
    // Bir sembol işlem görmemiş olabilir; piyasayı bayat yapmaz.
    const f = marketFreshness([MONDAY - 200, MONDAY - 150, MONDAY], { today: MONDAY });
    expect(f.lastDay).toBe(MONDAY);
    expect(f.level).toBe('taze');
  });

  it('aynı gün taze', () => {
    const f = marketFreshness([MONDAY], { today: MONDAY });
    // Son bar bugünse geride kalan iş günü yoktur.
    expect(f.ageWeekdays).toBe(0);
    expect(f.level).toBe('taze');
    expect(f.label).toMatch(/^Veri 14 Eyl 2026$/);
  });

  it('hafta sonu bayatlık üretmez', () => {
    // Cuma kapanışı, pazartesi bakılıyor: aradaki iki gün hafta sonu.
    const friday = MONDAY - 3;
    const f = marketFreshness([friday], { today: MONDAY });
    expect(f.ageWeekdays).toBe(1);
    expect(f.level).toBe('taze');
  });

  it('birkaç iş günü geride = gecikmeli', () => {
    const f = marketFreshness([MONDAY - 3 - 2], { today: MONDAY }); // önceki çarşamba
    expect(f.ageWeekdays).toBe(3);
    expect(f.level).toBe('gecikmeli');
    expect(f.detail).toMatch(/3 hafta içi gün geride/);
  });

  it('eşiğin üstü bayat ve süreyi metne yazar', () => {
    const f = marketFreshness([MONDAY - 30], { today: MONDAY });
    expect(f.level).toBe('bayat');
    expect(f.label).toMatch(/^Veri \d+ iş günü eski$/);
    // Ölçülen asıl kusur: kullanıcı hesapların hangi tarihe ait olduğunu
    // bilmiyordu. Bayat durumda bunu açıkça söylüyoruz.
    expect(f.detail).toMatch(/bu tarihe aittir, bugüne değil/);
  });

  it('ölçülen gerçek durum: örnek veri yaklaşık bir yıl eski', () => {
    const lastBar = Math.floor(Date.UTC(2025, 8, 28) / 86_400_000);
    const f = marketFreshness([lastBar], { today: MONDAY });
    expect(f.level).toBe('bayat');
    expect(f.ageWeekdays).toBeGreaterThan(200);
  });

  it('veri yoksa sayı uydurmaz', () => {
    const f = marketFreshness([], { today: MONDAY });
    expect(f.lastDay).toBeNull();
    expect(f.label).toBe('Veri yok');
  });

  it('geçersiz günleri yok sayar', () => {
    const f = marketFreshness([NaN, Infinity, MONDAY - 1], { today: MONDAY });
    expect(f.lastDay).toBe(MONDAY - 1);
  });

  it('her durumda yasal uyarıyı taşır', () => {
    for (const days of [[MONDAY], [MONDAY - 5], [MONDAY - 400], []]) {
      expect(marketFreshness(days, { today: MONDAY }).detail).toMatch(/yatırım tavsiyesi değildir/);
    }
  });
});

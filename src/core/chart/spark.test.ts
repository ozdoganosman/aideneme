import { describe, expect, it } from 'vitest';
import { normalizeSpark, sparkPoints } from './spark';

describe('sparkPoints', () => {
  it('kısa seriyi olduğu gibi döner, nokta uydurmaz', () => {
    expect(sparkPoints([1, 2, 3], 40)).toEqual([1, 2, 3]);
  });

  it('uzun seriyi istenen nokta sayısına yakın indirir', () => {
    const seri = Array.from({ length: 1000 }, (_, i) => i);
    const out = sparkPoints(seri, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.length).toBeGreaterThan(20);
  });

  // Asıl mesele bu: ortalama alan bir seyreltme çakılmayı siler ve
  // sparkline düz bir çizgiye döner — oysa sparkline'ın işi tam olarak o
  // sıçramayı göstermek.
  it('sıçramayı korur (ortalama alsaydı kaybolurdu)', () => {
    const seri = Array.from({ length: 400 }, () => 100);
    seri[200] = 20; // tek barlık sert çakılma
    const out = sparkPoints(seri, 40);
    expect(Math.min(...out)).toBe(20);
  });

  it('zaman sırasını korur: önce gelen önce çizilir', () => {
    // İlk yarı yükseliyor, ikinci yarı düşüyor → seyreltilmiş seri de öyle.
    const seri = [
      ...Array.from({ length: 200 }, (_, i) => i),
      ...Array.from({ length: 200 }, (_, i) => 200 - i),
    ];
    const out = sparkPoints(seri, 20);
    const tepe = out.indexOf(Math.max(...out));
    expect(tepe).toBeGreaterThan(0);
    expect(tepe).toBeLessThan(out.length - 1);
  });

  it('NaN bir fiyat değildir: atlanır, çizgiyi sıfıra çekmez', () => {
    expect(sparkPoints([1, NaN, 3, Infinity], 40)).toEqual([1, 3]);
  });

  it('boş seri boş döner', () => {
    expect(sparkPoints([], 40)).toEqual([]);
  });
});

describe('normalizeSpark', () => {
  it('0..1 kutusuna oturtur', () => {
    expect(normalizeSpark([10, 20, 30])).toEqual([0, 0.5, 1]);
  });

  it('düz seriyi ortaya koyar, dibe ya da tepeye yapıştırmaz', () => {
    // Yapıştırmak olmayan bir yönü varmış gibi gösterirdi.
    expect(normalizeSpark([5, 5, 5])).toEqual([0.5, 0.5, 0.5]);
  });

  it('boş seri boş döner', () => {
    expect(normalizeSpark([])).toEqual([]);
  });
});

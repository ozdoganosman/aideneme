import { describe, expect, it } from 'vitest';
import { squarify, type TreemapRect } from './treemap';

const alan = (r: TreemapRect) => r.w * r.h;
const kesisiyor = (a: TreemapRect, b: TreemapRect, tol = 1e-6) =>
  a.x < b.x + b.w - tol && b.x < a.x + a.w - tol && a.y < b.y + b.h - tol && b.y < a.y + a.h - tol;

describe('squarify', () => {
  it('alan ağırlığa orantılı — haritanın tüm iddiası bu', () => {
    const agirliklar = [50, 25, 15, 10];
    const rects = squarify(agirliklar, 400, 300);
    const toplamAlan = 400 * 300;
    for (const r of rects) {
      const beklenen = (agirliklar[r.index] / 100) * toplamAlan;
      expect(alan(r)).toBeCloseTo(beklenen, 4);
    }
  });

  it('kutular çakışmıyor', () => {
    const rects = squarify([40, 30, 20, 6, 3, 1], 500, 320);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(kesisiyor(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it('kutular kutunun dışına taşmıyor', () => {
    const rects = squarify([9, 7, 5, 4, 3, 2, 1], 300, 200);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(300 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(200 + 1e-6);
    }
  });

  it('alanların toplamı kutuyu doldurur (boşluk kalmıyor)', () => {
    const rects = squarify([12, 9, 8, 6, 5, 4, 3, 2, 2, 1], 480, 260);
    const toplam = rects.reduce((s, r) => s + alan(r), 0);
    expect(toplam).toBeCloseTo(480 * 260, 2);
  });

  // Asıl mesele: naif "dilimle" yerleşimi ince uzun şeritler üretir ve o
  // şeritlerin alanı gözle karşılaştırılamaz. Kare olmaya yakınlık, bu
  // grafiğin okunabilirliğinin kendisi.
  it('kutular kareye yakın kalıyor (ince şerit üretmiyor)', () => {
    const esit = Array.from({ length: 64 }, () => 1);
    const rects = squarify(esit, 400, 400);
    const enKotu = Math.max(...rects.map((r) => Math.max(r.w / r.h, r.h / r.w)));
    // Naif dilimleme 64 eşit değerde 64:1 oran verirdi.
    expect(enKotu).toBeLessThan(2.5);
  });

  it('indeks korunuyor: kutu kendi verisine bağlanabiliyor', () => {
    const rects = squarify([1, 100, 10], 200, 200);
    const enBuyuk = rects.reduce((a, b) => (alan(a) > alan(b) ? a : b));
    expect(enBuyuk.index).toBe(1);
  });

  it('sonlu olmayan ve pozitif olmayan ağırlıklar atlanır', () => {
    const rects = squarify([10, NaN, 0, -5, 10], 200, 100);
    expect(rects.map((r) => r.index).sort()).toEqual([0, 4]);
    expect(rects.reduce((s, r) => s + alan(r), 0)).toBeCloseTo(200 * 100, 2);
  });

  it('boş girdi ve geçersiz ölçü boş döner', () => {
    expect(squarify([], 100, 100)).toEqual([]);
    expect(squarify([1, 2], 0, 100)).toEqual([]);
    expect(squarify([1, 2], 100, -1)).toEqual([]);
  });

  it('tek ağırlık tüm kutuyu kaplar', () => {
    const [r] = squarify([7], 320, 240);
    expect(r).toMatchObject({ index: 0, x: 0, y: 0 });
    expect(r.w).toBeCloseTo(320, 6);
    expect(r.h).toBeCloseTo(240, 6);
  });
});

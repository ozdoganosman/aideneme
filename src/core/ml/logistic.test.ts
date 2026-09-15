import { describe, expect, it } from 'vitest';
import { fitStandardizer, predictProba, standardize, trainLogistic } from './logistic';

function rows(data: number[][]): Float64Array[] {
  return data.map((r) => Float64Array.from(r));
}

describe('lojistik regresyon', () => {
  it('ayrılabilir veriyi öğrenir', () => {
    const x: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 100; i++) {
      x.push([i / 100, 0.5]);
      y.push(i >= 50 ? 1 : 0);
    }
    const model = trainLogistic(rows(x), y, { iterations: 2000, learningRate: 0.5 });
    expect(predictProba(model, Float64Array.from([0.1, 0.5]))).toBeLessThan(0.3);
    expect(predictProba(model, Float64Array.from([0.9, 0.5]))).toBeGreaterThan(0.7);
    // İkinci sütun sabit: katsayısı sıfıra yakın kalmalı.
    expect(Math.abs(model.weights[1])).toBeLessThan(1e-6);
  });

  it('aynı girdiyle aynı katsayıları verir (rastgelelik yok)', () => {
    const x = rows([
      [1, 2],
      [2, 1],
      [3, 4],
      [4, 3],
    ]);
    const y = [0, 0, 1, 1];
    const a = trainLogistic(x, y);
    const b = trainLogistic(x, y);
    expect(Array.from(a.weights)).toEqual(Array.from(b.weights));
    expect(a.bias).toBe(b.bias);
  });

  it('sabit sütunda std 1 kabul edilir, bölme patlamaz', () => {
    const scaler = fitStandardizer(
      rows([
        [5, 1],
        [5, 2],
        [5, 3],
      ]),
      2,
    );
    expect(scaler.std[0]).toBe(1);
    const z = standardize(Float64Array.from([5, 2]), scaler);
    expect(z[0]).toBe(0);
    expect(Number.isFinite(z[1])).toBe(true);
  });

  it('boş eğitim kümesinde çökmez', () => {
    const model = trainLogistic([], []);
    expect(model.iterations).toBe(0);
    expect(model.bias).toBe(0);
  });

  it('eğitim kaybı azalır', () => {
    const x: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 60; i++) {
      x.push([Math.sin(i), i % 7]);
      y.push(Math.sin(i) > 0 ? 1 : 0);
    }
    const few = trainLogistic(rows(x), y, { iterations: 5 });
    const many = trainLogistic(rows(x), y, { iterations: 800 });
    expect(many.loss).toBeLessThan(few.loss);
  });
});

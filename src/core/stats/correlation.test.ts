import { describe, expect, it } from 'vitest';
import { clusterSymbols, correlationMatrix, type AlignedCloses } from './correlation';

/** Deterministik gürültü (LCG) — testler tekrarlanabilir olsun. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
}

/** Verilen getiri üreticilerinden hizalanmış kapanış ızgarası kurar. */
function grid(series: Record<string, (i: number) => number>, bars = 200): AlignedCloses {
  const symbols = Object.keys(series);
  const close = new Float64Array(symbols.length * bars);
  symbols.forEach((sym, s) => {
    let price = 100;
    for (let i = 0; i < bars; i++) {
      price *= 1 + series[sym](i);
      close[s * bars + i] = price;
    }
  });
  return { symbols, bars, close };
}

describe('correlationMatrix', () => {
  it('aynı seri 1, ters seri −1 verir', () => {
    const rnd = noise(11);
    const steps = Array.from({ length: 200 }, () => rnd() * 0.02);
    const { matrix, symbols } = correlationMatrix(
      grid({
        A: (i) => steps[i],
        B: (i) => steps[i],
        C: (i) => -steps[i],
      }),
    );
    const n = symbols.length;
    expect(matrix[0 * n + 1]).toBeCloseTo(1, 6);
    // C, A'nın BASİT getirisinin tersi; korelasyon LOG getiri üzerinden
    // hesaplandığı için tam −1 değil, ona çok yakın olur (log(1+r) ≠ −log(1−r)).
    expect(matrix[0 * n + 2]).toBeLessThan(-0.999);
    expect(matrix[0 * n + 0]).toBe(1);
  });

  it('bağımsız seriler sıfıra yakın', () => {
    const a = noise(5);
    const b = noise(99);
    const { matrix, symbols } = correlationMatrix(
      grid({ A: () => a() * 0.02, B: () => b() * 0.02 }, 400),
    );
    expect(Math.abs(matrix[0 * symbols.length + 1])).toBeLessThan(0.2);
  });

  it('matris simetrik', () => {
    const rnd = noise(3);
    const { matrix, symbols } = correlationMatrix(
      grid({ A: () => rnd() * 0.01, B: () => rnd() * 0.01, C: () => rnd() * 0.01 }),
    );
    const n = symbols.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = matrix[i * n + j];
        const b = matrix[j * n + i];
        if (Number.isNaN(a)) expect(Number.isNaN(b)).toBe(true);
        else expect(a).toBeCloseTo(b, 12);
      }
    }
  });

  it('yetersiz ortak gözlemde NaN bırakır (uydurma korelasyon yok)', () => {
    const base = grid({ A: () => 0.001, B: () => 0.002 }, 50);
    const { matrix } = correlationMatrix(base, { minPairs: 100 });
    expect(Number.isNaN(matrix[0 * 2 + 1])).toBe(true);
  });

  it('eksik barlar (NaN) çift bazında atlanır', () => {
    const g = grid({ A: () => 0.001, B: () => 0.001 }, 100);
    const close = Float64Array.from(g.close);
    for (let i = 10; i < 20; i++) close[1 * g.bars + i] = NaN; // B'de boşluk
    const { matrix, pairs } = correlationMatrix({ ...g, close }, { minPairs: 10 });
    expect(Number.isFinite(matrix[0 * 2 + 1])).toBe(true);
    expect(pairs[0 * 2 + 1]).toBeLessThan(99);
  });

  it('lookback yalnızca son N barı kullanır', () => {
    const bars = 300;
    // İlk yarıda birlikte, ikinci yarıda ters hareket.
    const g = grid(
      {
        A: (i) => (i % 2 === 0 ? 0.01 : -0.01),
        B: (i) => (i < 150 ? (i % 2 === 0 ? 0.01 : -0.01) : i % 2 === 0 ? -0.01 : 0.01),
      },
      bars,
    );
    const all = correlationMatrix(g).matrix[1];
    const recent = correlationMatrix(g, { lookback: 100 }).matrix[1];
    expect(recent).toBeLessThan(all);
    expect(recent).toBeCloseTo(-1, 4);
  });
});

describe('clusterSymbols', () => {
  it('birlikte hareket edenleri yan yana sıralar', () => {
    const g1 = noise(7);
    const g2 = noise(21);
    const stepsA = Array.from({ length: 300 }, () => g1() * 0.02);
    const stepsB = Array.from({ length: 300 }, () => g2() * 0.02);
    const { matrix, symbols } = correlationMatrix(
      grid(
        {
          A1: (i) => stepsA[i],
          B1: (i) => stepsB[i],
          A2: (i) => stepsA[i] * 0.98,
          B2: (i) => stepsB[i] * 1.02,
          A3: (i) => stepsA[i] * 1.01,
        },
        300,
      ),
    );
    const { order, clusterOf, count } = clusterSymbols(matrix, symbols.length, 0.5);

    const positions = new Map(order.map((idx, pos) => [symbols[idx], pos]));
    const aPositions = ['A1', 'A2', 'A3'].map((s) => positions.get(s)!).sort((x, y) => x - y);
    // A grubu sırada bitişik olmalı.
    expect(aPositions[2] - aPositions[0]).toBe(2);

    expect(count).toBe(2);
    expect(clusterOf[symbols.indexOf('A1')]).toBe(clusterOf[symbols.indexOf('A3')]);
    expect(clusterOf[symbols.indexOf('A1')]).not.toBe(clusterOf[symbols.indexOf('B1')]);
  });

  it('sıra tüm sembolleri tam olarak bir kez içerir', () => {
    const rnd = noise(2);
    const series: Record<string, () => number> = {};
    for (let i = 0; i < 12; i++) series[`S${i}`] = () => rnd() * 0.02;
    const { matrix, symbols } = correlationMatrix(grid(series, 150));
    const { order } = clusterSymbols(matrix, symbols.length);
    expect(order.slice().sort((a, b) => a - b)).toEqual(symbols.map((_, i) => i));
  });

  it('uç durumlar: boş ve tek sembol', () => {
    expect(clusterSymbols(new Float64Array(0), 0).order).toEqual([]);
    expect(clusterSymbols(new Float64Array([1]), 1)).toEqual({
      order: [0],
      clusterOf: [0],
      count: 1,
    });
  });
});

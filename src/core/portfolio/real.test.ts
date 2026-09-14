import { describe, expect, it } from 'vitest';
import { inflationFactor, realReturnPct } from './real';

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

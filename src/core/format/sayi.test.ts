import { describe, expect, it } from 'vitest';
import { trSayi } from './sayi';

describe('trSayi', () => {
  it('ondalık ayırıcı VİRGÜL — `toFixed` gibi nokta değil', () => {
    expect(trSayi(1.9, 1)).toBe('1,9');
    expect((1.9).toFixed(1)).toBe('1.9'); // kusurun kaynağı, karşılaştırma için
  });

  it('basamak sayısı sabit tutuluyor', () => {
    expect(trSayi(2, 1)).toBe('2,0');
    expect(trSayi(2.345, 2)).toBe('2,35');
    expect(trSayi(7, 0)).toBe('7');
  });

  it('binlik ayırıcı da Türkçe (nokta)', () => {
    expect(trSayi(1234.5, 1)).toBe('1.234,5');
  });

  it('sonlu olmayan değerde sayı uydurmuyor', () => {
    expect(trSayi(Number.NaN, 1)).toBe('—');
    expect(trSayi(Number.POSITIVE_INFINITY, 1)).toBe('—');
  });
});

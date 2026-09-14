import { describe, expect, it } from 'vitest';
import { trNum, trPct, trAmount, trCompact } from './format';

describe('Türkçe sayı biçimi', () => {
  it('ondalık virgül, binlik nokta', () => {
    expect(trNum(1234.5, 2)).toBe('1.234,50');
    expect(trNum(0.6103, 3)).toBe('0,610');
  });

  it('yüzde işareti sayının ÖNÜNDE, işaret en başta', () => {
    expect(trPct(3.61, 2, true)).toBe('+%3,61');
    expect(trPct(-3.61, 2, true)).toBe('-%3,61');
    // İşaretsiz bağlamda (oran/pay) artı yazılmaz.
    expect(trPct(40, 0)).toBe('%40');
  });

  it('sonsuz ve tanımsız değerler uydurulmaz', () => {
    expect(trNum(NaN)).toBe('—');
    expect(trPct(NaN)).toBe('—');
    expect(trAmount(NaN)).toBe('—');
    expect(trNum(Infinity)).toBe('∞');
    expect(trPct(Infinity)).toBe('∞');
  });

  it('sıfır işaretsiz yazılır', () => {
    expect(trPct(0, 1, true)).toBe('%0,0');
  });
});

describe('trCompact', () => {
  it('milyar, milyon ve bin eşiklerini Türkçe kısaltır', () => {
    expect(trCompact(16_600_000_000)).toBe('16,6 mlr');
    expect(trCompact(2_450_000)).toBe('2,5 mn');
    expect(trCompact(48_300)).toBe('48,3 b');
  });

  it('eşiğin altında kısaltmaz', () => {
    expect(trCompact(999)).toBe('999');
    expect(trCompact(0)).toBe('0');
  });

  it('negatifi de kısaltır', () => {
    // Nabız ekranındaki yerel kopya burada kısaltmayı atlayıp tam sayıya
    // düşüyordu: aynı sütunda iki ayrı biçim görünürdü.
    expect(trCompact(-2_450_000)).toBe('-2,5 mn');
    expect(trCompact(-48_300)).toBe('-48,3 b');
  });

  it('ölçülemeyende sayı uydurmaz', () => {
    expect(trCompact(NaN)).toBe('—');
    expect(trCompact(Infinity)).toBe('∞');
  });

  it('ondalık ayırıcı virgül kalır', () => {
    expect(trCompact(1_234_500_000)).toMatch(/^1,2 mlr$/);
    expect(trCompact(1_234_500_000)).not.toContain('.');
  });
});

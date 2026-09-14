import { describe, expect, it } from 'vitest';
import { trNum, trPct, trAmount } from './format';

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

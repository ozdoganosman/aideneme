import { describe, expect, it } from 'vitest';
import { isoDay, trDay, trDayIndex } from './date';

// 2025-09-28 00:00 UTC
const UNIX = Date.UTC(2025, 8, 28) / 1000;

describe('trDay', () => {
  it('Türkçe biçimde gün, kısa ay, yıl', () => {
    expect(trDay(UNIX)).toBe('28 Eyl 2025');
  });

  // Barlar UTC gün sınırında saklanıyor. Yerel saate çevirmek Türkiye'de
  // (UTC+3) gün başındaki bir barı bir ÖNCEKİ güne kaydırırdı.
  it('gün sınırında UTC kullanır, yerel saate kaymaz', () => {
    expect(trDay(Date.UTC(2025, 0, 1) / 1000)).toBe('1 Oca 2025');
    expect(trDay(Date.UTC(2025, 0, 1, 23, 59) / 1000)).toBe('1 Oca 2025');
  });

  it('sonlu olmayan değer için tire', () => {
    expect(trDay(NaN)).toBe('—');
    expect(trDayIndex(NaN)).toBe('—');
  });
});

describe('trDayIndex', () => {
  it('gün sayısını aynı biçime çevirir', () => {
    expect(trDayIndex(UNIX / 86_400)).toBe('28 Eyl 2025');
  });
});

describe('isoDay', () => {
  // Makineye giden tarih biçim DEĞİŞTİREMEZ: <input type="date"> değeri
  // HTML sözleşmesi gereği ISO olmak zorunda.
  it('makine biçimini korur', () => {
    expect(isoDay(UNIX)).toBe('2025-09-28');
  });
});

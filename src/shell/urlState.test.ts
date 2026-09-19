import { describe, expect, it } from 'vitest';
import { parseQuery, sameState, toQuery } from './urlState';

const DEFAULTS = { v: 'nabiz', s: '', tf: 'D' };

describe('parseQuery', () => {
  it('boş adres varsayılanları verir', () => {
    expect(parseQuery('', DEFAULTS)).toEqual(DEFAULTS);
  });

  it('yalnızca tanımlı anahtarları okur (bilinmeyen parametreler durumu kirletmez)', () => {
    expect(parseQuery('?v=tarayici&x=zararli', DEFAULTS)).toEqual({
      v: 'tarayici',
      s: '',
      tf: 'D',
    });
  });

  it('boş değeri yok sayar', () => {
    expect(parseQuery('?v=', DEFAULTS).v).toBe('nabiz');
  });

  it('baştaki soru işareti olsa da olmasa da çalışır', () => {
    expect(parseQuery('v=sembol', DEFAULTS).v).toBe('sembol');
  });
});

describe('toQuery', () => {
  it('varsayılanları yazmaz — link kısa kalır', () => {
    expect(toQuery(DEFAULTS, DEFAULTS)).toBe('');
  });

  it('yalnızca farklı olanları yazar', () => {
    expect(toQuery({ ...DEFAULTS, v: 'sembol', s: 'THYAO' }, DEFAULTS)).toBe('?v=sembol&s=THYAO');
  });

  it('gidiş-dönüş kayıpsız', () => {
    const state = { v: 'laboratuvar', s: 'GARAN', tf: 'W' };
    expect(parseQuery(toQuery(state, DEFAULTS), DEFAULTS)).toEqual(state);
  });
});

describe('sameState', () => {
  it('aynı içerikte true, farkta false', () => {
    expect(sameState({ a: '1' }, { a: '1' })).toBe(true);
    expect(sameState({ a: '1' }, { a: '2' })).toBe(false);
    expect(sameState({ a: '1' }, { a: '1', b: '2' })).toBe(false);
  });
});

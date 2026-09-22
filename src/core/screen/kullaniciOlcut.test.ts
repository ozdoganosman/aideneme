import { describe, expect, it } from 'vitest';
import {
  dagilim,
  kullaniciAnahtari,
  kullaniciOlcutId,
  kullaniciOlcutTanimi,
  kullaniciOlcutleri,
} from './kullaniciOlcut';

describe('kullanıcı ölçüt kimliği', () => {
  it('kul: önekini koruyor ve gos: ile çakışmıyor', () => {
    const id = kullaniciOlcutId('kul:abc', { n: 14 }, 'deger');
    expect(id.startsWith('kul:')).toBe(true);
    expect(id.startsWith('gos:')).toBe(false);
  });

  it('parametre SIRASINDAN bağımsız — JSON geri okunurken sıra değişse de aynı', () => {
    expect(kullaniciAnahtari('kul:x', { a: 1, b: 2 })).toBe(
      kullaniciAnahtari('kul:x', { b: 2, a: 1 }),
    );
  });

  it('farklı parametre farklı ölçüt', () => {
    expect(kullaniciOlcutId('kul:x', { n: 10 }, 'v')).not.toBe(
      kullaniciOlcutId('kul:x', { n: 20 }, 'v'),
    );
  });

  it('çıktılar ölçüte dönüyor; ölçek bildirilmediyse kıyasa girmiyor', () => {
    const olc = kullaniciOlcutleri('kul:x', { n: 5 }, 'Benim Göstergem', [
      { ad: 'a', etiket: 'A çizgisi', tur: 'cizgi', token: 'accent', olcek: 'yuzde0100' },
      { ad: 'b', etiket: 'B', tur: 'cizgi', token: 'warn' },
    ]);
    expect(olc.map((m) => m.etiket)).toEqual(['A çizgisi', 'B']);
    expect(olc[0].olcek).toBe('yuzde0100');
    expect(olc[1].olcek).toBeUndefined();
    expect(olc.map((m) => m.sira)).toEqual([0, 1]);
  });

  it('sağlaması göstergenin adını ve ayarını yazıyor', () => {
    const [m] = kullaniciOlcutleri('kul:x', { n: 5 }, 'Benim Göstergem', [
      { ad: 'a', etiket: 'A', tur: 'cizgi', token: 'accent' },
    ]);
    const f = kullaniciOlcutTanimi(m, { n: 5 }).formula({} as never);
    expect(f).toContain('Benim Göstergem');
    expect(f).toContain('n=5');
  });
});

describe('dağılım', () => {
  it('beş sayı, medyan ortalamadan bağımsız', () => {
    const d = dagilim([1, 2, 3, 4, 1000]);
    expect(d.n).toBe(5);
    expect(d.min).toBe(1);
    expect(d.medyan).toBe(3); // ortalama 202 olurdu
    expect(d.max).toBe(1000);
  });

  it('çeyrekler doğrusal ara değerle', () => {
    const d = dagilim([0, 10, 20, 30]);
    expect(d.c25).toBeCloseTo(7.5, 10);
    expect(d.c75).toBeCloseTo(22.5, 10);
  });

  it('NaN sayılmıyor, sayısı söyleniyor', () => {
    const d = dagilim([5, Number.NaN, 7, Number.POSITIVE_INFINITY]);
    expect(d.n).toBe(2);
    expect(d.olculemeyen).toBe(2);
    expect(d.medyan).toBe(6);
  });

  it('hiç sayı yoksa her şey NaN — uydurma yok', () => {
    const d = dagilim([Number.NaN]);
    expect(d.n).toBe(0);
    expect(Number.isNaN(d.medyan)).toBe(true);
    expect(Number.isNaN(d.min)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { KITAPLIK, ciktiDogrula, cikisDogrula, kaynakTara, ustveriDogrula } from './kullanici';

/**
 * Kullanıcı göstergesi sözleşmesi.
 *
 * Doğrulama kullanıcıya ALANI söylemeli: "geçersiz gösterge" diyen bir hata,
 * kodunda nerede yanlış yaptığını aramakla baş başa bırakır.
 */
describe('kullanıcı göstergesi — üstveri', () => {
  const temel = {
    ad: 'Benim Göstergem',
    kisa: 'BG',
    parametreler: [{ ad: 'uzunluk', etiket: 'Uzunluk', varsayilan: 20, min: 2, max: 400 }],
    hesapla: () => [],
  };

  it('geçerli tanımı kabul ediyor', () => {
    const r = ustveriDogrula(temel);
    expect(r.tamam).toBe(true);
    if (!r.tamam) return;
    expect(r.deger.kisa).toBe('BG');
    expect(r.deger.panel).toBe('fiyat');
    expect(r.deger.parametreler[0].varsayilan).toBe(20);
  });

  it('eksik hesapla fonksiyonunu ALANIYLA reddediyor', () => {
    const r = ustveriDogrula({ ...temel, hesapla: undefined });
    expect(r.tamam).toBe(false);
    if (r.tamam) return;
    expect(r.hata).toContain('hesapla');
  });

  it('aynı parametre adını iki kez kabul etmiyor', () => {
    const r = ustveriDogrula({
      ...temel,
      parametreler: [
        { ad: 'n', varsayilan: 2, min: 1, max: 9 },
        { ad: 'n', varsayilan: 3, min: 1, max: 9 },
      ],
    });
    expect(r.tamam).toBe(false);
    if (!r.tamam) expect(r.hata).toContain('iki kez');
  });

  it('aralık dışı varsayılanı reddediyor', () => {
    const r = ustveriDogrula({
      ...temel,
      parametreler: [{ ad: 'n', varsayilan: 999, min: 1, max: 10 }],
    });
    expect(r.tamam).toBe(false);
    if (!r.tamam) expect(r.hata).toContain('aralığında');
  });

  it('nesne olmayan girdiyi reddediyor', () => {
    for (const ham of [null, 42, 'metin', undefined]) {
      expect(ustveriDogrula(ham).tamam, String(ham)).toBe(false);
    }
  });
});

describe('kullanıcı göstergesi — çıktı', () => {
  it('bar sayısıyla hizalanmayan diziyi reddediyor', () => {
    // Kayık bir çizgi YANLIŞ bir çizgidir: sessizce kabul edilemez.
    const r = ciktiDogrula([new Float64Array(99)], 100, 1);
    expect(r.tamam).toBe(false);
    if (!r.tamam) expect(r.hata).toContain('uzunluğu');
  });

  it('seri sayısı tanımla uyuşmalı', () => {
    const r = ciktiDogrula([new Float64Array(10), new Float64Array(10)], 10, 1);
    expect(r.tamam).toBe(false);
    if (!r.tamam) expect(r.hata).toContain('1 seri bekleniyordu');
  });

  it('düz dizi de kabul ediliyor ve dönüştürülüyor', () => {
    const r = ciktiDogrula([[1, 2, 3]], 3, 1);
    expect(r.tamam).toBe(true);
    if (r.tamam) expect(r.deger[0]).toBeInstanceOf(Float64Array);
  });

  it('çıktı tanımı verilmezse tek çizgi varsayılıyor', () => {
    const r = cikisDogrula(undefined, 'BG');
    expect(r.tamam).toBe(true);
    if (r.tamam)
      expect(r.deger).toEqual([{ ad: 'deger', etiket: 'BG', tur: 'cizgi', token: 'accent' }]);
  });

  it('bilinmeyen renk tokenı reddediliyor', () => {
    const r = cikisDogrula([{ ad: 'x', token: 'mor' }], 'BG');
    expect(r.tamam).toBe(false);
    if (!r.tamam) expect(r.hata).toContain('token');
  });
});

describe('kullanıcı göstergesi — kaynak taraması', () => {
  it('import ve require kalıplarını reddediyor', () => {
    for (const k of ['import("x")', "import x from 'y'", 'require("fs")']) {
      const r = kaynakTara(`({ hesapla(){ ${k} } })`);
      expect(r.tamam, k).toBe(false);
    }
  });

  it('sıradan koda dokunmuyor', () => {
    const r = kaynakTara(
      '({ ad: "x", parametreler: [], hesapla: (c, p, lib) => [lib.ema(c.close, 5)] })',
    );
    expect(r.tamam).toBe(true);
  });

  it('aşırı uzun kaynağı reddediyor', () => {
    expect(kaynakTara('x'.repeat(20_001)).tamam).toBe(false);
  });
});

describe('kullanıcı kitaplığı', () => {
  it('uygulamanın kendi fonksiyonlarını veriyor', () => {
    // Kullanıcının göstergesi ile barındırılan gösterge AYNI hesabı
    // paylaşmalı; ayrı bir kopya iki farklı sayı üretirdi.
    const kapanis = Float64Array.from({ length: 50 }, (_, i) => 100 + i);
    expect([...KITAPLIK.ema(kapanis, 10)]).toEqual([...KITAPLIK.ema(kapanis, 10)]);
    expect(KITAPLIK.sma(kapanis, 10)[49]).toBeCloseTo(144.5, 10);
    expect(Object.keys(KITAPLIK).length).toBeGreaterThan(15);
  });
});

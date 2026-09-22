import { describe, expect, it } from 'vitest';
import { emptyCandles, type Candles } from '../core/data/types';
import { gostergeCalistir, gostergeDerle, gostergeTopluCalistir } from './gostergeCalistir';

function seri(n: number): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    c.time[i] = 86_400 * (i + 1);
    c.open[i] = 100 + i;
    c.high[i] = 101 + i;
    c.low[i] = 99 + i;
    c.close[i] = 100 + i;
    c.volume[i] = 1000;
  }
  return c;
}

const BASIT = `({
  ad: 'Benim Ortalamam',
  kisa: 'BO',
  panel: 'fiyat',
  parametreler: [{ ad: 'uzunluk', etiket: 'Uzunluk', varsayilan: 10, min: 2, max: 200 }],
  ciktilar: (p) => [{ ad: 'o', etiket: 'BO ' + p.uzunluk, tur: 'cizgi', token: 'accent' }],
  hesapla: (c, p, lib) => [lib.sma(c.close, p.uzunluk)],
})`;

describe('kullanıcı göstergesi çalıştırma', () => {
  it('basit bir gösterge çalışıyor ve kitaplığı kullanıyor', () => {
    const c = seri(60);
    const r = gostergeCalistir(BASIT, c, { uzunluk: 10 });
    expect(r.tamam).toBe(true);
    if (!r.tamam) return;
    expect(r.deger.ustveri.ad).toBe('Benim Ortalamam');
    expect(r.deger.ciktilar[0].etiket).toBe('BO 10');
    expect(r.deger.degerler[0].length).toBe(60);
    // SMA(10) son bar: (150+...+159)/10 = 154,5
    expect(r.deger.degerler[0][59]).toBeCloseTo(154.5, 10);
  });

  it('parametre ŞEMAYA göre sınırlanıyor', () => {
    const c = seri(60);
    const r = gostergeCalistir(BASIT, c, { uzunluk: 0 });
    expect(r.tamam).toBe(true);
    if (!r.tamam) return;
    // 0 değil 2 (şemadaki min) kullanılmalı.
    expect(r.deger.ciktilar[0].etiket).toBe('BO 2');
  });

  /**
   * YALITIM.
   *
   * Kod tehlikeli adları GÖLGELEYEN bir kapsamda koşuyor. Bunlar gerçek bir
   * güvenlik sınırının yalnızca bir katmanı — ama katmanın çalıştığı
   * sınanabilir ve sınanmalı.
   */
  it('küresel nesnelere ulaşamıyor', () => {
    const c = seri(30);
    // `eval` listede YOK: katı kipte parametre adı olamıyor (bkz. kaynaktaki
    // gerekçe). Onun karşılığı ortam katmanında.
    for (const ad of ['self', 'globalThis', 'fetch', 'XMLHttpRequest', 'postMessage']) {
      const kaynak = `({
        ad: 'x', kisa: 'x', parametreler: [],
        hesapla: (c) => { if (${ad} !== undefined) throw new Error('ERİŞİLDİ: ${ad}');
          return [new Float64Array(c.length)]; },
      })`;
      const r = gostergeCalistir(kaynak, c, {});
      expect(r.tamam, `${ad}: ${r.tamam ? '' : r.hata}`).toBe(true);
    }
  });

  it('import ile ağa çıkmaya çalışan kod reddediliyor', () => {
    const r = gostergeCalistir(
      `({ ad: 'x', kisa: 'x', parametreler: [], hesapla: () => { import('https://x/y.js'); } })`,
      seri(10),
      {},
    );
    expect(r.tamam).toBe(false);
    if (!r.tamam) expect(r.hata).toContain('import()');
  });

  it('hesapla içindeki hata ALANIYLA bildiriliyor', () => {
    const r = gostergeCalistir(
      `({ ad: 'x', kisa: 'x', parametreler: [], hesapla: () => { throw new Error('patladım'); } })`,
      seri(10),
      {},
    );
    expect(r.tamam).toBe(false);
    if (!r.tamam) {
      expect(r.hata).toContain('hesapla()');
      expect(r.hata).toContain('patladım');
    }
  });

  it('sözdizimi hatası anlaşılır şekilde bildiriliyor', () => {
    const r = gostergeCalistir('({ ad: ', seri(10), {});
    expect(r.tamam).toBe(false);
    if (!r.tamam) expect(r.hata).toContain('Kod çalıştırılamadı');
  });

  it('yanlış uzunlukta çıktı reddediliyor', () => {
    const r = gostergeCalistir(
      `({ ad: 'x', kisa: 'x', parametreler: [], hesapla: () => [new Float64Array(3)] })`,
      seri(10),
      {},
    );
    expect(r.tamam).toBe(false);
    if (!r.tamam) expect(r.hata).toContain('bar sayısı 10');
  });

  it('çağrılar arasında durum taşınmıyor', () => {
    // Kaynak her çağrıda yeniden değerlendiriliyor: sayaç hep 1 olmalı.
    const kaynak = `(() => {
      let sayac = 0;
      return {
        ad: 'x', kisa: 'x', parametreler: [],
        ciktilar: () => [{ ad: 'a', etiket: 'sayac ' + (++sayac), tur: 'cizgi', token: 'accent' }],
        hesapla: (c) => [new Float64Array(c.length)],
      };
    })()`;
    const c = seri(10);
    expect(
      (gostergeCalistir(kaynak, c, {}) as { deger: { ciktilar: { etiket: string }[] } }).deger
        .ciktilar[0].etiket,
    ).toBe('sayac 1');
    expect(
      (gostergeCalistir(kaynak, c, {}) as { deger: { ciktilar: { etiket: string }[] } }).deger
        .ciktilar[0].etiket,
    ).toBe('sayac 1');
  });
});

describe('toplu koşturma — bir derleme, çok sembol', () => {
  const seriler = (): Array<readonly [string, Candles]> => [
    ['A', seri(60)],
    ['B', seri(120)],
    ['C', seri(30)],
  ];

  it('her sembol için SON BAR değerini veriyor, tek sembol yoluyla aynı', () => {
    const toplu = gostergeTopluCalistir(BASIT, seriler(), {});
    expect(toplu.tamam).toBe(true);
    if (!toplu.tamam) return;
    expect(toplu.deger.sayi).toBe(3);
    for (const [ad, c] of seriler()) {
      const tek = gostergeCalistir(BASIT, c, {});
      expect(tek.tamam).toBe(true);
      if (!tek.tamam) return;
      const beklenen = tek.deger.degerler.map((d) => d[d.length - 1]);
      expect(toplu.deger.degerler[ad]).toEqual(beklenen);
    }
  });

  it('bir sembolde patlayan kod ötekileri DÜŞÜRMÜYOR; hata sembole yazılıyor', () => {
    // Kullanıcı kodu kısa seride dizi sınırını aşabilir; geri kalan sonuçları
    // atmak yanlış olurdu. O sembol NaN + hata, ötekiler sayı.
    const PATLAK = `({
      ad: 'Patlak', kisa: 'PT', parametreler: [],
      hesapla(c) {
        if (c.length < 50) throw new Error('kısa seri');
        const out = new Float64Array(c.length).fill(1);
        return [out];
      },
    })`;
    const r = gostergeTopluCalistir(PATLAK, seriler(), {});
    expect(r.tamam).toBe(true);
    if (!r.tamam) return;
    expect(r.deger.degerler.A).toEqual([1]);
    expect(r.deger.degerler.B).toEqual([1]);
    expect(Number.isNaN(r.deger.degerler.C[0])).toBe(true);
    expect(r.deger.hatalar.C).toMatch(/kısa seri/);
    expect(Object.keys(r.deger.hatalar)).toEqual(['C']);
  });

  it('DERLEME hatası tümünü düşürüyor — kod çalışmıyorsa hiçbir sembol için sonuç yok', () => {
    const r = gostergeTopluCalistir('({ bu bir nesne değil', seriler(), {});
    expect(r.tamam).toBe(false);
  });

  it('kesici verilirse her seri önce kesiliyor (zaman makinesi)', () => {
    // Kesim: ilk 10 bar. Son bar değeri kesik serinin son barından gelmeli.
    const kes = (c: Candles): Candles => ({
      time: c.time.subarray(0, 10),
      open: c.open.subarray(0, 10),
      high: c.high.subarray(0, 10),
      low: c.low.subarray(0, 10),
      close: c.close.subarray(0, 10),
      volume: c.volume.subarray(0, 10),
      length: 10,
    });
    const KAPANIS = `({ ad: 'K', kisa: 'K', parametreler: [], hesapla(c) { return [c.close]; } })`;
    const r = gostergeTopluCalistir(KAPANIS, seriler(), {}, kes);
    expect(r.tamam).toBe(true);
    if (!r.tamam) return;
    const a = seri(60);
    expect(r.deger.degerler.A[0]).toBe(a.close[9]);
  });

  it('kesim sonrası boş kalan seri NaN — sayı uydurmuyor', () => {
    const bos = (): Candles => ({
      time: new Float64Array(0),
      open: new Float64Array(0),
      high: new Float64Array(0),
      low: new Float64Array(0),
      close: new Float64Array(0),
      volume: new Float64Array(0),
      length: 0,
    });
    const r = gostergeTopluCalistir(BASIT, seriler(), {}, () => bos());
    expect(r.tamam).toBe(true);
    if (!r.tamam) return;
    for (const ad of ['A', 'B', 'C']) expect(r.deger.degerler[ad].every(Number.isNaN)).toBe(true);
    expect(Object.keys(r.deger.hatalar)).toEqual([]);
  });

  it('derleme bir kez: derli nesne yeniden kullanılabiliyor', () => {
    const d = gostergeDerle(BASIT);
    expect(d.tamam).toBe(true);
    if (!d.tamam) return;
    expect(d.deger.ustveri.kisa).toBeTruthy();
    expect(typeof d.deger.nesne.hesapla).toBe('function');
  });
});

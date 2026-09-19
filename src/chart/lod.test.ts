import { describe, expect, it } from 'vitest';
import { LodController } from './lod';
import { emptyCandles, type Candles } from '../core/data/types';

/**
 * Gizli seriler seyreltilmiyor — doğru bir optimizasyon ama tek başına bir
 * kusur üretiyordu: anahtar açılınca seri "görünür" oluyor, oysa gizliyken
 * hiçbir çizimde veri ALMAMIŞ olduğu için çizilecek bir şeyi yok.
 *
 * Ölçüldü: EMA 200 anahtarı açıkken grafikte hiç görünmüyordu; renk, veri ve
 * seri doğruydu, eksik olan yalnızca `setData` çağrısıydı.
 */

function seri(görünür: boolean) {
  const cagrilar: unknown[][] = [];
  const opts = { visible: görünür };
  return {
    cagrilar,
    api: {
      setData: (d: unknown[]) => cagrilar.push(d),
      options: () => opts,
      applyOptions: (o: { visible?: boolean }) => {
        if (o.visible !== undefined) opts.visible = o.visible;
      },
    },
  };
}

// Grafik kütüphanesinin yalnızca LOD'un DOKUNDUĞU yüzeyi; gerçek canvas
// gerekmiyor çünkü sınanan şey hangi seriye setData çağrıldığı.
const zamanEkseni = {
  getVisibleLogicalRange: () => null,
  setVisibleLogicalRange: () => {},
  setVisibleRange: () => {},
  scrollToPosition: () => {},
  applyOptions: () => {},
  subscribeVisibleLogicalRangeChange: () => {},
  unsubscribeVisibleLogicalRangeChange: () => {},
};
const sahteGrafik = { timeScale: () => zamanEkseni, applyOptions: () => {} };

function mumlar(n: number): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    c.time[i] = 86_400 * (i + 1);
    c.open[i] = 10 + i * 0.1;
    c.high[i] = 11 + i * 0.1;
    c.low[i] = 9 + i * 0.1;
    c.close[i] = 10.5 + i * 0.1;
    c.volume[i] = 1000;
  }
  return c;
}

describe('Lod — görünürlüğü açılan seri', () => {
  it('gizli seriye veri yazılmaz (optimizasyon korunuyor)', () => {
    const acik = seri(true);
    const gizli = seri(false);
    const lod = new LodController(
      sahteGrafik as never,
      seri(true).api as never,
      seri(true).api as never,
      [
        { series: acik.api as never, kind: 'line' },
        { series: gizli.api as never, kind: 'line' },
      ],
    );
    const n = 300;
    lod.setData(mumlar(n), [new Float64Array(n).fill(1), new Float64Array(n).fill(2)]);

    expect(acik.cagrilar.length).toBeGreaterThan(0);
    expect(gizli.cagrilar.length).toBe(0);
  });

  // Asıl kusur: görünür yapmak TEK BAŞINA yetmiyor.
  it('görünür yapılınca veri yazılır', () => {
    const gizli = seri(false);
    const lod = new LodController(sahteGrafik as never, seri(true).api as never, seri(true).api as never, [
      { series: gizli.api as never, kind: 'line' },
    ]);
    const n = 300;
    lod.setData(mumlar(n), [new Float64Array(n).fill(2)]);
    expect(gizli.cagrilar.length).toBe(0);

    gizli.api.applyOptions({ visible: true });
    lod.refreshExtras();

    expect(gizli.cagrilar.length).toBe(1);
    expect((gizli.cagrilar[0] as unknown[]).length).toBeGreaterThan(0);
  });

  it('veri gelmeden refreshExtras çağrılırsa sessizce geçer', () => {
    const s = seri(true);
    const lod = new LodController(sahteGrafik as never, seri(true).api as never, seri(true).api as never, [
      { series: s.api as never, kind: 'line' },
    ]);
    expect(() => lod.refreshExtras()).not.toThrow();
    expect(s.cagrilar.length).toBe(0);
  });
});

/**
 * Hisse değişiminde grafikte KONUM ve GENİŞLİK korunmuyordu.
 *
 * Ölçüldü (gerçek BIST verisiyle, tarayıcıdan hisse değiştirerek):
 *   THYAO  3650 bar  görünür 2026-07-02 → 2026-08-18  genişlik 30.6 bar
 *   A1CAP   817 bar  görünür 2026-03-26 → 2026-09-18  genişlik 119.0 bar
 *   GARAN  3650 bar  görünür 2026-03-26 → 2026-09-18  genişlik 119.0 bar
 * 119 bar, "sığdır" dalının son 120 mumu çerçevelemesi — yani görünüm hiç
 * korunmuyordu. İki ayrı kusur vardı:
 *   1) Görünüm bar İNDİSİNE çıpalanıyordu; bar sayıları semboller arasında
 *      farklı olduğu için aynı indis bambaşka bir tarihe denk geliyor.
 *   2) Sembol değişince yükleme ekranı grafiği tamamen söküyor, denetleyici
 *      yok oluyor — korunacak canlı bir görünüm kalmıyor.
 */
function eksen() {
  let lr: { from: number; to: number } | null = null;
  const yazilan: { from: number; to: number }[] = [];
  return {
    ayarla(r: { from: number; to: number }) {
      lr = r;
    },
    yazilan,
    api: {
      getVisibleLogicalRange: () => lr,
      setVisibleLogicalRange: (r: { from: number; to: number }) => {
        lr = r;
        yazilan.push(r);
      },
      setVisibleRange: () => {},
      scrollToPosition: () => {},
      applyOptions: () => {},
      subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {},
    },
  };
}

function grafikli(e: ReturnType<typeof eksen>) {
  return { timeScale: () => e.api, applyOptions: () => {} };
}

/** `son` gününde biten n barlık günlük seri (gerçek hayatta olduğu gibi:
 *  farklı uzunluktaki semboller AYNI son işlem gününde biter). */
function seriSon(n: number, son: number): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    const g = son - (n - 1 - i);
    c.time[i] = 86_400 * g;
    c.open[i] = 10;
    c.high[i] = 11;
    c.low[i] = 9;
    c.close[i] = 10.5;
    c.volume[i] = 1000;
  }
  return c;
}

function kur(e: ReturnType<typeof eksen>) {
  return new LodController(grafikli(e) as never, seri(true).api as never, seri(true).api as never, []);
}

describe('Lod — sembol değişiminde görünüm', () => {
  it('kısa geçmişli sembole geçince TARİH aralığı korunur', () => {
    const e = eksen();
    const lod = kur(e);
    lod.setData(seriSon(3650, 3650), []);
    // Kullanıcı son ~30 bara yakınlaştırdı (pencere 3250..3650, adım 1).
    e.ayarla({ from: 370, to: 400 });
    const once = lod.gorunumOku();
    expect(once).not.toBeNull();

    lod.setData(seriSon(817, 3650), [], false);

    const sonra = lod.gorunumOku();
    expect(sonra?.t0).toBe(once?.t0);
    expect(sonra?.t1).toBe(once?.t1);
    expect(sonra?.bar).toBeCloseTo(once?.bar ?? 0, 6);
  });

  it('uzun geçmişli sembole geri dönünce de korunur', () => {
    const e = eksen();
    const lod = kur(e);
    lod.setData(seriSon(3650, 3650), []);
    e.ayarla({ from: 370, to: 400 });
    const once = lod.gorunumOku();

    lod.setData(seriSon(817, 3650), [], false);
    lod.setData(seriSon(3650, 3650), [], false);

    const sonra = lod.gorunumOku();
    expect(sonra?.t0).toBe(once?.t0);
    expect(sonra?.t1).toBe(once?.t1);
  });

  it('tarihler yeni sembolde hiç yoksa en azından yakınlaştırma korunur', () => {
    const e = eksen();
    const lod = kur(e);
    lod.setData(seriSon(3650, 3650), []);
    e.ayarla({ from: 370, to: 400 });
    const once = lod.gorunumOku();

    // 2015'e bakarken 2024'te halka arz olmuş bir sembole geçmek gibi:
    // ortak tarih yok. Sığdırma (son 120 mum) DEĞİL, aynı zoom beklenir.
    lod.setData(seriSon(100, 500), [], false);

    const sonra = lod.gorunumOku();
    expect(sonra?.bar).toBeCloseTo(once?.bar ?? 0, 6);
  });

  it('grafik yeniden kurulsa da tohumlanan görünüm uygulanır', () => {
    const e1 = eksen();
    const eski = kur(e1);
    eski.setData(seriSon(3650, 3650), []);
    e1.ayarla({ from: 370, to: 400 });
    const tasinan = eski.gorunumOku();
    expect(tasinan).not.toBeNull();

    // Bileşen söküldü: yeni grafik, yeni denetleyici, canlı görünüm YOK.
    const e2 = eksen();
    const yeni = kur(e2);
    yeni.gorunumYaz(tasinan!);
    yeni.setData(seriSon(817, 3650), [], false);

    const sonra = yeni.gorunumOku();
    expect(sonra?.t0).toBe(tasinan?.t0);
    expect(sonra?.t1).toBe(tasinan?.t1);
  });

  it('sığdır istenince görünüm korunmaz (periyot değişimi doğru davranış)', () => {
    const e = eksen();
    const lod = kur(e);
    lod.setData(seriSon(3650, 3650), []);
    e.ayarla({ from: 370, to: 400 });
    const once = lod.gorunumOku();

    lod.setData(seriSon(3650, 3650), [], true);

    // fit dalı setVisibleRange kullanır; mantıksal aralığa dokunulmaz.
    expect(e.yazilan.length).toBe(0);
    expect(once?.bar).toBeCloseTo(30, 6);
  });
});

/**
 * İndis çıpası ile tarih çıpası, yalnızca iki sembolün takvimi BİREBİR aynıysa
 * aynı sonucu verir. Gerçekte vermiyor: işlem durdurma ve tatiller yüzünden
 * kısa geçmişli semboller seyrek takvimli oluyor. Bu sınama tam o farkı tutar —
 * sağ kenardan sayılan bar mesafesi burada bambaşka bir tarihe düşer.
 */
function seyrek(n: number, son: number, atlaHer: number): Candles {
  const gunler: number[] = [];
  for (let g = son; gunler.length < n; g--) {
    if (g % atlaHer !== 0) gunler.push(g);
  }
  gunler.reverse();
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    c.time[i] = 86_400 * gunler[i];
    c.open[i] = 10;
    c.high[i] = 11;
    c.low[i] = 9;
    c.close[i] = 10.5;
    c.volume[i] = 1000;
  }
  return c;
}

describe('Lod — seyrek takvimli sembol', () => {
  it('geçmişin ortasına bakarken tarih korunur, indis mesafesi değil', () => {
    const e = eksen();
    const lod = kur(e);
    lod.setData(seriSon(3650, 3650), []);
    // Pencere 3250..3650; geçmişin ortasına değil ama sağ kenardan UZAĞA bak.
    e.ayarla({ from: 50, to: 150 }); // gerçek 3300..3400
    const once = lod.gorunumOku();
    expect(once).not.toBeNull();

    lod.setData(seyrek(800, 3650, 3), [], false);

    const sonra = lod.gorunumOku();
    expect(sonra?.t0).toBeCloseTo(once?.t0 ?? 0, 3);
    expect(sonra?.t1).toBeCloseTo(once?.t1 ?? 0, 3);
    // Aynı tarih aralığı, ama seyrek takvimde daha AZ bar: doğru olan bu.
    expect(sonra?.bar).toBeLessThan(once?.bar ?? 0);

    // Eski davranış sağ kenardan SABİT bar mesafesi sayıyordu (gapReal = 250);
    // seyrek takvimde o indis başka bir tarihe düşer — kusurun ta kendisi.
    const eskiSag = seyrek(800, 3650, 3).time[800 - 250];
    expect(eskiSag).not.toBeCloseTo(once?.t1 ?? 0, 3);
  });
});

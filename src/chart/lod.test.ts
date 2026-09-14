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

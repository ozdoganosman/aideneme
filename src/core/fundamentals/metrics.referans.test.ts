/**
 * REFERANS UYGULAMA SINAMASI — `percentileRank` hızlandırıldı, SONUÇ DEĞİŞMEDİ.
 *
 * Eski uygulama evreni her çağrıda iki kez süzüyordu; yenisi ölçeği bir kez
 * kurup ikili aramayla sorguluyor. Kritik nokta EŞİT DEĞERLER: "kesinlikle
 * küçük" ile "küçük veya eşit" sınırları karıştırılırsa sayı sessizce kayar.
 * Bu yüzden eski uygulama burada referans olarak duruyor ve karşılaştırma
 * `Object.is` ile, yani yaklaşık değil TAM eşitlik.
 */
import { expect, test } from 'vitest';
import { percentileRank } from './metrics';

function eskiPercentileRank(
  values: (number | null)[],
  value: number | null,
  lowerIsBetter = false,
): number | null {
  if (value === null) return null;
  const clean = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (clean.length < 5) return null;
  const below = clean.filter((v) => (lowerIsBetter ? v > value : v < value)).length;
  return (below / clean.length) * 100;
}

test('yeni percentileRank eskisiyle BİT DÜZEYİNDE özdeş', () => {
  // Tohumlu, tekrarlanabilir üreteç.
  let tohum = 12345;
  const rnd = () => (tohum = (tohum * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const farkli: string[] = [];
  for (let deneme = 0; deneme < 60; deneme++) {
    const n = 1 + Math.floor(rnd() * 40);
    const evren: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      const r = rnd();
      // Bilerek: null, NaN, Infinity ve ÇOK SAYIDA TEKRAR EDEN değer.
      if (r < 0.12) evren.push(null);
      else if (r < 0.18) evren.push(NaN);
      else if (r < 0.21) evren.push(Infinity);
      else evren.push(Math.floor(rnd() * 8)); // dar aralık → bol eşitlik
    }
    const adaylar = [...evren, null, 0, 7, 3.5, -1, 100];
    for (const v of adaylar) {
      for (const lib of [false, true]) {
        const a = eskiPercentileRank(evren, v as number | null, lib);
        const b = percentileRank(evren, v as number | null, lib);
        if (!Object.is(a, b)) farkli.push(`n=${n} v=${v} lib=${lib}: ${a} ≠ ${b}`);
      }
    }
  }
  expect(farkli.slice(0, 5)).toEqual([]);
});

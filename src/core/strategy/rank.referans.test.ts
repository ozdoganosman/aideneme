/**
 * REFERANS UYGULAMA SINAMASI — `signTest` hızlandırıldı, SONUÇ DEĞİŞMEDİ.
 *
 * `signTest` eskiden kuyruk döngüsünün İÇİNDEN `logFactorial`i çağırıyordu;
 * biri döngü değişmezi olan üç argümanla, üstelik `logFactorial` kendisi
 * O(n) idi. Toplam maliyet O(deneme²). Ön toplam tablosuyla O(deneme)'ye indi.
 *
 * Bir hız düzeltmesinin bedeli SESSİZ bir sayı kayması olabilir, o yüzden eski
 * uygulama burada referans olarak duruyor ve iki sonuç `Object.is` ile
 * karşılaştırılıyor — yaklaşık değil, BİT DÜZEYİNDE eşitlik. Tablo aynı toplamı
 * aynı sırayla biriktirdiği için bu tutmalı; tutmazsa yapılan şey bir
 * hızlandırma değil bir YAKLAŞIMDIR ve öyle anılmalıdır.
 */
import { expect, test } from 'vitest';
import { signTest } from './rank';

// ESKİ uygulama, birebir.
function eskiLogFactorial(n: number): number {
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 2; i <= n; i++) sum += Math.log(i);
  return sum;
}
function eskiSignTest(successes: number, trials: number): number {
  if (trials <= 0) return NaN;
  const k = Math.min(successes, trials - successes);
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    const logP =
      eskiLogFactorial(trials) -
      eskiLogFactorial(i) -
      eskiLogFactorial(trials - i) +
      trials * Math.log(0.5);
    tail += Math.exp(logP);
  }
  return Math.min(1, 2 * tail);
}

test('yeni signTest eskisiyle BİT DÜZEYİNDE özdeş', () => {
  const farkli: string[] = [];
  for (let trials = 1; trials <= 300; trials++) {
    for (const s of [0, 1, 2, Math.floor(trials / 3), Math.floor(trials / 2), trials - 1, trials]) {
      if (s < 0 || s > trials) continue;
      const a = eskiSignTest(s, trials);
      const b = signTest(s, trials);
      if (!Object.is(a, b)) farkli.push(`${s}/${trials}: ${a} ≠ ${b}`);
    }
  }
  expect(farkli.slice(0, 5)).toEqual([]);
});

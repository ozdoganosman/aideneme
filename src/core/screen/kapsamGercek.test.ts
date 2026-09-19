import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { FUNDAMENTAL_METRIC_DEFS, withFundamentals } from './fundamentalMetrics';
import type { ScreenRow } from './metrics';

/**
 * ÖLÜ FİLTRE BEKÇİSİ — yayındaki GERÇEK veride koşar.
 *
 * Neden gerekli: birim testler sentetik veriyle koşuyor ve orada her ölçüt
 * hesaplanıyor. Gerçek veride ise bir ölçüt sessizce ÖLEBİLİR — üretici
 * tarafında bir kalem adı değişir, alan boş gelir, filtre hiçbir sonuç
 * döndürmez ve kullanıcı "kriterlere uyan yok" sanır. Bu tam olarak yaşandı:
 * "Cari oran" hangi eşikte olursa olsun sıfır sonuç veriyordu, çünkü
 * `currentAssets` 559 sembolün HİÇBİRİNDE yoktu.
 *
 * Ölçüt: tablosu olan sembollerin en az %40'ında hesaplanabilmeli. Eşik
 * bilerek düşük — amaç dalgalanmayı kovalamak değil, ÖLÜ filtreyi yakalamak.
 *
 * İki ölçüt yapısal olarak daha dar ve bu bir kusur değil, ölçüldü:
 * - `pe` / `pePercentile`: 559 şirketin 259'u TTM bazında ZARARDA; zararda
 *   F/K anlamsızdır. Pozitif kârlı 300 şirketin 295'inde hesaplanıyor.
 * - `netIncomeGrowth`: taban yılı net kârı negatifse yüzde değişim yalan
 *   söyler, o yüzden üretilmiyor.
 *
 * Veri yoksa ATLANIR: bu ortamda yayın verisi her zaman yok. `GERCEK_VERI`
 * bir dizin gösterirse (gh-pages klonu) ölçüm çalışır.
 */

const KOK = process.env.GERCEK_VERI;
const TABAN_ORAN = 0.4;

type Snapshot = { symbols: Record<string, unknown> };

describe.skipIf(!KOK)('gerçek veride ölü filtre yok', () => {
  test('her temel ölçüt, tablosu olan sembollerin anlamlı bir kısmında hesaplanıyor', () => {
    const oku = (p: string) => JSON.parse(readFileSync(join(KOK!, p), 'utf-8'));
    const tara = oku('bist/screener.json');
    const snapshot = oku('bist/fundamentals/snapshot.json') as Snapshot;
    const hepsi = existsSync(join(KOK!, 'bist/fundamentals/hepsi.json'))
      ? oku('bist/fundamentals/hepsi.json')
      : { symbols: {} };

    const rows = tara.items.map((i: Record<string, unknown>) => ({
      symbol: i.s as string,
      name: i.n as string,
      values: { last: i.p as number },
    })) as unknown as ScreenRow[];

    const sonuc = withFundamentals(rows, {
      snapshot: snapshot as never,
      financialsOf: (s: string) => hepsi.symbols?.[s],
    });

    // Payda: FİYATI VE TABLOSU olan semboller. Endeks ve fonlar paydaya
    // girmemeli — onların bilançosu eksik değil, hiç yok.
    const tablolu = sonuc.filter(
      (r) => snapshot.symbols[r.symbol] && Number.isFinite(r.values.last),
    );
    expect(
      tablolu.length,
      'tablosu olan sembol bulunamadı — veri yolu yanlış olabilir',
    ).toBeGreaterThan(50);

    const olu: string[] = [];
    for (const def of FUNDAMENTAL_METRIC_DEFS) {
      const dolu = tablolu.filter((r) =>
        Number.isFinite((r.values as Record<string, number>)[def.id]),
      ).length;
      const oran = dolu / tablolu.length;
      if (oran < TABAN_ORAN)
        olu.push(`${def.id} %${(oran * 100).toFixed(1)} (${dolu}/${tablolu.length})`);
    }
    expect(olu, `ölü ya da ölmek üzere filtre: ${olu.join(' · ')}`).toEqual([]);
  });
});

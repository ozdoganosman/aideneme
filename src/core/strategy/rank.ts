import type { BacktestMetrics } from '../backtest/metrics';
import type { StrategyPreset } from './presets';

/**
 * Piyasa geneli strateji sıralaması.
 *
 * Referans projede bu tablo var ama şu üç sorusu yok: (1) sonuçlar maliyetli mi,
 * (2) al-tut ile karşılaştırıldı mı, (3) onlarca kombinasyon denendiğinde en
 * iyisinin şans eseri çıkma olasılığı ne? Burada üçü de tabloda:
 *
 *   - Backtest motoru maliyeti zaten uyguluyor; al-tut da AYNI maliyeti ödüyor.
 *   - Her satır, sembol başına "al-tut üzerine kattığı yıllık fark"ın medyanı.
 *   - "Kaç sembolde al-tut'u yendi?" bir İŞARET TESTİ ile sınanıyor ve p-değeri
 *     denenen strateji sayısına göre Holm yöntemiyle düzeltiliyor.
 *
 * Kritik uyarı koda gömülü: semboller birbirinden bağımsız değildir (hepsi aynı
 * piyasada). İşaret testi bağımsızlık varsayar, dolayısıyla p-değeri
 * **iyimserdir**; `independenceCaveat` bunu her satırda taşır.
 */

export interface SymbolResult {
  symbol: string;
  metrics: BacktestMetrics;
}

export interface RankRow {
  id: string;
  name: string;
  detail: string;
  premise: string;
  /** Denenen sembol sayısı. */
  symbols: number;
  /** En az bir işlem üreten sembol sayısı — sinyal üretmeyen strateji "kaybetmez". */
  withTrades: number;
  medianCagrPct: number;
  /** Al-tut üzerine katılan yıllık fark (puan) — medyan. */
  medianExcessPct: number;
  medianMaxDDPct: number;
  medianSharpe: number;
  medianTrades: number;
  medianExposurePct: number;
  /** Al-tut'u yenen sembollerin oranı (%). */
  beatPct: number;
  /** İşaret testi p-değeri (iki yönlü, tam binom). */
  pValue: number;
  /** Holm–Bonferroni ile çoklu test düzeltmesi uygulanmış p-değeri. */
  adjustedP: number;
  /**
   * 'ölçülemedi' — ısınma pencereye sığmadı, backtest hiç koşmadı.
   * 'sinyal yok' — koştu ama kural hiçbir sembolde tetiklenmedi.
   * İkisi farklı şeydir ve ikisi de "kaybetti" DEĞİLDİR.
   */
  verdict: 'anlamlı' | 'belirsiz' | 'zayıf' | 'ölçülemedi' | 'sinyal yok';
  /** Bu stratejinin en çok fark yarattığı semboller. */
  best: { symbol: string; excessPct: number; cagrPct: number; trades: number }[];
  /**
   * Sembol başına al-tut farkının SIRALI dağılımı (küçükten büyüğe, puan).
   *
   * Medyan tek sayıdır ve yayılımı gizler: "medyan -%2,6" iki çok farklı
   * stratejiyi aynı gösterir — biri her sembolde tutarlı olarak biraz
   * kaybeder, öteki yarısında kazanıp yarısında çöker. İkisi arasındaki
   * fark, kuralı kullanıp kullanmama kararının kendisidir.
   *
   * Sıralı tutuluyor çünkü çizilecek şey dağılım; sembol kimliği bu
   * sütunun sorusu değil (o `best` içinde).
   */
  excessSpread: number[];
}

export interface RankOptions {
  /** İşlem üretmeyen sembolleri sayıma katma (varsayılan: katma). */
  requireTrades?: boolean;
  /** Anlamlılık eşiği. */
  alpha?: number;
  /** Satır başına listelenecek en iyi sembol sayısı. */
  topSymbols?: number;
}

export const INDEPENDENCE_CAVEAT =
  'Semboller bağımsız değildir (aynı piyasa, ortak hareket); işaret testi ' +
  'bağımsızlık varsayar, bu yüzden p-değeri gerçekte olduğundan İYİMSERDİR.';

export function median(values: number[]): number {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return NaN;
  const mid = clean.length >> 1;
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

/**
 * log(i!) ÖN TOPLAM TABLOSU, 0..n. Taşma olmasın diye log uzayında.
 *
 * Eskiden `logFactorial(n)` ayrı bir fonksiyondu ve her çağrıda 2'den n'e
 * kadar dönüyordu; `signTest` de onu KUYRUK DÖNGÜSÜNÜN İÇİNDEN, üstelik biri
 * döngü değişmezi olan üç ayrı argümanla çağırıyordu. Toplam maliyet
 * O(deneme²) çıkıyordu.
 *
 * Ölçüldü (6× kısma, gerçek veri, Stratejiler ekranı): `logFactorial` tek
 * başına örneklenen JS süresinin %5,8'i, 236 ms — listedeki ikinci sıranın
 * neredeyse iki katı ve en büyük tek kalem.
 *
 * Tablo aynı toplamı AYNI SIRAYLA biriktiriyor, yani değerler bit düzeyinde
 * özdeş; bu bir yaklaşım değişikliği değil, aynı hesabın bir kez yapılması.
 */
function logFactorialTable(n: number): Float64Array {
  const tablo = new Float64Array(n + 1);
  let sum = 0;
  for (let i = 2; i <= n; i++) {
    sum += Math.log(i);
    tablo[i] = sum;
  }
  return tablo;
}

/** İki yönlü tam binom işaret testi (p = 0.5). */
export function signTest(successes: number, trials: number): number {
  if (trials <= 0) return NaN;
  const k = Math.min(successes, trials - successes);
  const lf = logFactorialTable(trials);
  // Döngü değişmezleri döngüden ÇIKARILDI.
  const logYari = trials * Math.log(0.5);
  const lfDeneme = lf[trials];
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    tail += Math.exp(lfDeneme - lf[i] - lf[trials - i] + logYari);
  }
  return Math.min(1, 2 * tail);
}

/**
 * Holm–Bonferroni: p-değerleri küçükten büyüğe sıralanır, i. değer (m − i) ile
 * çarpılır ve monotonluk korunur. Bonferroni'den daha güçlü, aynı ölçüde
 * muhafazakâr değil — ama yine de tek testmiş gibi okumayı engeller.
 */
export function holmAdjust(pValues: number[]): number[] {
  const m = pValues.length;
  const order = pValues
    .map((p, i) => ({ p, i }))
    .filter((e) => Number.isFinite(e.p))
    .sort((a, b) => a.p - b.p);

  // Hesaplanamayan p-değeri NaN kalır: 1 yazmak "test edildi ve geçemedi"
  // demek olurdu; test hiç yapılamadı.
  const out = pValues.map(() => NaN);
  let running = 0;
  order.forEach((entry, rank) => {
    const adjusted = Math.min(1, entry.p * (m - rank));
    running = Math.max(running, adjusted);
    out[entry.i] = running;
  });
  return out;
}

export function rankStrategies(
  entries: { preset: StrategyPreset; results: SymbolResult[] }[],
  options: RankOptions = {},
): RankRow[] {
  const requireTrades = options.requireTrades ?? true;
  const alpha = options.alpha ?? 0.05;
  const topSymbols = options.topSymbols ?? 5;

  const partial = entries.map(({ preset, results }) => {
    const withTrades = results.filter((r) => r.metrics.trades > 0);
    const used = requireTrades ? withTrades : results;

    const excess = used.map((r) => r.metrics.excessCagrPct);
    const beats = excess.filter((v) => Number.isFinite(v) && v > 0).length;
    const decided = excess.filter((v) => Number.isFinite(v) && v !== 0).length;

    return {
      preset,
      symbols: results.length,
      withTrades: withTrades.length,
      medianCagrPct: median(used.map((r) => r.metrics.cagrPct)),
      medianExcessPct: median(excess),
      medianMaxDDPct: median(used.map((r) => r.metrics.maxDrawdownPct)),
      medianSharpe: median(used.map((r) => r.metrics.sharpe)),
      medianTrades: median(used.map((r) => r.metrics.trades)),
      medianExposurePct: median(used.map((r) => r.metrics.exposurePct)),
      beatPct: decided > 0 ? (beats / decided) * 100 : NaN,
      pValue: decided > 0 ? signTest(beats, decided) : NaN,
      excessSpread: excess.filter((v) => Number.isFinite(v)).sort((a, b) => a - b),
      best: [...used]
        .filter((r) => Number.isFinite(r.metrics.excessCagrPct))
        .sort((a, b) => b.metrics.excessCagrPct - a.metrics.excessCagrPct)
        .slice(0, topSymbols)
        .map((r) => ({
          symbol: r.symbol,
          excessPct: r.metrics.excessCagrPct,
          cagrPct: r.metrics.cagrPct,
          trades: r.metrics.trades,
        })),
    };
  });

  const adjusted = holmAdjust(partial.map((p) => p.pValue));

  return partial.map((row, i) => {
    const adjustedP = adjusted[i];
    const positive = Number.isFinite(row.medianExcessPct) && row.medianExcessPct > 0;
    // Hiç ölçüm yoksa hüküm "zayıf" DEĞİL "ölçülemedi": ölçülmemiş bir kuralı
    // kaybetmiş saymak, olmayan bir bilgiyi varmış gibi göstermektir.
    const measured = Number.isFinite(row.medianExcessPct);
    const verdict: RankRow['verdict'] = !measured
      ? row.symbols > 0 && row.withTrades === 0
        ? 'sinyal yok'
        : 'ölçülemedi'
      : Number.isFinite(adjustedP) && adjustedP < alpha && positive
        ? 'anlamlı'
        : positive
          ? 'belirsiz'
          : 'zayıf';

    return {
      id: row.preset.id,
      name: row.preset.name,
      detail: row.preset.detail,
      premise: row.preset.premise,
      symbols: row.symbols,
      withTrades: row.withTrades,
      medianCagrPct: row.medianCagrPct,
      medianExcessPct: row.medianExcessPct,
      medianMaxDDPct: row.medianMaxDDPct,
      medianSharpe: row.medianSharpe,
      medianTrades: row.medianTrades,
      medianExposurePct: row.medianExposurePct,
      beatPct: row.beatPct,
      pValue: row.pValue,
      adjustedP,
      verdict,
      best: row.best,
      excessSpread: row.excessSpread,
    };
  });
}

/**
 * Sıralamanın TEK CÜMLELİK cevabı.
 *
 * Tablo yirmi yedi satır, altı sütun ve iki farklı p-değeri gösteriyor.
 * "Hangi strateji gerçekten çalışıyor?" sorusunun cevabı bu tablodan
 * çıkarılabiliyor ama çıkarmak okuyucunun işine bırakılmıştı — oysa ekranın
 * başlığı tam olarak o soru.
 *
 * Özet HİÇBİR ŞEYİ YUMUŞATMIYOR: anlamlı sonuç yoksa bunu düz söylüyor.
 * Kazanan varmış gibi "en iyi strateji" diye bir satır göstermek, çoklu test
 * düzeltmesinin bütün amacını boşa çıkarırdı.
 */
export interface RankSummary {
  /** Düzeltilmiş p-değeriyle al-tut'u yenen strateji sayısı. */
  anlamli: number;
  /** Ölçülebilen (hüküm 'ölçülemedi'/'sinyal yok' olmayan) strateji sayısı. */
  olculen: number;
  /** Toplam strateji sayısı. */
  toplam: number;
  /** En yüksek al-tut farkına sahip ÖLÇÜLEBİLEN satır (varsa). */
  enIyi: RankRow | null;
  /** Anlamlı çıkanların en iyisi (varsa) — "kazanan" yalnızca budur. */
  enIyiAnlamli: RankRow | null;
}

export function summarizeRank(rows: RankRow[]): RankSummary {
  const olculebilir = rows.filter((r) => r.verdict !== 'ölçülemedi' && r.verdict !== 'sinyal yok');
  const anlamlilar = rows.filter((r) => r.verdict === 'anlamlı');
  const enBuyuk = (list: RankRow[]): RankRow | null =>
    list.length === 0
      ? null
      : list.reduce((a, b) => (b.medianExcessPct > a.medianExcessPct ? b : a));

  return {
    anlamli: anlamlilar.length,
    olculen: olculebilir.length,
    toplam: rows.length,
    enIyi: enBuyuk(olculebilir),
    enIyiAnlamli: enBuyuk(anlamlilar),
  };
}

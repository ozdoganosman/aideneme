import type { FieldId, Financials, SnapshotRow } from './types';

/**
 * Temel analiz hesapları.
 *
 * İki tuzak burada bilinçli olarak kapatılıyor:
 *
 * 1. **Kümülatif çeyrekler.** İş Yatırım'da 2024/9, yılın ilk DOKUZ AYIDIR.
 *    Bunu çeyrek sanıp toplamak geliri üçe katlar. TTM = geçen yıl sonu +
 *    bu yıl kümülatif − geçen yıl aynı kümülatif.
 * 2. **Tek başına çarpan.** F/K 8 ucuz mudur? Sektörüne ve büyümesine bağlı.
 *    Bu yüzden oranlar her zaman kesitsel yüzdelikle birlikte sunulur.
 */

/** Son 12 ay (TTM) — kümülatif dönem mantığıyla. */
export function ttm(periods: string[], values: (number | null)[], index: number): number | null {
  if (index < 0 || index >= periods.length) return null;
  const current = values[index];
  if (current === null || current === undefined) return null;

  const [year, month] = periods[index].split('/').map(Number);
  if (month === 12) return current;

  const at = (y: number, m: number): number | null => {
    const i = periods.indexOf(`${y}/${m}`);
    return i >= 0 ? (values[i] ?? null) : null;
  };

  const prevYearEnd = at(year - 1, 12);
  const prevSame = at(year - 1, month);
  if (prevYearEnd === null || prevSame === null) return null;
  return prevYearEnd + current - prevSame;
}

/** Yıl sonu (/12) dönemleri — grafiklerde yıllık seri. */
export function annualSeries(
  fin: Financials,
  field: FieldId,
): { labels: string[]; values: (number | null)[] } {
  const labels: string[] = [];
  const values: (number | null)[] = [];
  fin.periods.forEach((period, i) => {
    if (!period.endsWith('/12')) return;
    labels.push(period.split('/')[0]);
    values.push(fin.fields[field][i] ?? null);
  });
  return { labels, values };
}

/**
 * AKIŞ kalemleri: kaynak bunları YIL BAŞINDAN BUGÜNE kümülatif veriyor.
 *
 * Bilanço kalemleri (özkaynak, varlıklar, stok, nakit) kümülatif değil,
 * o anın fotoğrafı. İkisini aynı işlemden geçirmek sessizce yanlış sayı
 * üretir — nitekim TTM hesabında da ayrı ele alınıyorlar.
 */
const AKIS_KALEMLERI: ReadonlySet<string> = new Set([
  'revenue',
  'grossProfit',
  'operatingProfit',
  'netIncome',
  'operatingCashFlow',
  'capex',
]);

/**
 * Tablonun dönem ADIMI (ay): çeyreklik 3, altı aylık 6, yıllık 12.
 *
 * Kaynağı sabit "3 ay" saymak yanlış: örnek veride ASELS gibi şirketlerin
 * tablosu yalnızca /6 ve /12 satırlarından oluşuyor. Sabit adımla bu
 * tablolarda bir önceki dönem HİÇ bulunamıyor ve kolon grafiği tamamen boş
 * çiziliyordu — veri var, görünen yok.
 *
 * Adım, tabloda geçen en küçük ay: {3,6,9,12} → 3, {6,12} → 6, {12} → 12.
 * Yıllık yayımlayan bir tabloda adım 12'dir ve her satır kendi dönemidir.
 */
export function reportStep(periods: string[]): number {
  const aylar = periods
    .map((p) => Number(p.split('/')[1]))
    .filter((m) => Number.isFinite(m) && m > 0);
  return aylar.length === 0 ? 12 : Math.min(...aylar);
}

/**
 * Dönemsel seri — akış kalemlerinde kümülatif fark alınır.
 *
 * Kaynak "2026/6" satırında yılın İLK ALTI AYINI veriyor, ikinci çeyreği
 * değil. Kümülatif değerleri olduğu gibi kolon grafiğine çizmek her çubuğu
 * bir öncekini İÇEREN, sürekli büyüyen bir merdivene çevirir ve yılın son
 * dönemi her zaman en büyük görünür — mevsimsellik tamamen kaybolur.
 *
 * Yılın İLK dönemi (ay = adım) kümülatifin kendisidir; sonrakiler aynı yılın
 * bir önceki döneminden çıkarılır. O dönem yoksa değer ÜRETİLMEZ (null):
 * eksik veriyi sıfır saymak, olmayan bir çöküş gösterirdi.
 */
export function quarterlySeries(
  fin: Financials,
  field: FieldId,
  limit?: number,
): { labels: string[]; values: (number | null)[] } {
  const akis = AKIS_KALEMLERI.has(field);
  const adim = reportStep(fin.periods);
  const labels: string[] = [];
  const values: (number | null)[] = [];

  fin.periods.forEach((period, i) => {
    const [yil, ay] = period.split('/');
    const deger = fin.fields[field][i] ?? null;
    labels.push(`${yil}/${ay}`);

    if (!akis || Number(ay) === adim) {
      values.push(deger);
      return;
    }
    // Önceki dönem AYNI yılın bir öncesi olmalı; yıl atlarsa çıkarma anlamsız
    // olur (geçen yılın kümülatifinden bu yılınkini çıkarmak).
    const j = fin.periods.indexOf(`${yil}/${Number(ay) - adim}`);
    const onceki = j >= 0 ? (fin.fields[field][j] ?? null) : null;
    values.push(deger === null || onceki === null ? null : deger - onceki);
  });

  if (limit !== undefined && limit > 0 && labels.length > limit) {
    return { labels: labels.slice(-limit), values: values.slice(-limit) };
  }
  return { labels, values };
}

/** Son değeri olan (stok kalemi) — bilanço satırları için. */
export function latest(fin: Financials, field: FieldId): number | null {
  const values = fin.fields[field];
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null && values[i] !== undefined) return values[i];
  }
  return null;
}

export interface Ratios {
  /** Piyasa değeri (fiyat × pay sayısı). */
  marketCap: number | null;
  /** Fiyat/Kazanç. Zarar edende null (negatif F/K yanıltıcıdır). */
  pe: number | null;
  /** Piyasa Değeri / Defter Değeri. */
  pb: number | null;
  /** Fiyat / Satış. */
  ps: number | null;
  roePct: number | null;
  roaPct: number | null;
  netMarginPct: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  /** Net borç = kısa+uzun yükümlülük − nakit. */
  netDebt: number | null;
  /** Faaliyet nakit akışı / net kâr — kazancın nakde dönüşme oranı. */
  cashConversion: number | null;
}

export interface RatioInput {
  row: SnapshotRow;
  /** Son kapanış. */
  price: number;
  /**
   * Pay sayısı. Verilmezse ödenmiş sermaye kullanılır: BIST'te nominal değer
   * 1 TL olduğu için ödenmiş sermaye ≈ pay adedi. Bu bir YAKLAŞIMDIR ve
   * nominal değeri farklı şirketlerde sapar; UI bunu belirtir.
   */
  shares?: number;
}

const div = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a === null || a === undefined || b === null || b === undefined || b === 0 ? null : a / b;

export function computeRatios({ row, price, shares }: RatioInput): Ratios {
  const shareCount = shares ?? row.paidCapital ?? null;
  const marketCap = shareCount && price > 0 ? shareCount * price : null;

  const liabilities =
    row.currentLiabilities !== null && row.longLiabilities !== null
      ? row.currentLiabilities + row.longLiabilities
      : null;

  const netIncome = row.netIncomeTtm;

  return {
    marketCap,
    // Zarar eden şirkette F/K negatif çıkar ve "ucuz" gibi sıralanır — null.
    pe: netIncome !== null && netIncome > 0 ? div(marketCap, netIncome) : null,
    pb: row.equity !== null && row.equity > 0 ? div(marketCap, row.equity) : null,
    ps: row.revenueTtm !== null && row.revenueTtm > 0 ? div(marketCap, row.revenueTtm) : null,
    roePct: row.equity !== null && row.equity > 0 ? mulPct(div(netIncome, row.equity)) : null,
    roaPct: row.assets !== null && row.assets > 0 ? mulPct(div(netIncome, row.assets)) : null,
    netMarginPct: mulPct(div(netIncome, row.revenueTtm)),
    grossMarginPct: mulPct(div(row.grossProfitTtm, row.revenueTtm)),
    operatingMarginPct: mulPct(div(row.operatingProfitTtm, row.revenueTtm)),
    debtToEquity: row.equity !== null && row.equity > 0 ? div(liabilities, row.equity) : null,
    currentRatio: div(row.currentAssets, row.currentLiabilities),
    netDebt: liabilities !== null && row.cash !== null ? liabilities - row.cash : null,
    cashConversion:
      netIncome !== null && netIncome > 0 ? div(row.operatingCashFlowTtm, netIncome) : null,
  };
}

function mulPct(value: number | null): number | null {
  return value === null ? null : value * 100;
}

export interface Quality {
  /** Karşılanan ölçüt sayısı. */
  score: number;
  /** Değerlendirilebilen ölçüt sayısı (veri eksikse 9'dan küçük olur). */
  available: number;
  /** Ölçüt ölçüt sonuç — UI listeler, kara kutu olmaz. */
  checks: { id: string; label: string; passed: boolean | null; group: KarneGrubu }[];
}

/**
 * Karne başlıkları. Üç soru, üç ayrı cevap:
 *   kârlılık  — para kazanıyor mu, kazandığı gerçek nakit mi?
 *   büyüme    — büyüyor mu?
 *   borçluluk — bunu borçlanarak mı yapıyor?
 *
 * Tek bir "9 üzerinden 4" sayısı bunları birbirine karıştırıyordu: kârlı ama
 * küçülen bir şirket ile zarar eden ama borcunu azaltan bir şirket aynı
 * skoru alabilir, oysa ikisi çok farklı şeyler.
 */
export type KarneGrubu = 'kârlılık' | 'büyüme' | 'borçluluk';

/**
 * Piotroski F-skoru benzeri kalite ölçütleri (9 madde).
 * Veri eksikse madde `null` kalır ve paydadan düşülür: 9 üzerinden 4 ile
 * 6 üzerinden 4 aynı şey değildir, ikisi de gösterilir.
 */
export function qualityScore(fin: Financials): Quality {
  const periods = fin.periods;
  const lastIndex = periods.length - 1;
  const yearIndexes = periods.map((p, i) => (p.endsWith('/12') ? i : -1)).filter((i) => i >= 0);
  const thisYear = yearIndexes[yearIndexes.length - 1];
  const prevYear = yearIndexes[yearIndexes.length - 2];

  const value = (field: FieldId, index: number | undefined): number | null =>
    index === undefined || index < 0 ? null : (fin.fields[field][index] ?? null);

  const netIncome = ttm(periods, fin.fields.netIncome, lastIndex);
  const ocf = ttm(periods, fin.fields.operatingCashFlow, lastIndex);
  const assetsNow = value('assets', thisYear);
  const assetsPrev = value('assets', prevYear);
  const equityNow = value('equity', thisYear);
  const equityPrev = value('equity', prevYear);
  const revNow = value('revenue', thisYear);
  const revPrev = value('revenue', prevYear);
  const grossNow = value('grossProfit', thisYear);
  const grossPrev = value('grossProfit', prevYear);
  const liabNow = sum(value('currentLiabilities', thisYear), value('longLiabilities', thisYear));
  const liabPrev = sum(value('currentLiabilities', prevYear), value('longLiabilities', prevYear));
  const caNow = value('currentAssets', thisYear);
  const clNow = value('currentLiabilities', thisYear);
  const caPrev = value('currentAssets', prevYear);
  const clPrev = value('currentLiabilities', prevYear);

  const buyume = growth(fin);
  const roaNow = ratio(netIncome, assetsNow);
  const roaPrev = ratio(value('netIncome', prevYear), assetsPrev);

  const checks: Quality['checks'] = [
    {
      id: 'profit',
      label: 'Net kâr pozitif',
      passed: bool(netIncome, (v) => v > 0),
      group: 'kârlılık',
    },
    {
      id: 'ocf',
      label: 'Faaliyet nakit akışı pozitif',
      passed: bool(ocf, (v) => v > 0),
      group: 'kârlılık',
    },
    {
      id: 'accrual',
      label: 'Nakit akışı net kârdan büyük (tahakkuk kalitesi)',
      passed: ocf !== null && netIncome !== null ? ocf > netIncome : null,
      group: 'kârlılık',
    },
    {
      id: 'roaUp',
      label: 'Aktif kârlılığı arttı',
      passed: cmp(roaNow, roaPrev),
      group: 'kârlılık',
    },
    {
      id: 'leverage',
      label: 'Borç/özkaynak azaldı',
      passed: cmp(ratio(liabPrev, equityPrev), ratio(liabNow, equityNow)),
      group: 'borçluluk',
    },
    {
      id: 'liquidity',
      label: 'Cari oran arttı',
      passed: cmp(ratio(caNow, clNow), ratio(caPrev, clPrev)),
      group: 'borçluluk',
    },
    {
      id: 'margin',
      label: 'Brüt marj arttı',
      passed: cmp(ratio(grossNow, revNow), ratio(grossPrev, revPrev)),
      group: 'kârlılık',
    },
    {
      id: 'turnover',
      label: 'Aktif devir hızı arttı',
      passed: cmp(ratio(revNow, assetsNow), ratio(revPrev, assetsPrev)),
      group: 'büyüme',
    },
    {
      id: 'equity',
      label: 'Özkaynak büyüdü',
      passed: cmp(equityNow, equityPrev),
      group: 'büyüme',
    },
    // Büyüme başlığı iki ölçütle "aktif devir hızı" ve "özkaynak" üzerinden
    // dolaylı okunuyordu; asıl sorulan şey ciro ve kârın kendisi. TTM bazlı,
    // yani mevsimsellik karışmıyor.
    //
    // NOMİNAL: enflasyondan arındırılmamış. Yüksek enflasyonda nominal büyüme
    // reel küçülmeyi gizler — ölçütün adı bunu söylüyor.
    {
      id: 'revGrowth',
      label: 'Ciro büyüdü (nominal, son 12 ay)',
      passed: buyume.revenueYoyPct === null ? null : buyume.revenueYoyPct > 0,
      group: 'büyüme',
    },
    {
      id: 'niGrowth',
      label: 'Net kâr büyüdü (nominal, son 12 ay)',
      passed: buyume.netIncomeYoyPct === null ? null : buyume.netIncomeYoyPct > 0,
      group: 'büyüme',
    },
  ];

  const available = checks.filter((c) => c.passed !== null).length;
  const score = checks.filter((c) => c.passed === true).length;
  return { score, available, checks };
}

export interface KarneBasligi {
  grup: KarneGrubu;
  /** Karşılanan ölçüt. */
  score: number;
  /** Değerlendirilebilen ölçüt — veri eksikse payda KÜÇÜLÜR, uydurulmaz. */
  available: number;
  checks: Quality['checks'];
}

/**
 * Karne: kalite ölçütlerini üç başlıkta toplar.
 *
 * Tek bir "9 üzerinden 4" sayısı üç ayrı soruyu birbirine karıştırıyordu.
 * Kârlı ama küçülen bir şirket ile zarar eden ama borcunu azaltan bir şirket
 * aynı toplam skoru alabilir — oysa kullanıcının sorduğu şey hangisi olduğu.
 *
 * Veri eksikse madde değerlendirilmiyor ve o başlığın PAYDASI küçülüyor:
 * "2/2" ile "2/5" aynı şey değil ve ikisi de gösteriliyor.
 */
export function karne(fin: Financials): KarneBasligi[] {
  const q = qualityScore(fin);
  const gruplar: KarneGrubu[] = ['kârlılık', 'büyüme', 'borçluluk'];
  return gruplar.map((grup) => {
    const checks = q.checks.filter((c) => c.group === grup);
    return {
      grup,
      score: checks.filter((c) => c.passed === true).length,
      available: checks.filter((c) => c.passed !== null).length,
      checks,
    };
  });
}

function sum(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}
function ratio(a: number | null, b: number | null): number | null {
  return a === null || b === null || b === 0 ? null : a / b;
}
function bool(value: number | null, test: (v: number) => boolean): boolean | null {
  return value === null ? null : test(value);
}
function cmp(now: number | null, prev: number | null): boolean | null {
  return now === null || prev === null ? null : now > prev;
}

export interface Growth {
  revenueYoyPct: number | null;
  netIncomeYoyPct: number | null;
  equityYoyPct: number | null;
}

/** TTM bazlı yıllık büyüme: son TTM ile bir yıl önceki TTM karşılaştırılır. */
export function growth(fin: Financials): Growth {
  const periods = fin.periods;
  const last = periods.length - 1;
  if (last < 0) return { revenueYoyPct: null, netIncomeYoyPct: null, equityYoyPct: null };

  const [year, month] = periods[last].split('/').map(Number);
  const prevIndex = periods.indexOf(`${year - 1}/${month}`);

  const pct = (field: FieldId): number | null => {
    const now = ttm(periods, fin.fields[field], last);
    const before = prevIndex >= 0 ? ttm(periods, fin.fields[field], prevIndex) : null;
    if (now === null || before === null || before === 0) return null;
    // Negatiften pozitife geçişte yüzde değişim anlamsızdır.
    if (before < 0) return null;
    return ((now - before) / before) * 100;
  };

  const equityNow = fin.fields.equity[last] ?? null;
  const equityPrev = prevIndex >= 0 ? (fin.fields.equity[prevIndex] ?? null) : null;

  return {
    revenueYoyPct: pct('revenue'),
    netIncomeYoyPct: pct('netIncome'),
    equityYoyPct:
      equityNow !== null && equityPrev !== null && equityPrev > 0
        ? ((equityNow - equityPrev) / equityPrev) * 100
        : null,
  };
}

/**
 * Kesitsel yüzdelik: değer, evrenin yüzde kaçından daha yüksek?
 * `lowerIsBetter` (F/K gibi) için sıralama ters çevrilir, böylece 100 her
 * zaman "en iyi" demektir.
 */
export function percentileRank(
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

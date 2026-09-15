import type { Candles } from '../data/types';

/**
 * Piyasa nabzı: genişlik (breadth) ve para akışı.
 *
 * "Endeks yükseldi" tek başına az şey söyler — 30 hisse taşıyıp 400 hisse
 * düşüyor olabilir. Genişlik bunu; para akışı ise hacmin yükselenlerde mi
 * düşenlerde mi toplandığını gösterir.
 *
 * Saf: girdi sembol başına Candles, çıktı satırlar + özet.
 */

export interface PulseRow {
  symbol: string;
  last: number;
  /** Son bar değişimi (%). */
  changePct: number;
  /** İşlem değeri = kapanış × hacim (para birimi cinsinden hacim). */
  value: number;
  /** Son N barın en yükseğine/en düşüğüne olan uzaklık (%). */
  fromHigh: number;
  fromLow: number;
  /** Son bar, penceredeki en yüksek/en düşük kapanış mı? */
  newHigh: boolean;
  newLow: boolean;
  bars: number;
}

export interface PulseSummary {
  symbols: number;
  advancing: number;
  declining: number;
  unchanged: number;
  /** Yükselenlerin toplam içindeki payı (%); 50 = dengeli piyasa. */
  breadthPct: number;
  medianChangePct: number;
  /** Toplam işlem değeri ve yön kırılımı — paranın nereye aktığı. */
  totalValue: number;
  upValue: number;
  downValue: number;
  /** (yükselen değer − düşen değer) ÷ toplam × 100. Pozitif = alış baskısı. */
  flowPct: number;
  newHighs: number;
  newLows: number;
}

/**
 * Bir sembolün PENCERE toplamları.
 *
 * Tek barlık akış "bugün ne oldu" sorusunu cevaplıyor; "para hangi sektöre
 * KAYIYOR" sorusu ise pencere ister: bir sektörün işlem değeri payı bir
 * önceki eşit pencereye göre artıyor mu? Seviyeyi değil DEĞİŞİMİ ölçmek
 * gerekiyor — büyük sektörün payı zaten büyüktür, bu bir rotasyon değildir.
 */
export interface WindowRow {
  symbol: string;
  /** Son N barın toplam işlem değeri (kapanış × hacim). */
  value: number;
  /** Ondan ÖNCEKİ N barın toplam işlem değeri. */
  prevValue: number;
  /** Pencere getirisi (%): son kapanış ÷ N bar önceki kapanış − 1. */
  returnPct: number;
  /** Pencerede gerçekten kaç bar vardı (kısa geçmişli sembol). */
  bars: number;
}

/**
 * Pencere toplamları. Önceki pencere EKSİKSE `prevValue` 0 kalır ve rotasyon
 * hesabı o sembolü paya katmaz — yarım pencereyi tam saymak, yeni işlem görmeye
 * başlayan bir sembolü "para akıyor" gibi gösterirdi.
 */
export function windowRow(symbol: string, c: Candles, bars: number): WindowRow | null {
  const n = c.length;
  if (n < bars + 1 || bars < 1) return null;

  let value = 0;
  for (let i = n - bars; i < n; i++) value += c.close[i] * c.volume[i];

  let prevValue = 0;
  const prevFrom = n - 2 * bars;
  if (prevFrom >= 0) {
    for (let i = prevFrom; i < n - bars; i++) prevValue += c.close[i] * c.volume[i];
  }

  const last = c.close[n - 1];
  const base = c.close[n - 1 - bars];
  if (!(last > 0) || !(base > 0)) return null;

  return { symbol, value, prevValue, returnPct: (last / base - 1) * 100, bars };
}

export interface PulseOptions {
  /** Yeni zirve/dip penceresi (bar). */
  window?: number;
  /** Bu kadar bardan az veriye sahip semboller atlanır. */
  minBars?: number;
}

export function pulseRow(symbol: string, c: Candles, options: PulseOptions = {}): PulseRow | null {
  const { window = 250, minBars = 20 } = options;
  const n = c.length;
  if (n < Math.max(2, minBars)) return null;

  const last = c.close[n - 1];
  const prev = c.close[n - 2];
  if (!(last > 0) || !(prev > 0)) return null;

  const from = Math.max(0, n - window);
  let high = -Infinity;
  let low = Infinity;
  for (let i = from; i < n; i++) {
    if (c.close[i] > high) high = c.close[i];
    if (c.close[i] < low) low = c.close[i];
  }

  return {
    symbol,
    last,
    changePct: (last / prev - 1) * 100,
    value: last * c.volume[n - 1],
    fromHigh: high > 0 ? (last / high - 1) * 100 : NaN,
    fromLow: low > 0 ? (last / low - 1) * 100 : NaN,
    newHigh: last >= high,
    newLow: last <= low,
    bars: n,
  };
}

export function summarizePulse(rows: PulseRow[]): PulseSummary {
  const summary: PulseSummary = {
    symbols: rows.length,
    advancing: 0,
    declining: 0,
    unchanged: 0,
    breadthPct: NaN,
    medianChangePct: NaN,
    totalValue: 0,
    upValue: 0,
    downValue: 0,
    flowPct: NaN,
    newHighs: 0,
    newLows: 0,
  };
  if (rows.length === 0) return summary;

  const changes: number[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.changePct)) continue;
    changes.push(row.changePct);

    if (row.changePct > 0) {
      summary.advancing++;
      summary.upValue += row.value;
    } else if (row.changePct < 0) {
      summary.declining++;
      summary.downValue += row.value;
    } else {
      summary.unchanged++;
    }
    summary.totalValue += row.value;
    if (row.newHigh) summary.newHighs++;
    if (row.newLow) summary.newLows++;
  }

  changes.sort((a, b) => a - b);
  const mid = changes.length >> 1;
  summary.medianChangePct = changes.length
    ? changes.length % 2
      ? changes[mid]
      : (changes[mid - 1] + changes[mid]) / 2
    : NaN;

  const directional = summary.advancing + summary.declining;
  summary.breadthPct = directional ? (summary.advancing / directional) * 100 : NaN;
  summary.flowPct = summary.totalValue
    ? ((summary.upValue - summary.downValue) / summary.totalValue) * 100
    : NaN;

  return summary;
}

export interface GroupFlow {
  /** Küme kimliği. */
  cluster: number;
  /** Kümeyi temsil eden ad: en yüksek işlem değerine sahip sembol. */
  label: string;
  symbols: number;
  value: number;
  /** İşlem değeriyle ağırlıklı ortalama değişim (%). */
  weightedChangePct: number;
  flowPct: number;
  advancing: number;
  declining: number;
}

/**
 * Kümelere (veri odaklı "sektör benzeri" gruplar) göre para akışı.
 *
 * Not: elimizde resmî sektör sınıflandırması yok. Gruplar, birlikte hareket
 * eden hisselerin hiyerarşik kümelenmesinden geliyor — bu bir sektör listesi
 * DEĞİL, davranış benzerliği. Etiket olarak grubun en çok işlem gören sembolü
 * kullanılıyor ve arayüz bunu böyle söylüyor.
 */
export function flowByCluster(
  rows: PulseRow[],
  clusterOf: Map<string, number>,
  minSymbols = 2,
): GroupFlow[] {
  const groups = new Map<number, PulseRow[]>();
  for (const row of rows) {
    const cluster = clusterOf.get(row.symbol);
    if (cluster === undefined) continue;
    const list = groups.get(cluster);
    if (list) list.push(row);
    else groups.set(cluster, [row]);
  }

  const out: GroupFlow[] = [];
  for (const [cluster, list] of groups) {
    if (list.length < minSymbols) continue;
    let value = 0;
    let weighted = 0;
    let up = 0;
    let down = 0;
    let advancing = 0;
    let declining = 0;
    for (const row of list) {
      value += row.value;
      weighted += row.value * row.changePct;
      if (row.changePct > 0) {
        up += row.value;
        advancing++;
      } else if (row.changePct < 0) {
        down += row.value;
        declining++;
      }
    }
    const label = list.reduce((a, b) => (b.value > a.value ? b : a)).symbol;
    out.push({
      cluster,
      label,
      symbols: list.length,
      value,
      weightedChangePct: value ? weighted / value : NaN,
      flowPct: value ? ((up - down) / value) * 100 : NaN,
      advancing,
      declining,
    });
  }

  return out.sort((a, b) => b.value - a.value);
}

import type { Candles } from './types';
import { trSayi } from '../format/sayi';
import { DAY_SECONDS } from './pack';

/**
 * Veri sağlığı — analizden ÖNCE gelen katman.
 *
 * Referans projede bu katman hiç yok: eksik bar, tekrar eden gün ya da
 * düzeltilmemiş bölünme sessizce indikatöre, oradan backtest sonucuna giriyor.
 * Burada hiçbir şey düzeltilmez; sadece **görünür** kılınır — düzeltme kararı
 * (ve varsa kaynak verinin değişmesi) ayrı bir iştir.
 *
 * Saf fonksiyonlar: takvim/ağ/DOM yok, hepsi girdiden türetilir.
 */

export interface Gap {
  /** Boşluğun iki ucundaki barların indeksleri. */
  fromIndex: number;
  toIndex: number;
  fromDay: number;
  toDay: number;
  /** Aradaki hafta içi gün sayısı (tatiller bilinmediği için üst sınır). */
  missingWeekdays: number;
}

export interface Outlier {
  index: number;
  day: number;
  /** Bir önceki kapanışa göre yüzde değişim. */
  changePct: number;
  /** Sık görülen bölünme oranlarına yakınsa (ör. 1/2, 1/3, 2/1) o oran. */
  splitRatio: number | null;
}

export interface HealthReport {
  bars: number;
  firstDay: number;
  lastDay: number;
  /** Son bardan bugüne kaç hafta içi gün geçmiş (bayatlık ölçüsü). */
  staleWeekdays: number;
  gaps: Gap[];
  outliers: Outlier[];
  /** Hacmi sıfır/eksik bar sayısı — likidite ve veri kalitesi işareti. */
  zeroVolumeBars: number;
  /** OHLC tutarsızlığı (high < low, close aralık dışı vb.). */
  invalidBars: number;
  /** Genel durum: kırmızı olanlar analizden önce görülmeli. */
  level: 'ok' | 'warn' | 'error';
  /** İnsan okunur bulgular (UI doğrudan bunu gösterir). */
  findings: string[];
}

export interface InspectOptions {
  /** "Bugün" — epoch gün. Çağıran verir, böylece fonksiyon saf kalır. */
  today: number;
  /** Aykırı sayılacak tek gün değişimi (yüzde, mutlak). */
  outlierPct?: number;
  /** Bayat sayılacak hafta içi gün eşiği. */
  staleWeekdays?: number;
  /** Raporlanacak en fazla aykırı/boşluk sayısı. */
  maxItems?: number;
}

/** Hafta içi (Pzt–Cum) gün sayısı, [a, b) yarı açık aralığında. */
export function weekdaysBetween(a: number, b: number): number {
  if (b <= a) return 0;
  let count = 0;
  for (let d = a; d < b; d++) {
    // epoch gün 0 = 1 Ocak 1970 = Perşembe → (d + 4) % 7: 0 = Pazar
    const dow = (((d + 4) % 7) + 7) % 7;
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** Sık görülen bölünme oranlarına yakınlık (yoksa null). */
function splitRatioOf(ratio: number): number | null {
  const candidates = [1 / 10, 1 / 5, 1 / 4, 1 / 3, 1 / 2, 2, 3, 4, 5, 10];
  for (const c of candidates) {
    if (Math.abs(ratio / c - 1) <= 0.03) return c;
  }
  return null;
}

export function inspect(candles: Candles, options: InspectOptions): HealthReport {
  const { today, outlierPct = 25, staleWeekdays: staleLimit = 3, maxItems = 20 } = options;

  const n = candles.length;
  const day = (i: number) => Math.floor(candles.time[i] / DAY_SECONDS);

  const report: HealthReport = {
    bars: n,
    firstDay: n ? day(0) : 0,
    lastDay: n ? day(n - 1) : 0,
    staleWeekdays: 0,
    gaps: [],
    outliers: [],
    zeroVolumeBars: 0,
    invalidBars: 0,
    level: 'ok',
    findings: [],
  };

  if (n === 0) {
    report.level = 'error';
    report.findings.push('Veri yok.');
    return report;
  }

  report.staleWeekdays = weekdaysBetween(report.lastDay + 1, today + 1);

  for (let i = 0; i < n; i++) {
    const o = candles.open[i];
    const h = candles.high[i];
    const l = candles.low[i];
    const c = candles.close[i];
    if (
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c) ||
      h < l ||
      c > h + 1e-6 ||
      c < l - 1e-6 ||
      o > h + 1e-6 ||
      o < l - 1e-6 ||
      c <= 0
    ) {
      report.invalidBars++;
    }
    if (!(candles.volume[i] > 0)) report.zeroVolumeBars++;

    if (i > 0) {
      const prevDay = day(i - 1);
      const curDay = day(i);
      const missing = weekdaysBetween(prevDay + 1, curDay);
      if (missing > 0 && report.gaps.length < maxItems) {
        report.gaps.push({
          fromIndex: i - 1,
          toIndex: i,
          fromDay: prevDay,
          toDay: curDay,
          missingWeekdays: missing,
        });
      }

      const prev = candles.close[i - 1];
      if (prev > 0 && c > 0) {
        const ratio = c / prev;
        const changePct = (ratio - 1) * 100;
        if (Math.abs(changePct) >= outlierPct && report.outliers.length < maxItems) {
          report.outliers.push({
            index: i,
            day: curDay,
            changePct,
            splitRatio: splitRatioOf(ratio),
          });
        }
      }
    }
  }

  // ── Bulgular: sayıları insan diline çevir ──────────────────────────────
  if (report.invalidBars > 0) {
    report.findings.push(`${report.invalidBars} barda OHLC tutarsız (yüksek < düşük gibi).`);
  }
  if (report.staleWeekdays > staleLimit) {
    report.findings.push(
      `Son bar ${report.staleWeekdays} hafta içi gün öncesine ait — veri bayat olabilir.`,
    );
  }
  const totalMissing = report.gaps.reduce((s, g) => s + g.missingWeekdays, 0);
  if (totalMissing > 0) {
    report.findings.push(
      `${report.gaps.length} boşlukta toplam ${totalMissing} hafta içi gün eksik ` +
        '(resmî tatiller de bu sayıya dahildir).',
    );
  }
  const splits = report.outliers.filter((o) => o.splitRatio !== null);
  if (splits.length > 0) {
    report.findings.push(
      `${splits.length} barda bölünme benzeri sıçrama var — fiyat serisi düzeltilmemiş olabilir, ` +
        'uzun vadeli getiri ve backtest sonuçları bundan etkilenir.',
    );
  }
  const plainOutliers = report.outliers.length - splits.length;
  if (plainOutliers > 0) {
    report.findings.push(`${plainOutliers} barda tek günde %${outlierPct}+ hareket var.`);
  }
  if (report.zeroVolumeBars > 0) {
    const share = (report.zeroVolumeBars / n) * 100;
    report.findings.push(
      // `toFixed` NOKTA üretir; bu cümle doğrudan ekrana yazılıyor ve gerçek
      // veride "%1.9" diye görünüyordu (bkz. core/format/sayi.ts).
      `${report.zeroVolumeBars} bar (%${trSayi(share, 1)}) sıfır hacimli — işlem görmemiş olabilir.`,
    );
  }

  if (report.invalidBars > 0 || report.bars < 30) report.level = 'error';
  else if (report.findings.length > 0) report.level = 'warn';

  if (report.findings.length === 0) report.findings.push('Belirgin bir sorun bulunmadı.');
  return report;
}

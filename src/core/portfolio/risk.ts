import type { Candles } from '../data/types';
import { DAY_SECONDS } from '../data/pack';

/**
 * Portföy riski: dağılımın kuyruğu, yoğunlaşma ve tarihsel senaryolar.
 *
 * "Portföyüm %12 kazandırdı" bir risk ifadesi değildir. Buradaki ölçüler
 * kaybın büyüklüğünü (VaR/CVaR), yoğunlaşmayı (tek hisseye bağımlılık) ve
 * geçmişte yaşanmış şokların bu portföye ne yapacağını gösterir.
 */

export interface Holding {
  symbol: string;
  /** Portföy ağırlığı (0–1). */
  weight: number;
}

/**
 * Ağırlıklı portföyün günlük getiri serisi.
 * Ağırlıklar sabit varsayılır (yeniden dengeleme yapılmış gibi) — gerçek
 * portföyde ağırlıklar kayar, bu yüzden sonuç bir yaklaşımdır ve öyle etiketlenir.
 */
export function portfolioReturns(
  holdings: Holding[],
  seriesOf: (symbol: string) => Candles | undefined,
  lookbackBars = 500,
): { returns: Float64Array; days: Int32Array; used: string[]; missing: string[] } {
  const used: string[] = [];
  const missing: string[] = [];
  const perSymbol = new Map<string, Map<number, number>>();

  for (const holding of holdings) {
    const candles = seriesOf(holding.symbol);
    // İki bar bir getiri demektir; yeterlilik kararı çağırana ait (VaR kendi
    // asgari gözlem sayısını ayrıca uygular).
    if (!candles || candles.length < 2) {
      missing.push(holding.symbol);
      continue;
    }
    const map = new Map<number, number>();
    const from = Math.max(1, candles.length - lookbackBars);
    for (let i = from; i < candles.length; i++) {
      const prev = candles.close[i - 1];
      const cur = candles.close[i];
      if (prev > 0 && cur > 0) {
        map.set(Math.floor(candles.time[i] / DAY_SECONDS), cur / prev - 1);
      }
    }
    if (map.size === 0) {
      missing.push(holding.symbol);
      continue;
    }
    perSymbol.set(holding.symbol, map);
    used.push(holding.symbol);
  }

  if (used.length === 0) {
    return { returns: new Float64Array(0), days: new Int32Array(0), used, missing };
  }

  // Ortak gün ekseni: hepsinin veri verdiği günler (kesişim).
  const first = perSymbol.get(used[0])!;
  const days = [...first.keys()]
    .filter((day) => used.every((symbol) => perSymbol.get(symbol)!.has(day)))
    .sort((a, b) => a - b);

  const totalWeight = holdings
    .filter((h) => used.includes(h.symbol))
    .reduce((s, h) => s + h.weight, 0);

  const returns = new Float64Array(days.length);
  days.forEach((day, i) => {
    let value = 0;
    for (const holding of holdings) {
      const map = perSymbol.get(holding.symbol);
      if (!map) continue;
      value += (holding.weight / (totalWeight || 1)) * map.get(day)!;
    }
    returns[i] = value;
  });

  return { returns, days: Int32Array.from(days), used, missing };
}

export interface TailRisk {
  /** Tarihsel VaR: bu güven düzeyinde bir günde aşılmayan kayıp (%). */
  varPct: number;
  /** CVaR (beklenen kayıp): VaR aşıldığında ortalama kayıp (%). */
  cvarPct: number;
  /** Kullanılan gözlem sayısı. */
  samples: number;
  confidence: number;
}

/**
 * Tarihsel VaR/CVaR — dağılım varsayımı YOK.
 * Parametrik (normal) VaR, finansal getirilerin şişman kuyruğunu sistematik
 * olarak küçük gösterir; burada gerçekleşmiş getiriler sıralanır.
 */
export function tailRisk(returns: ArrayLike<number>, confidence = 0.95): TailRisk {
  const values = Array.from(returns).filter(Number.isFinite);
  if (values.length < 20) {
    return { varPct: NaN, cvarPct: NaN, samples: values.length, confidence };
  }
  values.sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(values.length - 1, Math.floor((1 - confidence) * values.length)),
  );
  const varValue = values[index];
  const tail = values.slice(0, index + 1);
  const cvar = tail.reduce((s, v) => s + v, 0) / tail.length;
  return {
    varPct: varValue * 100,
    cvarPct: cvar * 100,
    samples: values.length,
    confidence,
  };
}

export interface Concentration {
  /** En büyük pozisyonun ağırlığı (%). */
  top1Pct: number;
  top3Pct: number;
  /** Herfindahl–Hirschman endeksi (0–1); 1 = tek hisse. */
  herfindahl: number;
  /** Eşdeğer çeşitlendirilmiş pozisyon sayısı (1/HHI). */
  effectivePositions: number;
}

export function concentration(weights: number[]): Concentration {
  const values = weights.filter((w) => w > 0).sort((a, b) => b - a);
  const total = values.reduce((s, w) => s + w, 0);
  if (total <= 0) {
    return { top1Pct: NaN, top3Pct: NaN, herfindahl: NaN, effectivePositions: NaN };
  }
  const norm = values.map((w) => w / total);
  const hhi = norm.reduce((s, w) => s + w * w, 0);
  return {
    top1Pct: norm[0] * 100,
    top3Pct: norm.slice(0, 3).reduce((s, w) => s + w, 0) * 100,
    herfindahl: hhi,
    effectivePositions: hhi > 0 ? 1 / hhi : NaN,
  };
}

export interface Scenario {
  id: string;
  label: string;
  /** Kapsanan tarih aralığı (epoch gün). */
  fromDay: number;
  toDay: number;
  note: string;
}

/**
 * Tarihsel stres pencereleri (BIST). Simülasyon değil, GERÇEKTEN yaşanmış
 * dönemler: portföy o günlerde ne yapardı sorusunu veriyle cevaplar.
 */
export const BIST_SCENARIOS: Scenario[] = [
  {
    id: 'aug2018',
    label: 'Ağustos 2018 kur şoku',
    fromDay: Math.floor(Date.UTC(2018, 7, 1) / 1000 / DAY_SECONDS),
    toDay: Math.floor(Date.UTC(2018, 8, 15) / 1000 / DAY_SECONDS),
    note: 'TL’de hızlı değer kaybı, faiz sıçraması',
  },
  {
    id: 'mar2020',
    label: 'Mart 2020 pandemi satışı',
    fromDay: Math.floor(Date.UTC(2020, 1, 20) / 1000 / DAY_SECONDS),
    toDay: Math.floor(Date.UTC(2020, 2, 31) / 1000 / DAY_SECONDS),
    note: 'Küresel likidite şoku',
  },
  {
    id: 'feb2023',
    label: 'Şubat 2023 deprem haftası',
    fromDay: Math.floor(Date.UTC(2023, 1, 6) / 1000 / DAY_SECONDS),
    toDay: Math.floor(Date.UTC(2023, 1, 24) / 1000 / DAY_SECONDS),
    note: 'Borsada işlem durdurma dahil',
  },
  {
    id: 'nov2021',
    label: 'Kasım–Aralık 2021 kur dalgası',
    fromDay: Math.floor(Date.UTC(2021, 10, 1) / 1000 / DAY_SECONDS),
    toDay: Math.floor(Date.UTC(2021, 11, 31) / 1000 / DAY_SECONDS),
    note: 'Sert kur hareketi, yüksek oynaklık',
  },
];

export interface ScenarioResult {
  scenario: Scenario;
  /** Portföyün o pencerede toplam getirisi (%); veri yoksa NaN. */
  returnPct: number;
  /** Pencerede veri bulunan sembol sayısı. */
  covered: number;
  total: number;
}

export function runScenario(
  holdings: Holding[],
  seriesOf: (symbol: string) => Candles | undefined,
  scenario: Scenario,
): ScenarioResult {
  let weighted = 0;
  let usedWeight = 0;
  let covered = 0;

  for (const holding of holdings) {
    const candles = seriesOf(holding.symbol);
    if (!candles || candles.length === 0) continue;

    let firstIdx = -1;
    let lastIdx = -1;
    for (let i = 0; i < candles.length; i++) {
      const day = Math.floor(candles.time[i] / DAY_SECONDS);
      if (day < scenario.fromDay) continue;
      if (day > scenario.toDay) break;
      if (firstIdx < 0) firstIdx = i;
      lastIdx = i;
    }
    if (firstIdx < 0 || lastIdx <= firstIdx) continue;

    const start = candles.close[firstIdx];
    const end = candles.close[lastIdx];
    if (!(start > 0)) continue;

    weighted += holding.weight * (end / start - 1);
    usedWeight += holding.weight;
    covered++;
  }

  return {
    scenario,
    returnPct: usedWeight > 0 ? (weighted / usedWeight) * 100 : NaN,
    covered,
    total: holdings.length,
  };
}

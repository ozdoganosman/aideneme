import type { Candles } from '../data/types';
import type { BacktestResult } from './engine';

/**
 * Performans ve risk metrikleri.
 *
 * Referans projede sonuç "toplam getiri + kazanma oranı" ile özetleniyordu;
 * ikisi de bir stratejinin YAŞANABİLİR olup olmadığını söylemez. Buradaki set
 * riski (düşüş derinliği ve süresi), dağılımın kuyruğunu (Sortino, Ulcer) ve
 * maliyetin payını ayrıca gösterir.
 */

export interface BacktestMetrics {
  bars: number;
  years: number;
  trades: number;

  totalReturnPct: number;
  cagrPct: number;
  volatilityPct: number;
  /** Risksiz oran 0 kabul edilir; karşılaştırma için kullanılır, mutlak yorum için değil. */
  sharpe: number;
  /** Yalnızca aşağı yönlü sapmayı cezalandırır. */
  sortino: number;
  /** CAGR ÷ maks. düşüş — "acıya karşılık getiri". */
  calmar: number;
  /** Ulcer Index: düşüşte geçirilen sürenin ve derinliğin birleşimi. */
  ulcer: number;
  maxDrawdownPct: number;
  /** En uzun düşüş süresi (bar). */
  maxDrawdownBars: number;

  winRatePct: number;
  profitFactor: number;
  expectancyPct: number;
  avgWinPct: number;
  avgLossPct: number;
  avgBars: number;
  /** İşlem başına en kötü kâğıt üstü zarar/kâr ortalaması. */
  avgMaePct: number;
  avgMfePct: number;

  exposurePct: number;
  /** Maliyetin toplam getiriden götürdüğü puan. */
  costDragPct: number;

  buyHoldReturnPct: number;
  buyHoldCagrPct: number;
  /** Stratejinin al-tut üzerine kattığı yıllık fark (puan). */
  excessCagrPct: number;
}

/**
 * Her metriğin formülü — HESABIN YANINDA duruyor.
 *
 * Ürün ilkesi #2 ("her sayı tıklanabilir") Sembol Masası'nda yapısaldı ama
 * Laboratuvar'ın sekiz kartında hiç uygulanmamıştı: kullanıcı Sharpe'ın hangi
 * risksiz oranla, maks. düşüşün hangi pencerede hesaplandığını göremiyordu.
 * Metni burada tutmak, hesap değişince açıklamanın eskimesini zorlaştırıyor.
 */
export const BACKTEST_METRIC_FORMULA: Record<string, string> = {
  cagrPct: '(son sermaye ÷ ilk sermaye)^(1 ÷ yıl) − 1. Isınma barları hariç.',
  excessCagrPct:
    'Strateji CAGR − al-tut CAGR (puan). Al-tut AYNI maliyet modelini öder: tek giriş, tek çıkış.',
  buyHoldCagrPct: 'Aynı pencerede al-tut sermayesinin yıllık bileşik getirisi.',
  maxDrawdownPct:
    'Sermaye eğrisinde en kötü tepe → dip düşüşü (%). Yanındaki bar sayısı, düşüşün tepeden dibe kaç bar sürdüğü.',
  sharpe:
    'Ortalama bar getirisi × yıllık bar sayısı ÷ yıllık oynaklık. RİSKSİZ ORAN 0 KABUL EDİLİR — mutlak yorum için değil, karşılaştırma için.',
  sortino: 'Sharpe ile aynı, ama paydada yalnızca AŞAĞI yönlü sapma var.',
  calmar: 'CAGR ÷ maks. düşüş — "acıya karşılık getiri". Düşüş sıfırsa 0.',
  ulcer:
    'Ulcer Index: her bardaki tepeden uzaklığın karesel ortalaması. Düşüşün hem derinliğini hem SÜRESİNİ cezalandırır.',
  trades: 'Kapanmış işlem sayısı. Kazanma oranı ve ortalama süre bu işlemler üzerinden.',
  profitFactor:
    'Kazanan işlemlerin net toplamı ÷ kaybedenlerin net toplamının mutlak değeri. Beklenti = net toplam ÷ işlem sayısı.',
  costDragPct:
    'Maliyetsiz getiri toplamı − net getiri toplamı (puan). Komisyon + slipajın işlemlerden götürdüğü.',
  exposurePct: 'Pozisyonda geçirilen bar oranı. Nakitte geçen zaman getiri üretmez.',
};

const YEAR_SECONDS = 365.25 * 86400;
/** Yıllık %1e-7'nin altındaki oynaklık "yok" sayılır (kayan nokta gürültüsü). */
const VOL_EPSILON = 1e-9;

function periodReturns(equity: Float64Array, from: number): number[] {
  const out: number[] = [];
  for (let i = from + 1; i < equity.length; i++) {
    const prev = equity[i - 1];
    if (prev > 0 && equity[i] > 0) out.push(equity[i] / prev - 1);
  }
  return out;
}

function drawdown(equity: Float64Array, from: number): { maxPct: number; maxBars: number } {
  let peak = -Infinity;
  let peakIndex = from;
  let maxPct = 0;
  let maxBars = 0;
  for (let i = from; i < equity.length; i++) {
    const v = equity[i];
    if (v > peak) {
      peak = v;
      peakIndex = i;
    }
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxPct) maxPct = dd;
    if (i - peakIndex > maxBars && dd > 0) maxBars = i - peakIndex;
  }
  return { maxPct: maxPct * 100, maxBars };
}

function ulcerIndex(equity: Float64Array, from: number): number {
  let peak = -Infinity;
  let sum = 0;
  let count = 0;
  for (let i = from; i < equity.length; i++) {
    const v = equity[i];
    if (v > peak) peak = v;
    const dd = peak > 0 ? ((peak - v) / peak) * 100 : 0;
    sum += dd * dd;
    count++;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

export function computeMetrics(result: BacktestResult, c: Candles): BacktestMetrics {
  const from = Math.min(result.warmup, Math.max(0, c.length - 1));
  const n = c.length;
  const start = result.equity[from] || result.initialCash;
  const end = result.equity[n - 1] || start;
  const years = n > from + 1 ? (c.time[n - 1] - c.time[from]) / YEAR_SECONDS : 0;

  const rets = periodReturns(result.equity, from);
  const barsPerYear = years > 0 ? rets.length / years : 252;

  const mean = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
  const variance =
    rets.length > 1 ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1) : 0;
  const vol = Math.sqrt(variance * barsPerYear);

  const downside = rets.filter((r) => r < 0);
  const downVar = downside.length ? downside.reduce((s, r) => s + r * r, 0) / downside.length : 0;
  const downVol = Math.sqrt(downVar * barsPerYear);

  const totalReturn = start > 0 ? (end / start - 1) * 100 : 0;
  const cagr = start > 0 && years > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : 0;
  const dd = drawdown(result.equity, from);

  const wins = result.trades.filter((t) => t.netPct > 0);
  const losses = result.trades.filter((t) => t.netPct <= 0);
  const grossWin = wins.reduce((s, t) => s + t.netPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPct, 0));

  const bhStart = result.buyHold[from] || result.initialCash;
  const bhEnd = result.buyHold[n - 1] || bhStart;
  const bhReturn = bhStart > 0 ? (bhEnd / bhStart - 1) * 100 : 0;
  const bhCagr = bhStart > 0 && years > 0 ? (Math.pow(bhEnd / bhStart, 1 / years) - 1) * 100 : 0;

  const grossTotal = result.trades.reduce((s, t) => s + t.grossPct, 0);
  const netTotal = result.trades.reduce((s, t) => s + t.netPct, 0);

  return {
    bars: n - from,
    years,
    trades: result.trades.length,

    totalReturnPct: totalReturn,
    cagrPct: cagr,
    volatilityPct: vol * 100,
    // Payda (neredeyse) sıfırsa oran tanımsızdır: pozitif getiride sonsuz,
    // aksi halde sıfır. Eşik, kayan nokta gürültüsünün 1e14 gibi anlamsız
    // "Sharpe" üretmesini engeller; 0 döndürmek ise kayıpsız bir seriyi
    // cezalandırmak olurdu.
    sharpe: vol > VOL_EPSILON ? (mean * barsPerYear) / vol : mean > 0 ? Infinity : 0,
    sortino: downVol > VOL_EPSILON ? (mean * barsPerYear) / downVol : mean > 0 ? Infinity : 0,
    calmar: dd.maxPct > 0 ? cagr / dd.maxPct : 0,
    ulcer: ulcerIndex(result.equity, from),
    maxDrawdownPct: dd.maxPct,
    maxDrawdownBars: dd.maxBars,

    winRatePct: result.trades.length ? (wins.length / result.trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancyPct: result.trades.length ? netTotal / result.trades.length : 0,
    avgWinPct: wins.length ? grossWin / wins.length : 0,
    avgLossPct: losses.length ? -grossLoss / losses.length : 0,
    avgBars: result.trades.length
      ? result.trades.reduce((s, t) => s + t.bars, 0) / result.trades.length
      : 0,
    avgMaePct: result.trades.length
      ? result.trades.reduce((s, t) => s + t.maePct, 0) / result.trades.length
      : 0,
    avgMfePct: result.trades.length
      ? result.trades.reduce((s, t) => s + t.mfePct, 0) / result.trades.length
      : 0,

    exposurePct: result.exposurePct,
    costDragPct: grossTotal - netTotal,

    buyHoldReturnPct: bhReturn,
    buyHoldCagrPct: bhCagr,
    excessCagrPct: cagr - bhCagr,
  };
}

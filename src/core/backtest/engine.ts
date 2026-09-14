import type { Candles } from '../data/types';
import { atrArr } from '../indicators/rsi';
import { evaluateCondition, warmupBars, type Strategy } from '../strategy/dsl';

/**
 * Olay güdümlü backtest motoru.
 *
 * İki kural pazarlık konusu değildir:
 *
 * 1. **Look-ahead yok.** Sinyal `i` barının KAPANIŞINDA üretilir, emir `i+1`
 *    barının AÇILIŞINDA dolar. Motor `i` barında `i+1` verisine hiç bakmaz;
 *    stop/hedef kontrolü de yalnızca pozisyon açıldıktan SONRAKİ barlarda,
 *    o barın kendi yüksek/düşüğüyle yapılır.
 * 2. **Maliyetsiz sonuç yoktur.** Komisyon, slipaj ve likidite tavanı
 *    modelin parçasıdır; maliyetsiz çalıştırmak ancak açıkça istenerek
 *    (hepsini sıfırlayarak) mümkündür ve sonuç öyle etiketlenir.
 */

export interface CostModel {
  /** Komisyon, tek yön, baz puan (10 bps = binde 1). */
  commissionBps: number;
  /** Slipaj, tek yön, baz puan. */
  slippageBps: number;
  /** O barın hacminin en fazla bu yüzdesi alınabilir; 0 = sınırsız. */
  volumeCapPct: number;
}

/** BIST için makul bir başlangıç: binde 1 komisyon + yarım binde slipaj. */
export const DEFAULT_COSTS: CostModel = {
  commissionBps: 10,
  slippageBps: 5,
  volumeCapPct: 10,
};

export const ZERO_COSTS: CostModel = { commissionBps: 0, slippageBps: 0, volumeCapPct: 0 };

export interface BacktestOptions {
  costs?: CostModel;
  initialCash?: number;
  /** Boşta duran nakde uygulanan yıllık getiri (%); TL'de enflasyona bağlı mevduat. */
  cashAnnualPct?: number;
  /** Ek ısınma barı; strateji penceresinden türetilene eklenir. */
  extraWarmup?: number;
}

export type ExitReason = 'signal' | 'stop' | 'target' | 'end';

export interface Trade {
  entryIndex: number;
  exitIndex: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  /** Maliyetsiz getiri (%). */
  grossPct: number;
  /** Maliyet dahil getiri (%). */
  netPct: number;
  /** Maliyetin getiriden götürdüğü (puan). */
  costPct: number;
  /** İşlem süresince en kötü/en iyi kâğıt üstü durum (%). */
  maePct: number;
  mfePct: number;
  bars: number;
  reason: ExitReason;
}

export interface BacktestResult {
  /** Bar sonu portföy değeri (nakit + pozisyon). */
  equity: Float64Array;
  /** Aynı sermayeyle al-tut (aynı maliyet modeliyle tek giriş/çıkış). */
  buyHold: Float64Array;
  /** Bar sonunda pozisyonda mıydı. */
  inPosition: Uint8Array;
  trades: Trade[];
  /** Pozisyonda geçirilen bar oranı (%). */
  exposurePct: number;
  /** Ödenen toplam maliyet (para birimi). */
  costPaid: number;
  warmup: number;
  /** Likidite tavanı yüzünden hiç açılamayan işlem sayısı. */
  skippedByLiquidity: number;
  initialCash: number;
}

const BPS = 1e-4;
const YEAR_SECONDS = 365.25 * 86400;

export function runBacktest(
  c: Candles,
  strategy: Strategy,
  options: BacktestOptions = {},
): BacktestResult {
  const costs = options.costs ?? DEFAULT_COSTS;
  const initialCash = options.initialCash ?? 100_000;
  const cashAnnual = options.cashAnnualPct ?? 0;
  const n = c.length;

  const warmup = Math.min(n, warmupBars(strategy) + (options.extraWarmup ?? 0) + 1);

  const equity = new Float64Array(n);
  const buyHold = new Float64Array(n);
  const inPosition = new Uint8Array(n);
  const trades: Trade[] = [];

  if (n === 0) {
    return {
      equity,
      buyHold,
      inPosition,
      trades,
      exposurePct: 0,
      costPaid: 0,
      warmup,
      skippedByLiquidity: 0,
      initialCash,
    };
  }

  const cache = new Map<string, Float64Array>();
  const entrySignal = evaluateCondition(strategy.entry, c, cache);
  const exitSignal = strategy.exit ? evaluateCondition(strategy.exit, c, cache) : null;
  const atr = strategy.atrStop ? atrArr(c.high, c.low, c.close, strategy.atrStop.length) : null;

  let cash = initialCash;
  let shares = 0;
  let entryPrice = 0;
  let entryIndex = -1;
  let stopPrice = 0;
  let targetPrice = 0;
  let trailStop = 0;
  let mae = 0;
  let mfe = 0;
  let costPaid = 0;
  let skipped = 0;
  let exposedBars = 0;

  // Al-tut karşılaştırması aynı maliyet modelini öder: adil kıyas.
  const bhStart = Math.min(warmup, n - 1);
  const bhEntry = c.close[bhStart] * (1 + costs.slippageBps * BPS);
  const bhShares = bhEntry > 0 ? (initialCash * (1 - costs.commissionBps * BPS)) / bhEntry : 0;

  const dailyCashRate = (bar: number): number => {
    if (cashAnnual === 0 || bar === 0) return 0;
    const dt = (c.time[bar] - c.time[bar - 1]) / YEAR_SECONDS;
    return Math.pow(1 + cashAnnual / 100, dt) - 1;
  };

  for (let i = 0; i < n; i++) {
    // ── 1) Nakit getirisi (pozisyonsuz geçen süre ölü para değildir) ─────
    if (shares === 0) cash *= 1 + dailyCashRate(i);

    // ── 2) Açık pozisyonda stop/hedef — YALNIZCA bu barın kendi verisi ──
    if (shares > 0 && i > entryIndex) {
      const low = c.low[i];
      const high = c.high[i];
      const open = c.open[i];

      if (strategy.atrStop && atr) {
        const candidate = c.close[i - 1] - atr[i - 1] * strategy.atrStop.mult;
        if (Number.isFinite(candidate) && candidate > trailStop) trailStop = candidate;
      }
      const activeStop = Math.max(stopPrice, trailStop);

      // Kötümser sıra: aynı barda hem stop hem hedef görülürse stop varsayılır.
      let exitPrice = 0;
      let reason: ExitReason | null = null;
      if (activeStop > 0 && low <= activeStop) {
        exitPrice = Math.min(open, activeStop); // boşluklu açılışta gerçek fiyat
        reason = 'stop';
      } else if (targetPrice > 0 && high >= targetPrice) {
        exitPrice = Math.max(open, targetPrice);
        reason = 'target';
      }

      if (reason) {
        cash += sell(exitPrice);
        recordTrade(i, exitPrice, reason);
      }
    }

    // ── 3) Bar sonu değerleme ───────────────────────────────────────────
    if (shares > 0) {
      const value = c.close[i];
      const move = ((value - entryPrice) / entryPrice) * 100;
      if (move < mae) mae = move;
      if (move > mfe) mfe = move;
      inPosition[i] = 1;
      exposedBars++;
    }
    equity[i] = cash + shares * c.close[i];
    buyHold[i] = i < bhStart ? initialCash : bhShares * c.close[i];

    // ── 4) Sinyal → emir bir sonraki barın AÇILIŞINA yazılır ────────────
    const next = i + 1;
    if (i < warmup || next >= n) continue;

    if (shares > 0 && exitSignal?.[i]) {
      const price = c.open[next] * (1 - costs.slippageBps * BPS);
      cash += sell(price);
      recordTrade(next, price, 'signal');
    } else if (shares === 0 && entrySignal[i]) {
      const price = c.open[next] * (1 + costs.slippageBps * BPS);
      if (price > 0) {
        let want = Math.floor(cash / (price * (1 + costs.commissionBps * BPS)));
        if (costs.volumeCapPct > 0) {
          const cap = Math.floor((c.volume[next] * costs.volumeCapPct) / 100);
          if (cap < want) want = cap;
        }
        if (want > 0) {
          const notional = want * price;
          const fee = notional * costs.commissionBps * BPS;
          cash -= notional + fee;
          costPaid += fee + want * (price - c.open[next]);
          shares = want;
          entryPrice = price;
          entryIndex = next;
          mae = 0;
          mfe = 0;
          stopPrice = strategy.stopLossPct ? price * (1 - strategy.stopLossPct / 100) : 0;
          targetPrice = strategy.takeProfitPct ? price * (1 + strategy.takeProfitPct / 100) : 0;
          trailStop = 0;
        } else {
          skipped++;
        }
      }
    }
  }

  // Açık pozisyon son barın kapanışıyla kapatılır — sonuç "kâğıt üstünde" kalmasın.
  if (shares > 0) {
    const price = c.close[n - 1] * (1 - costs.slippageBps * BPS);
    cash += sell(price);
    recordTrade(n - 1, price, 'end');
    equity[n - 1] = cash;
  }

  return {
    equity,
    buyHold,
    inPosition,
    trades,
    exposurePct: n ? (exposedBars / n) * 100 : 0,
    costPaid,
    warmup,
    skippedByLiquidity: skipped,
    initialCash,
  };

  function sell(price: number): number {
    const notional = shares * price;
    const fee = notional * costs.commissionBps * BPS;
    costPaid += fee;
    return notional - fee;
  }

  function recordTrade(index: number, exitPrice: number, reason: ExitReason) {
    const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
    const feePct = costs.commissionBps * BPS * 100 * 2; // iki yön
    trades.push({
      entryIndex,
      exitIndex: index,
      entryTime: c.time[entryIndex],
      exitTime: c.time[index],
      entryPrice,
      exitPrice,
      shares,
      grossPct: gross,
      netPct: gross - feePct,
      costPct: feePct,
      maePct: mae,
      mfePct: mfe,
      bars: index - entryIndex,
      reason,
    });
    shares = 0;
    entryPrice = 0;
    entryIndex = -1;
    stopPrice = 0;
    targetPrice = 0;
    trailStop = 0;
  }
}

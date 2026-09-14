import { computeIndicators } from '../core/indicators/calc';
import { decodeBundle, type Bundle } from '../core/data/pack';
import { metricsFor, type ScreenRow } from '../core/screen/metrics';
import { pulseRow, summarizePulse, type PulseRow } from '../core/screen/pulse';
import { clusterSymbols, correlationMatrix } from '../core/stats/correlation';
import { runBacktest } from '../core/backtest/engine';
import { computeMetrics, type BacktestMetrics } from '../core/backtest/metrics';
import { validateStrategy } from '../core/backtest/validate';
import { warmupBars } from '../core/strategy/dsl';
import type { SymbolResult } from '../core/strategy/rank';
import { inspect } from '../core/data/health';
import { resample } from '../core/data/resample';
import { emaArr } from '../core/indicators/calc';
import { summarize } from '../core/stats/summary';
import { classifyRegimes, regimeBreakdown } from '../core/stats/regime';
import { trainModel } from '../core/ml/model';
import { trainPooled } from '../core/ml/pooled';
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * Worker'ın beyni — DOM'suz, `self`'siz saf fonksiyon fabrikası.
 * Böylece aynı kod hem gerçek Worker'da hem de testte (Worker olmadan) koşar.
 */
export function createHandler() {
  const bundles = new Map<string, Bundle>();

  return function handle(req: WorkerRequest): WorkerResponse {
    try {
      switch (req.type) {
        case 'init': {
          const bundle = decodeBundle(req.buffer);
          bundles.set(req.market, bundle);
          return { id: req.id, ok: true, type: 'init', symbols: bundle.names, bars: bundle.bars };
        }

        case 'screen': {
          const started = now();
          const bundle = need(bundles, req.market);
          const rows: ScreenRow[] = [];
          const to = Math.min(req.to, bundle.names.length);
          for (let i = req.from; i < to; i++) {
            const symbol = bundle.names[i];
            const candles = bundle.seriesOf(symbol);
            if (!candles) continue;
            const row = metricsFor(symbol, candles, req.params);
            if (row) rows.push(row);
          }
          return { id: req.id, ok: true, type: 'screen', rows, ms: now() - started };
        }

        case 'pulse': {
          const started = now();
          const bundle = need(bundles, req.market);
          const rows: PulseRow[] = [];
          for (const symbol of bundle.names) {
            const candles = bundle.seriesOf(symbol);
            if (!candles) continue;
            const row = pulseRow(symbol, candles, {
              window: req.window,
              minBars: req.minBars,
            });
            if (row) rows.push(row);
          }
          return {
            id: req.id,
            ok: true,
            type: 'pulse',
            rows,
            summary: summarizePulse(rows),
            ms: now() - started,
          };
        }

        case 'symbol': {
          const started = now();
          // Yeniden örnekleme + indikatör + özet + sağlık: hepsi burada.
          // Ana iş parçacığında yapıldığında zayıf makinede ~150 ms'lik tek
          // parça blok oluşturuyordu (ölçüldü).
          const resampled = resample(req.candles, req.tf);
          return {
            id: req.id,
            ok: true,
            type: 'symbol',
            candles: resampled,
            metrics: summarize(resampled, { realReturn: req.realReturn }),
            health: inspect(req.candles, { today: req.todayDay }),
            overlayValues: req.overlays.map((o) => emaArr(resampled.close, o.length)),
            // Panel kapalıyken hesaplanmıyor: 3650 barlık iki indikatör boşa iş.
            indicators: req.indicators ? computeIndicators(resampled, req.indicators) : undefined,
            ms: now() - started,
          };
        }

        case 'backtest': {
          const started = now();
          const candles = req.candles;
          const result = runBacktest(candles, req.strategy, req.options);
          const metrics = computeMetrics(result, candles);

          let badges: ReturnType<typeof validateStrategy>['badges'] = [];
          let report: Omit<ReturnType<typeof validateStrategy>, 'badges' | 'metrics'> | undefined;
          if (req.validate) {
            const validation = validateStrategy(candles, req.strategy, {
              ...req.options,
              ...req.validate,
            });
            badges = validation.badges;
            report = {
              walkForward: validation.walkForward,
              plateau: validation.plateau,
              permutation: validation.permutation,
              deflatedSharpe: validation.deflatedSharpe,
            };
          }

          // Rejim kırılımı worker'da: sınıflandırma barları bir kez tarar ve
          // ana iş parçacığı yalnızca dört satırlık özeti alır.
          const regimes = regimeBreakdown(result.trades, classifyRegimes(candles));

          return {
            id: req.id,
            ok: true,
            type: 'backtest',
            metrics,
            regimes,
            trades: result.trades,
            equity: result.equity,
            buyHold: result.buyHold,
            time: candles.time,
            warmup: result.warmup,
            badges,
            report,
            ms: now() - started,
          };
        }

        case 'model': {
          const started = now();
          // Etiketleme + 5 katman eğitim: saniyeler sürebilir, ana iş parçacığı
          // buna asla kilitlenmemeli.
          const { card, latest } = trainModel(req.candles, req.options);
          return { id: req.id, ok: true, type: 'model', card, latest, ms: now() - started };
        }

        case 'rank': {
          const started = now();
          const bundle = need(bundles, req.market);
          const to = Math.min(req.to, bundle.names.length);
          const results: Record<string, SymbolResult[]> = {};
          const skipped: Record<string, number> = {};

          for (const entry of req.strategies) {
            results[entry.id] = [];
            skipped[entry.id] = 0;
          }

          for (let i = req.from; i < to; i++) {
            const symbol = bundle.names[i];
            const candles = bundle.seriesOf(symbol);
            if (!candles) continue;
            for (const entry of req.strategies) {
              // Isınma pencereye sığmıyorsa sonuç ÜRETİLMEZ. Yarım ısınmış bir
              // EMA200 ile çıkan sayı, olmayan bir sonucu varmış gibi gösterir.
              if (candles.length - warmupBars(entry.strategy) < req.minUsableBars) {
                skipped[entry.id]++;
                continue;
              }
              const result = runBacktest(candles, entry.strategy, req.options);
              results[entry.id].push({
                symbol,
                metrics: computeMetrics(result, candles),
              });
            }
          }

          return { id: req.id, ok: true, type: 'rank', results, skipped, ms: now() - started };
        }

        case 'rankSeries': {
          const started = now();
          const metrics: Record<string, BacktestMetrics> = {};
          const skipped: string[] = [];
          for (const entry of req.strategies) {
            if (req.candles.length - warmupBars(entry.strategy) < req.minUsableBars) {
              skipped.push(entry.id);
              continue;
            }
            const result = runBacktest(req.candles, entry.strategy, req.options);
            metrics[entry.id] = computeMetrics(result, req.candles);
          }
          return {
            id: req.id,
            ok: true,
            type: 'rankSeries',
            symbol: req.symbol,
            metrics,
            skipped,
            bars: req.candles.length,
            ms: now() - started,
          };
        }

        case 'pooledModel': {
          const started = now();
          // Çok sembollü eğitim: en ağır iş. Ana iş parçacığı görmeyecek.
          const { card, used, skipped } = trainPooled(req.series, req.options);
          return {
            id: req.id,
            ok: true,
            type: 'pooledModel',
            card,
            used,
            skipped,
            ms: now() - started,
          };
        }

        case 'correlate': {
          const started = now();
          const bundle = need(bundles, req.market);
          const wanted = req.symbols?.length ? req.symbols : bundle.names;
          const symbols = wanted.filter((s) => bundle.names.includes(s));

          // Paketin ortak gün eksenindeki kapanışları, istenen sembol sırasıyla.
          const bars = bundle.bars;
          const close = new Float64Array(symbols.length * bars);
          symbols.forEach((symbol, s) => {
            const si = bundle.names.indexOf(symbol);
            for (let i = 0; i < bars; i++) close[s * bars + i] = bundle.closeAt(si, i);
          });

          const { matrix } = correlationMatrix(
            { symbols, bars, close },
            { lookback: req.lookback, minPairs: req.minPairs },
          );
          const clustered = clusterSymbols(matrix, symbols.length, req.threshold ?? 0.6);

          return {
            id: req.id,
            ok: true,
            type: 'correlate',
            symbols,
            matrix,
            order: clustered.order,
            clusterOf: clustered.clusterOf,
            clusters: clustered.count,
            ms: now() - started,
          };
        }
      }
    } catch (err) {
      return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

function need(bundles: Map<string, Bundle>, market: string): Bundle {
  const bundle = bundles.get(market);
  if (!bundle) throw new Error(`${market}: worker'a paket yüklenmedi (önce init)`);
  return bundle;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

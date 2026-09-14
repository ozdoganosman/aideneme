import type { ScreenParams, ScreenRow } from '../core/screen/metrics';
import type { PulseRow, PulseSummary } from '../core/screen/pulse';
import type { Strategy } from '../core/strategy/dsl';
import type { BacktestOptions, Trade } from '../core/backtest/engine';
import type { BacktestMetrics } from '../core/backtest/metrics';
import type { Badge, ValidationOptions, ValidationReport } from '../core/backtest/validate';
import type { Candles } from '../core/data/types';
import type { HealthReport } from '../core/data/health';
import type { Metric } from '../core/stats/summary';
import type { TF } from '../core/data/resample';

/**
 * Ana thread ↔ Worker sözleşmesi. Tek dosyada tutuluyor ki iki uç tip düzeyinde
 * bağlı kalsın: mesaj biçimi değişirse her iki taraf da derlenmez.
 */

export interface InitRequest {
  id: number;
  type: 'init';
  market: string;
  /** Paket dosyasının ham baytları (worker başına bir kopya). */
  buffer: ArrayBuffer;
}

export interface ScreenRequest {
  id: number;
  type: 'screen';
  market: string;
  params: ScreenParams;
  /** Bu worker'ın hesaplayacağı sembol aralığı [from, to). */
  from: number;
  to: number;
}

export interface CorrelateRequest {
  id: number;
  type: 'correlate';
  market: string;
  /** Son N barı kullan (0 = tümü). */
  lookback: number;
  minPairs?: number;
  /** Alt küme; verilmezse tüm semboller. */
  symbols?: string[];
  /** Kümeleme kesme eşiği (uzaklık = 1 − korelasyon). */
  threshold?: number;
}

export interface PulseRequest {
  id: number;
  type: 'pulse';
  market: string;
  /** Yeni zirve/dip penceresi (bar). */
  window?: number;
  minBars?: number;
}

export interface BacktestRequest {
  id: number;
  type: 'backtest';
  /** Sembolün tam geçmişi; ana iş parçacığından kopyalanarak gelir. */
  candles: Candles;
  strategy: Strategy;
  options: BacktestOptions;
  /** Doğrulama katmanı da çalıştırılsın mı (ağır). */
  validate?: ValidationOptions | false;
}

export interface SymbolRequest {
  id: number;
  type: 'symbol';
  /** Günlük seri (tam geçmiş). */
  candles: Candles;
  /** İstenen periyot; yeniden örnekleme worker'da yapılır. */
  tf: TF;
  /** Hesaplanacak EMA benzeri örtüler. */
  overlays: { key: string; length: number }[];
  /** Bugün (epoch gün) — sağlık raporu saf kalsın diye dışarıdan gelir. */
  todayDay: number;
  /** TL bazlı piyasada reel getiri metriği eklensin mi. */
  realReturn: boolean;
}

export type WorkerRequest =
  InitRequest | ScreenRequest | CorrelateRequest | PulseRequest | BacktestRequest | SymbolRequest;

export interface InitResponse {
  id: number;
  ok: true;
  type: 'init';
  symbols: string[];
  bars: number;
}

export interface ScreenResponse {
  id: number;
  ok: true;
  type: 'screen';
  rows: ScreenRow[];
  /** Worker'da geçen süre (ms) — performans bütçesi bunun üstünden ölçülür. */
  ms: number;
}

export interface CorrelateResponse {
  id: number;
  ok: true;
  type: 'correlate';
  symbols: string[];
  matrix: Float64Array;
  order: number[];
  clusterOf: number[];
  clusters: number;
  ms: number;
}

export interface ErrorResponse {
  id: number;
  ok: false;
  error: string;
}

export interface PulseResponse {
  id: number;
  ok: true;
  type: 'pulse';
  rows: PulseRow[];
  summary: PulseSummary;
  ms: number;
}

export interface BacktestResponse {
  id: number;
  ok: true;
  type: 'backtest';
  metrics: BacktestMetrics;
  trades: Trade[];
  /** Sermaye eğrisi ve al-tut karşılaştırması (bar başına). */
  equity: Float64Array;
  buyHold: Float64Array;
  time: Float64Array;
  warmup: number;
  badges: Badge[];
  report?: Omit<ValidationReport, 'badges' | 'metrics'>;
  ms: number;
}

export interface SymbolResponse {
  id: number;
  ok: true;
  type: 'symbol';
  /** Periyoda indirgenmiş seri — grafik bunu çizer. */
  candles: Candles;
  metrics: Metric[];
  health: HealthReport;
  /** overlays isteğiyle aynı sırada. */
  overlayValues: Float64Array[];
  ms: number;
}

export type WorkerResponse =
  | InitResponse
  | SymbolResponse
  | ScreenResponse
  | CorrelateResponse
  | PulseResponse
  | BacktestResponse
  | ErrorResponse;

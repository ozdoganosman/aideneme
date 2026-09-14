import type { ScreenParams, ScreenRow } from '../core/screen/metrics';
import type { PulseRow, PulseSummary } from '../core/screen/pulse';
import type { Strategy } from '../core/strategy/dsl';
import type { BacktestOptions, Trade } from '../core/backtest/engine';
import type { BacktestMetrics } from '../core/backtest/metrics';
import type { Badge, ValidationOptions, ValidationReport } from '../core/backtest/validate';
import type { Candles } from '../core/data/types';
import type { HealthReport } from '../core/data/health';
import type { Metric } from '../core/stats/summary';
import type { RegimeBreakdown } from '../core/stats/regime';
import type { TF } from '../core/data/resample';
import type { ModelCard, TrainRequest } from '../core/ml/model';
import type { PooledRequest } from '../core/ml/pooled';
import type { SymbolResult } from '../core/strategy/rank';

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

export interface ModelRequest {
  id: number;
  type: 'model';
  /** Sembolün tam günlük geçmişi. */
  candles: Candles;
  options: TrainRequest;
}

export interface RankRequest {
  id: number;
  type: 'rank';
  market: string;
  /** Denenecek stratejiler; kimlik sonuçları eşlemek için. */
  strategies: { id: string; strategy: Strategy }[];
  options: BacktestOptions;
  /** Bu worker'ın hesaplayacağı sembol aralığı [from, to). */
  from: number;
  to: number;
  /** Isınma sonrası en az kaç bar kalmalı; altına düşen sembol ÖLÇÜLMEZ. */
  minUsableBars: number;
}

export interface RankSeriesRequest {
  id: number;
  type: 'rankSeries';
  /** Tek sembolün tam geçmişi; tüm stratejiler bunun üstünde koşar. */
  candles: Candles;
  symbol: string;
  strategies: { id: string; strategy: Strategy }[];
  options: BacktestOptions;
  minUsableBars: number;
}

export interface PooledModelRequest {
  id: number;
  type: 'pooledModel';
  /** Havuza girecek semboller ve tam geçmişleri. */
  series: { symbol: string; candles: Candles }[];
  options: PooledRequest;
}

export type WorkerRequest =
  | InitRequest
  | ScreenRequest
  | CorrelateRequest
  | PulseRequest
  | BacktestRequest
  | SymbolRequest
  | ModelRequest
  | RankRequest
  | RankSeriesRequest
  | PooledModelRequest;

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
  /** İşlemlerin giriş barındaki piyasa rejimine göre kırılımı. */
  regimes: RegimeBreakdown;
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

export interface ModelResponse {
  id: number;
  ok: true;
  type: 'model';
  card: ModelCard;
  /** Kart 'kullanma' derse null gelir — UI'da gösterilecek tahmin yoktur. */
  latest: { day: number; probability: number } | null;
  ms: number;
}

export interface RankResponse {
  id: number;
  ok: true;
  type: 'rank';
  /** Strateji kimliği → bu aralıktaki sembol sonuçları. */
  results: Record<string, SymbolResult[]>;
  /** Isınma sığmadığı için ölçülemeyen sembol sayısı (strateji kimliğine göre). */
  skipped: Record<string, number>;
  ms: number;
}

export interface RankSeriesResponse {
  id: number;
  ok: true;
  type: 'rankSeries';
  symbol: string;
  /** Strateji kimliği → metrikler; ısınma sığmayan strateji listede YOKTUR. */
  metrics: Record<string, BacktestMetrics>;
  skipped: string[];
  bars: number;
  ms: number;
}

export interface PooledModelResponse {
  id: number;
  ok: true;
  type: 'pooledModel';
  card: ModelCard;
  used: string[];
  skipped: { symbol: string; reason: string }[];
  ms: number;
}

export type WorkerResponse =
  | InitResponse
  | SymbolResponse
  | ScreenResponse
  | CorrelateResponse
  | PulseResponse
  | BacktestResponse
  | ModelResponse
  | RankResponse
  | RankSeriesResponse
  | PooledModelResponse
  | ErrorResponse;

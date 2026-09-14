import type { ScreenParams, ScreenRow } from '../core/screen/metrics';
import type { PulseRow, PulseSummary } from '../core/screen/pulse';

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

export type WorkerRequest = InitRequest | ScreenRequest | CorrelateRequest | PulseRequest;

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

export type WorkerResponse =
  InitResponse | ScreenResponse | CorrelateResponse | PulseResponse | ErrorResponse;

import type { ScreenParams, ScreenRow } from '../core/screen/metrics';
import type { Market } from '../data-client/markets';
import { createPool, type Pool, type WorkerLike } from './pool';
import type {
  BacktestResponse,
  SymbolResponse,
  CorrelateResponse,
  PulseResponse,
  WorkerResponse,
} from './protocol';
import type { Candles } from '../core/data/types';
import type { Strategy } from '../core/strategy/dsl';
import type { BacktestOptions } from '../core/backtest/engine';
import type { ValidationOptions } from '../core/backtest/validate';

/**
 * Uygulamanın analiz servisi: paketi bir kez indirir, worker'lara dağıtır,
 * tarama işini sembol aralıklarına bölerek paralel çalıştırır.
 */

export interface AnalysisClientOptions {
  /** Worker sayısı; varsayılan: çekirdek sayısı − 1 (en az 1, en çok 4). */
  size?: number;
  /** Test için: gerçek Worker yerine sahte. */
  spawn?: () => WorkerLike;
}

export interface ScreenOutcome {
  rows: ScreenRow[];
  /** En yavaş worker'ın süresi (ms) — paralel duvar saati yaklaşımı. */
  ms: number;
}

export type CorrelateOutcome = Omit<CorrelateResponse, 'id' | 'ok' | 'type'>;
export type PulseOutcome = Omit<PulseResponse, 'id' | 'ok' | 'type'>;
export type BacktestOutcome = Omit<BacktestResponse, 'id' | 'ok' | 'type'>;
export type SymbolOutcome = Omit<SymbolResponse, 'id' | 'ok' | 'type'>;

function defaultSize(): number {
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4;
  return Math.max(1, Math.min(4, cores - 1));
}

function defaultSpawn(): WorkerLike {
  return new Worker(new URL('./analysis.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

export class AnalysisClient {
  private readonly pool: Pool;
  private readonly loaded = new Map<Market, { symbols: string[]; bars: number }>();

  constructor(options: AnalysisClientOptions = {}) {
    this.pool = createPool(options.size ?? defaultSize(), options.spawn ?? defaultSpawn);
  }

  get size(): number {
    return this.pool.size;
  }

  /** Paketi tüm worker'lara yükler (her birine kendi kopyası gider). */
  async load(market: Market, buffer: ArrayBuffer): Promise<{ symbols: string[]; bars: number }> {
    const responses = await this.pool.broadcast((id) => ({
      id,
      type: 'init',
      market,
      // Her worker kendi kopyasını almalı: aktarılan (transfer) tampon
      // gönderende boşalır, ikinci worker'a gönderilecek bir şey kalmazdı.
      buffer: buffer.slice(0),
    }));
    const first = unwrap(responses[0]);
    if (first.type !== 'init') throw new Error('beklenmeyen yanıt');
    const info = { symbols: first.symbols, bars: first.bars };
    this.loaded.set(market, info);
    return info;
  }

  isLoaded(market: Market): boolean {
    return this.loaded.has(market);
  }

  /** Tüm sembolleri worker'lara bölerek tarar. */
  async screen(market: Market, params: ScreenParams): Promise<ScreenOutcome> {
    const info = this.loaded.get(market);
    if (!info) throw new Error(`${market}: paket yüklenmedi`);

    const total = info.symbols.length;
    const chunks = Math.min(this.pool.size, Math.max(1, Math.ceil(total / 25)));
    const per = Math.ceil(total / chunks);

    const responses = await Promise.all(
      Array.from({ length: chunks }, (_, i) =>
        this.pool.run((id) => ({
          id,
          type: 'screen',
          market,
          params,
          from: i * per,
          to: Math.min(total, (i + 1) * per),
        })),
      ),
    );

    const rows: ScreenRow[] = [];
    let ms = 0;
    for (const response of responses) {
      const ok = unwrap(response);
      if (ok.type !== 'screen') continue;
      rows.push(...ok.rows);
      ms = Math.max(ms, ok.ms);
    }
    return { rows, ms };
  }

  /**
   * Tek sembolde backtest (+ istenirse doğrulama katmanı).
   * Mumlar ana iş parçacığından kopyalanarak gider; worker'daki paket 250 barla
   * sınırlı, backtest ise tam geçmişi ister.
   */
  async backtest(
    candles: Candles,
    strategy: Strategy,
    options: BacktestOptions = {},
    validate: ValidationOptions | false = false,
  ): Promise<BacktestOutcome> {
    const response = unwrap(
      await this.pool.run((id) => ({ id, type: 'backtest', candles, strategy, options, validate })),
    );
    if (response.type !== 'backtest') throw new Error('beklenmeyen yanıt');
    const { id: _id, ok: _ok, type: _type, ...rest } = response;
    return rest;
  }

  /** Sembol analizi: periyot dönüşümü + indikatör + özet + veri sağlığı. */
  async symbol(
    candles: import('../core/data/types').Candles,
    options: {
      tf: import('../core/data/resample').TF;
      overlays: { key: string; length: number }[];
      todayDay: number;
      realReturn: boolean;
    },
  ): Promise<SymbolOutcome> {
    const response = unwrap(
      await this.pool.run((id) => ({ id, type: 'symbol', candles, ...options })),
    );
    if (response.type !== 'symbol') throw new Error('beklenmeyen yanıt');
    const { id: _id, ok: _ok, type: _type, ...rest } = response;
    return rest;
  }

  /** Piyasa nabzı: genişlik + para akışı (tek worker). */
  async pulse(
    market: Market,
    options: { window?: number; minBars?: number } = {},
  ): Promise<PulseOutcome> {
    const response = unwrap(
      await this.pool.run((id) => ({
        id,
        type: 'pulse',
        market,
        window: options.window,
        minBars: options.minBars,
      })),
    );
    if (response.type !== 'pulse') throw new Error('beklenmeyen yanıt');
    const { id: _id, ok: _ok, type: _type, ...rest } = response;
    return rest;
  }

  /** Korelasyon + kümeleme (tek worker; matris aktarılarak döner). */
  async correlate(
    market: Market,
    options: { lookback?: number; symbols?: string[]; threshold?: number; minPairs?: number } = {},
  ): Promise<CorrelateOutcome> {
    const response = unwrap(
      await this.pool.run((id) => ({
        id,
        type: 'correlate',
        market,
        lookback: options.lookback ?? 0,
        minPairs: options.minPairs,
        symbols: options.symbols,
        threshold: options.threshold,
      })),
    );
    if (response.type !== 'correlate') throw new Error('beklenmeyen yanıt');
    const { id: _id, ok: _ok, type: _type, ...rest } = response;
    return rest;
  }

  terminate(): void {
    this.pool.terminate();
    this.loaded.clear();
  }
}

function unwrap(response: WorkerResponse) {
  if (!response.ok) throw new Error(response.error);
  return response;
}

import type { ScreenParams, ScreenRow } from '../core/screen/metrics';
import type { Market } from '../data-client/markets';
import { createPool, type Pool, type WorkerLike } from './pool';
import type { CorrelateResponse, WorkerResponse } from './protocol';

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

import type { ScreenParams, ScreenRow } from '../core/screen/metrics';
import type { SektorEslesmesi } from '../core/screen/sectorIndices';
import type { Market } from '../data-client/markets';
import { createPool, type Pool, type WorkerLike } from './pool';
import type {
  BacktestResponse,
  ModelResponse,
  SymbolResponse,
  CorrelateResponse,
  PulseResponse,
  WorkerResponse,
} from './protocol';
import type { Candles } from '../core/data/types';
import type { Strategy } from '../core/strategy/dsl';
import type { BacktestOptions } from '../core/backtest/engine';
import type { ValidationOptions } from '../core/backtest/validate';
import type { SymbolResult } from '../core/strategy/rank';

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
export type ModelOutcome = Omit<ModelResponse, 'id' | 'ok' | 'type'>;

function defaultSize(): number {
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4;
  return Math.max(1, Math.min(4, cores - 1));
}

function defaultSpawn(): WorkerLike {
  try {
    return new Worker(new URL('./analysis.worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as WorkerLike;
  } catch (err) {
    // Ham istisna ("Worker blocked", "SecurityError") kullanıcıya hiçbir şey
    // anlatmıyor. Analiz worker OLMADAN yapılamıyor; bunu alan diliyle
    // söylüyoruz ki kullanıcı nedenini arayabilsin.
    throw new Error(
      'Bu tarayıcıda arka plan işçisi (Web Worker) başlatılamadı; analiz çalıştırılamıyor. ' +
        'Katı bir içerik güvenliği politikası ya da bir tarayıcı eklentisi engelliyor olabilir. ' +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
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
    const responses = await this.pool.broadcast(
      (id) => ({
        id,
        type: 'init',
        market,
        // Her worker kendi kopyasını almalı: aktarılan (transfer) tampon
        // gönderende boşalır, ikinci worker'a gönderilecek bir şey kalmazdı.
        buffer: buffer.slice(0),
      }),
      // Kopya AKTARILIYOR, klonlanmıyor. Aktarım olmadan `postMessage` her
      // worker için tamponu BİR KEZ DAHA kopyalar: üç worker'da 3 dilim + 3
      // klon = paketin altı kopyası ana iş parçacığında. BIST paketi 3 MB;
      // zayıf makinede bu, radar açılışındaki en pahalı iş. Dilim zaten bu
      // worker'a özel, aktarmak kimseyi boşaltmıyor.
      (req) => (req.type === 'init' ? [req.buffer] : []),
    );
    const first = unwrap(responses[0]);
    if (first.type !== 'init') throw new Error('beklenmeyen yanıt');
    const info = { symbols: first.symbols, bars: first.bars };
    this.loaded.set(market, info);
    return info;
  }

  isLoaded(market: Market): boolean {
    return this.loaded.has(market);
  }

  /**
   * Her hissenin en çok birlikte hareket ettiği sektör endeksi.
   *
   * TEK worker'da: iş bölünebilir değil (her hisse tüm endekslere bakıyor) ve
   * endeks paketini üç worker'a dağıtmak kazandığından çok kopyalama maliyeti
   * getirirdi. Ölçüldü: 599 hisse × 23 endeks 246 ms — worker'da olduğu için
   * ana iş parçacığı bu sürede serbest.
   */
  async sectorMatch(
    market: Market,
    indexBuffer: ArrayBuffer,
    esik?: number,
  ): Promise<{ matches: SektorEslesmesi[]; evaluated: number; ms: number }> {
    if (!this.loaded.has(market)) throw new Error(`${market}: paket yüklenmedi`);
    const res = await this.pool.run(
      (id) => ({ id, type: 'sectorMatch', market, indexBuffer: indexBuffer.slice(0), esik }),
      (req) => (req.type === 'sectorMatch' ? [req.indexBuffer] : []),
    );
    const out = unwrap(res);
    if (out.type !== 'sectorMatch') throw new Error('beklenmeyen yanıt');
    return { matches: out.matches, evaluated: out.evaluated, ms: out.ms };
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
      /** Verilmezse indikatörler hesaplanmıyor (panel kapalı). */
      indicators?: import('../core/indicators/calc').IndicatorParams;
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

  /**
   * Piyasa geneli strateji sıralaması: her sembolde her strateji, worker'lara
   * sembol aralığına göre bölünerek. Sonuçlar strateji kimliğinde birleşir.
   */
  async rank(
    market: Market,
    strategies: { id: string; strategy: Strategy }[],
    options: BacktestOptions = {},
    minUsableBars = 60,
  ): Promise<{
    results: Record<string, SymbolResult[]>;
    skipped: Record<string, number>;
    symbols: number;
    ms: number;
  }> {
    const info = this.loaded.get(market);
    if (!info) throw new Error(`${market}: paket yüklenmedi`);

    const total = info.symbols.length;
    const chunks = Math.min(this.pool.size, Math.max(1, Math.ceil(total / 25)));
    const per = Math.ceil(total / chunks);

    const responses = await Promise.all(
      Array.from({ length: chunks }, (_, i) =>
        this.pool.run((id) => ({
          id,
          type: 'rank',
          market,
          strategies,
          options,
          minUsableBars,
          from: i * per,
          to: Math.min(total, (i + 1) * per),
        })),
      ),
    );

    const results: Record<string, SymbolResult[]> = {};
    const skipped: Record<string, number> = {};
    let ms = 0;
    for (const response of responses) {
      const ok = unwrap(response);
      if (ok.type !== 'rank') continue;
      for (const [key, rows] of Object.entries(ok.results)) {
        (results[key] ??= []).push(...rows);
      }
      for (const [key, count] of Object.entries(ok.skipped)) {
        skipped[key] = (skipped[key] ?? 0) + count;
      }
      ms = Math.max(ms, ok.ms);
    }
    return { results, skipped, symbols: total, ms };
  }

  /** Tek sembolün tam geçmişinde tüm stratejiler (derin tarama adımı). */
  async rankSeries(
    symbol: string,
    candles: import('../core/data/types').Candles,
    strategies: { id: string; strategy: Strategy }[],
    options: BacktestOptions = {},
    minUsableBars = 60,
  ): Promise<{
    symbol: string;
    metrics: Record<string, import('../core/backtest/metrics').BacktestMetrics>;
    skipped: string[];
    bars: number;
    ms: number;
  }> {
    const response = unwrap(
      await this.pool.run((id) => ({
        id,
        type: 'rankSeries',
        symbol,
        candles,
        strategies,
        options,
        minUsableBars,
      })),
    );
    if (response.type !== 'rankSeries') throw new Error('beklenmeyen yanıt');
    const { id: _id, ok: _ok, type: _type, ...rest } = response;
    return rest;
  }

  /** Model kartı: üçlü bariyer etiketleme + purged CV + kalibrasyon. */
  async model(
    candles: import('../core/data/types').Candles,
    options: import('../core/ml/model').TrainRequest = {},
  ): Promise<ModelOutcome> {
    const response = unwrap(await this.pool.run((id) => ({ id, type: 'model', candles, options })));
    if (response.type !== 'model') throw new Error('beklenmeyen yanıt');
    const { id: _id, ok: _ok, type: _type, ...rest } = response;
    return rest;
  }

  /** Havuzlanmış (kesitsel) model: çok sembolün örnekleri tek havuzda. */
  async pooledModel(
    series: { symbol: string; candles: import('../core/data/types').Candles }[],
    options: import('../core/ml/pooled').PooledRequest = {},
  ): Promise<{
    card: import('../core/ml/model').ModelCard;
    used: string[];
    skipped: { symbol: string; reason: string }[];
    ms: number;
  }> {
    const response = unwrap(
      await this.pool.run((id) => ({ id, type: 'pooledModel', series, options })),
    );
    if (response.type !== 'pooledModel') throw new Error('beklenmeyen yanıt');
    const { id: _id, ok: _ok, type: _type, ...rest } = response;
    return rest;
  }

  /** Piyasa nabzı: genişlik + para akışı (tek worker). */
  async pulse(
    market: Market,
    options: { window?: number; minBars?: number; rotationBars?: number } = {},
  ): Promise<PulseOutcome> {
    const response = unwrap(
      await this.pool.run((id) => ({
        id,
        type: 'pulse',
        market,
        window: options.window,
        minBars: options.minBars,
        rotationBars: options.rotationBars,
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

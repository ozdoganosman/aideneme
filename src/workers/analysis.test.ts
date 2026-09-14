import { describe, expect, it } from 'vitest';
import { AnalysisClient } from './analysisClient';
import { createHandler } from './handler';
import { createPool, type WorkerLike } from './pool';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { DEFAULT_SCREEN_PARAMS } from '../core/screen/metrics';
import { encodeBundle } from '../core/data/pack';

/** Deterministik sentetik paket: n sembol × bars bar. */
function buildBundle(n: number, bars: number, seed = 3): ArrayBuffer {
  const symbols = Array.from({ length: n }, (_, i) => `S${String(i).padStart(3, '0')}`);
  const days = Int32Array.from({ length: bars }, (_, i) => 20000 + i);
  const cells = n * bars;
  const columns = {
    open: new Float32Array(cells),
    high: new Float32Array(cells),
    low: new Float32Array(cells),
    close: new Float32Array(cells),
    volume: new Float32Array(cells),
  };
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
  for (let sym = 0; sym < n; sym++) {
    let price = 10 + sym * 0.5;
    for (let i = 0; i < bars; i++) {
      price = Math.max(1, price * (1 + rnd() * 0.04 + 0.0005));
      const cell = sym * bars + i;
      columns.open[cell] = price;
      columns.high[cell] = price * 1.01;
      columns.low[cell] = price * 0.99;
      columns.close[cell] = price;
      columns.volume[cell] = 1_000_000 + i;
    }
  }
  return encodeBundle({ symbols, days, columns });
}

/** Gerçek Worker yerine: aynı handler'ı asenkron çalıştıran sahte. */
function fakeWorker(): WorkerLike {
  const handle = createHandler();
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(message) {
      const response = handle(message as WorkerRequest);
      queueMicrotask(() => worker.onmessage?.({ data: response }));
    },
    terminate() {},
  };
  return worker;
}

describe('handler', () => {
  it('init → screen → correlate akışı', () => {
    const handle = createHandler();
    const buffer = buildBundle(12, 120);

    const init = handle({ id: 1, type: 'init', market: 'bist', buffer });
    expect(init.ok && init.type === 'init' && init.symbols).toHaveLength(12);

    const screen = handle({
      id: 2,
      type: 'screen',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      from: 0,
      to: 12,
    });
    expect(screen.ok).toBe(true);
    if (screen.ok && screen.type === 'screen') {
      expect(screen.rows).toHaveLength(12);
      expect(Number.isFinite(screen.rows[0].values.rsi)).toBe(true);
    }

    const corr = handle({ id: 3, type: 'correlate', market: 'bist', lookback: 0 });
    expect(corr.ok).toBe(true);
    if (corr.ok && corr.type === 'correlate') {
      expect(corr.matrix).toHaveLength(12 * 12);
      expect(corr.order).toHaveLength(12);
      expect(corr.clusters).toBeGreaterThan(0);
    }
  });

  it('paket yüklenmeden tarama isteği anlaşılır hata döner', () => {
    const handle = createHandler();
    const response = handle({
      id: 1,
      type: 'screen',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      from: 0,
      to: 10,
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toMatch(/paket yüklenmedi/);
  });

  it('aralık paketin dışına taşsa da çökmez', () => {
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(5, 80) });
    const response = handle({
      id: 2,
      type: 'screen',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      from: 3,
      to: 999,
    });
    expect(response.ok && response.type === 'screen' && response.rows).toHaveLength(2);
  });
});

describe('pool', () => {
  it('işleri boştaki worker’lara dağıtır ve sırayı korur', async () => {
    const pool = createPool(3, fakeWorker);
    const buffer = buildBundle(9, 100);
    await pool.broadcast((id) => ({ id, type: 'init', market: 'bist', buffer: buffer.slice(0) }));

    const responses = await Promise.all(
      [0, 3, 6].map((from) =>
        pool.run((id) => ({
          id,
          type: 'screen',
          market: 'bist',
          params: DEFAULT_SCREEN_PARAMS,
          from,
          to: from + 3,
        })),
      ),
    );
    const rows = responses.flatMap((r: WorkerResponse) =>
      r.ok && r.type === 'screen' ? r.rows : [],
    );
    expect(rows).toHaveLength(9);
    pool.terminate();
  });

  it('havuz doluyken istekler kuyruğa alınır', async () => {
    const pool = createPool(1, fakeWorker);
    const buffer = buildBundle(6, 100);
    await pool.broadcast((id) => ({ id, type: 'init', market: 'bist', buffer: buffer.slice(0) }));

    const results = await Promise.all(
      [0, 2, 4].map((from) =>
        pool.run((id) => ({
          id,
          type: 'screen',
          market: 'bist',
          params: DEFAULT_SCREEN_PARAMS,
          from,
          to: from + 2,
        })),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    pool.terminate();
  });
});

describe('AnalysisClient', () => {
  it('paketi tüm worker’lara yükler ve taramayı böler', async () => {
    const client = new AnalysisClient({ size: 3, spawn: fakeWorker });
    const info = await client.load('bist', buildBundle(60, 120));
    expect(info.symbols).toHaveLength(60);
    expect(client.isLoaded('bist')).toBe(true);

    const { rows } = await client.screen('bist', DEFAULT_SCREEN_PARAMS);
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map((r) => r.symbol)).size).toBe(60); // çakışma/tekrar yok
    client.terminate();
  });

  it('yüklenmemiş piyasa için açık hata verir', async () => {
    const client = new AnalysisClient({ size: 1, spawn: fakeWorker });
    await expect(client.screen('us', DEFAULT_SCREEN_PARAMS)).rejects.toThrow(/yüklenmedi/);
    client.terminate();
  });

  it('korelasyon sonucu sembol sırası ve küme kimlikleriyle döner', async () => {
    const client = new AnalysisClient({ size: 2, spawn: fakeWorker });
    await client.load('bist', buildBundle(20, 200));
    const result = await client.correlate('bist', { lookback: 150 });
    expect(result.symbols).toHaveLength(20);
    expect(result.order).toHaveLength(20);
    expect(result.clusterOf).toHaveLength(20);
    client.terminate();
  });
});

describe('performans bütçesi', () => {
  it('603 sembol × 250 bar taraması tek iş parçacığında 1 sn altında', () => {
    // Kabul ölçütü (plan §7, Faz 3): 603 sembol taraması ≤ 1 sn. Test tek
    // handler ile ölçer — gerçek uygulamada iş worker'lara bölünür, yani bu
    // üst sınırdır.
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(603, 250) });

    const started = performance.now();
    const response = handle({
      id: 2,
      type: 'screen',
      market: 'bist',
      params: DEFAULT_SCREEN_PARAMS,
      from: 0,
      to: 603,
    });
    const elapsed = performance.now() - started;

    expect(response.ok && response.type === 'screen' && response.rows).toHaveLength(603);
    expect(elapsed).toBeLessThan(1000);
  });

  it('603 sembol korelasyon + hiyerarşik kümeleme 3 sn altında', () => {
    // Tam matris 603² çift × 250 getiri + ortalama bağlantılı kümeleme.
    // Ölçüm ~0,5 sn; bütçe, yavaş makinede de worker'ı kilitlememesi için 3 sn.
    const handle = createHandler();
    handle({ id: 1, type: 'init', market: 'bist', buffer: buildBundle(603, 250) });

    const started = performance.now();
    const response = handle({ id: 2, type: 'correlate', market: 'bist', lookback: 0 });
    const elapsed = performance.now() - started;

    expect(response.ok).toBe(true);
    if (response.ok && response.type === 'correlate') {
      expect(response.order).toHaveLength(603);
      expect(response.clusters).toBeGreaterThan(0);
    }
    expect(elapsed).toBeLessThan(3000);
  });
});

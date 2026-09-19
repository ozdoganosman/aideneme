import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataClient } from './client';
import { memoryCache } from './cache';
import { encodeSeries } from '../core/data/pack';
import { emptyCandles, type Candles } from '../core/data/types';
import { DAY_SECONDS } from '../core/data/pack';

function sample(n: number, base = 10): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    c.time[i] = (20000 + i) * DAY_SECONDS;
    c.open[i] = base + i;
    c.high[i] = base + i + 1;
    c.low[i] = base + i - 1;
    c.close[i] = base + i + 0.5;
    c.volume[i] = 1000;
  }
  return c;
}

function manifestFor(hash: string, bytes: number) {
  return {
    version: 1,
    market: 'bist',
    generated: 1_757_800_000,
    symbols: { THYAO: { f: 'THYAO.bin', n: 5, d0: 20000, d1: 20004, b: bytes, h: hash } },
  };
}

/** fetch kurgusu: JSON ve ikili yanıtları sayar. */
function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response(null, { status: 404 });
    const body = routes[key];
    if (body instanceof ArrayBuffer) return new Response(body, { status: 200 });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('DataClient', () => {
  it('manifest + ikili dosyayı indirir ve çözer', async () => {
    const bin = encodeSeries(sample(5));
    const { impl, calls } = stubFetch({
      'manifest.json': manifestFor('aaaa1111', bin.byteLength),
      'THYAO.bin': bin,
    });
    const client = new DataClient({ fetchImpl: impl, cache: memoryCache() });

    const { candles, fromCache } = await client.series('bist', 'THYAO');
    expect(candles.length).toBe(5);
    expect(fromCache).toBe(false);
    expect(calls.some((u) => u.includes('THYAO.bin?h=aaaa1111'))).toBe(true);
  });

  it('ikinci istekte ağa çıkmaz (önbellek hash ile)', async () => {
    const bin = encodeSeries(sample(5));
    const { impl } = stubFetch({
      'manifest.json': manifestFor('aaaa1111', bin.byteLength),
      'THYAO.bin': bin,
    });
    const cache = memoryCache();
    const client = new DataClient({ fetchImpl: impl, cache });

    await client.series('bist', 'THYAO');
    const before = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const second = await client.series('bist', 'THYAO');

    expect(second.fromCache).toBe(true);
    expect((impl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });

  it('hash değişince yeniden indirir ve eski sürümü atar', async () => {
    const cache = memoryCache();
    const oldBin = encodeSeries(sample(5, 10));
    const first = stubFetch({
      'manifest.json': manifestFor('aaaa1111', oldBin.byteLength),
      'THYAO.bin': oldBin,
    });
    await new DataClient({ fetchImpl: first.impl, cache }).series('bist', 'THYAO');

    const newBin = encodeSeries(sample(5, 99));
    const second = stubFetch({
      'manifest.json': manifestFor('bbbb2222', newBin.byteLength),
      'THYAO.bin': newBin,
    });
    const result = await new DataClient({ fetchImpl: second.impl, cache }).series('bist', 'THYAO');

    expect(result.fromCache).toBe(false);
    expect(result.candles.close[0]).toBeCloseTo(99.5, 4);
    expect(await cache.get('bist/THYAO.bin@aaaa1111')).toBeNull(); // eski sürüm atıldı
  });

  it('bilinmeyen sembol anlaşılır hata verir', async () => {
    const { impl } = stubFetch({ 'manifest.json': manifestFor('aaaa1111', 0) });
    const client = new DataClient({ fetchImpl: impl, cache: memoryCache() });
    await expect(client.series('bist', 'YOKKI')).rejects.toThrow(/bu piyasada yok/);
  });

  it('bozuk manifest reddedilir ve tekrar denenebilir', async () => {
    const { impl } = stubFetch({ 'manifest.json': { version: 99 } });
    const client = new DataClient({ fetchImpl: impl, cache: memoryCache() });
    await expect(client.manifest('bist')).rejects.toThrow(/biçimi tanınmadı/);
    await expect(client.manifest('bist')).rejects.toThrow(/biçimi tanınmadı/); // memoize edilmedi
  });

  it('HTTP hatası sayısıyla bildirilir', async () => {
    const { impl } = stubFetch({});
    const client = new DataClient({ fetchImpl: impl, cache: memoryCache() });
    await expect(client.manifest('bist')).rejects.toThrow(/HTTP 404/);
  });

  it('paket ikinci ziyarette ağa ÇIKMADAN önbellekten gelir', async () => {
    // Kabuk kendi fetch'ini yazdığı sürece 1 MB'lık paket her ziyarette
    // yeniden iniyordu; ölçüldü ve öyleydi (yavaş 3G'de 24 sn → 3 sn).
    const bin = readFileSync(join(__dirname, '../core/data/__fixtures__/bundle-6.bin'));
    // DİKKAT: Node'un Buffer'ı kendi realm'ındaki ArrayBuffer'ı taşır; jsdom
    // altında `instanceof ArrayBuffer` YANLIŞ döner ve kurgu onu JSON sanar.
    // Test realm'ında yeniden kurmak gerekiyor.
    const buf = new Uint8Array(bin).buffer;
    const manifest = {
      ...manifestFor('aaaa1111', buf.byteLength),
      bundle: { file: 'latest-250.bin', bars: 6, bytes: buf.byteLength, hash: 'bbbb2222' },
    };
    const { impl, calls } = stubFetch({ 'manifest.json': manifest, 'latest-250.bin': buf });
    const cache = memoryCache();

    const first = await new DataClient({ fetchImpl: impl, cache }).bundleBuffer('bist');
    expect(first.fromCache).toBe(false);
    expect(first.buffer.byteLength).toBe(buf.byteLength);

    // Yeni istemci, AYNI önbellek: tarayıcının yeniden açılmasına karşılık gelir.
    const before = calls.filter((u) => u.includes('latest-250.bin')).length;
    const second = await new DataClient({ fetchImpl: impl, cache }).bundleBuffer('bist');
    expect(second.fromCache).toBe(true);
    expect(calls.filter((u) => u.includes('latest-250.bin')).length).toBe(before);
  });

  it('ilerleme geri çağrısı akış yoksa da çalışır', async () => {
    const bin = readFileSync(join(__dirname, '../core/data/__fixtures__/bundle-6.bin'));
    // DİKKAT: Node'un Buffer'ı kendi realm'ındaki ArrayBuffer'ı taşır; jsdom
    // altında `instanceof ArrayBuffer` YANLIŞ döner ve kurgu onu JSON sanar.
    // Test realm'ında yeniden kurmak gerekiyor.
    const buf = new Uint8Array(bin).buffer;
    const manifest = {
      ...manifestFor('aaaa1111', buf.byteLength),
      bundle: { file: 'latest-250.bin', bars: 6, bytes: buf.byteLength, hash: 'bbbb2222' },
    };
    const { impl } = stubFetch({ 'manifest.json': manifest, 'latest-250.bin': buf });
    const client = new DataClient({ fetchImpl: impl, cache: memoryCache() });

    const seen: number[] = [];
    const out = await client.bundleBuffer('bist', undefined, (loaded) => seen.push(loaded));
    // Akış varsa ilerleme gelir, yoksa hiç gelmez; İKİ DURUMDA DA veri bütün.
    expect(out.buffer.byteLength).toBe(buf.byteLength);
    expect(seen.every((v) => v <= buf.byteLength)).toBe(true);
  });

  it('paket dosyası yoksa açıkça söyler', async () => {
    const { impl } = stubFetch({ 'manifest.json': manifestFor('aaaa1111', 0) });
    const client = new DataClient({ fetchImpl: impl, cache: memoryCache() });
    await expect(client.bundle('bist')).rejects.toThrow(/paket dosyası üretilmemiş/);
  });
});

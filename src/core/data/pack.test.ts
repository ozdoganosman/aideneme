import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, decodeBundle, decodeSeries, encodeSeries, isManifest } from './pack';
import { emptyCandles, type Candles } from './types';

const FIXTURES = join(__dirname, '__fixtures__');

function load(name: string): ArrayBuffer {
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

interface Expected {
  series: { symbol: string; rows: number[][] };
  bundle: { bars: number; names: string[]; axis: number[]; close: (number | null)[] };
}
const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')) as Expected;

/**
 * Bu testler iki dil arasındaki sözleşmeyi kilitler: dosyalar Python üreticisi
 * (scripts/pack_data.py --write-fixture) tarafından yazıldı, burada TypeScript
 * çözücüsüyle okunuyor. Bayt düzeni tek taraflı değişirse test kırılır.
 */
describe('decodeSeries (Python üretimi dosyaya karşı)', () => {
  const candles = decodeSeries(load('series-AAA.bin'));

  it('bar sayısı ve sıralaması aynı', () => {
    expect(candles.length).toBe(expected.series.rows.length);
    for (let i = 1; i < candles.length; i++) {
      expect(candles.time[i]).toBeGreaterThan(candles.time[i - 1]);
    }
  });

  it('gün epoch saniyeye çevrilir (UTC gece yarısı)', () => {
    expected.series.rows.forEach((row, i) => {
      expect(candles.time[i]).toBe(row[0] * DAY_SECONDS);
      expect(candles.time[i] % DAY_SECONDS).toBe(0);
    });
  });

  it('OHLCV değerleri float32 hassasiyetinde korunur', () => {
    expected.series.rows.forEach((row, i) => {
      const got = [
        candles.open[i],
        candles.high[i],
        candles.low[i],
        candles.close[i],
        candles.volume[i],
      ];
      row.slice(1).forEach((want, c) => {
        expect(got[c]).toBeCloseTo(want, 4);
      });
    });
  });
});

describe('decodeBundle (Python üretimi dosyaya karşı)', () => {
  const bundle = decodeBundle(load('bundle-6.bin'));

  it('sembol listesi ve gün ekseni aynı', () => {
    expect(bundle.names).toEqual(expected.bundle.names);
    expect(bundle.bars).toBe(expected.bundle.bars);
    expect(Array.from(bundle.days)).toEqual(expected.bundle.axis);
  });

  it('boş hücreler NaN — sıfır değil', () => {
    expected.bundle.close.forEach((want, cell) => {
      const si = Math.floor(cell / bundle.bars);
      const di = cell % bundle.bars;
      const got = bundle.closeAt(si, di);
      if (want === null) expect(Number.isNaN(got)).toBe(true);
      else expect(got).toBeCloseTo(want, 4);
    });
  });

  it('seriesOf boşlukları atar, doldurmaz', () => {
    const bb = bundle.seriesOf('BB');
    expect(bb).not.toBeNull();
    const wantCount = expected.bundle.close
      .slice(bundle.bars, bundle.bars * 2)
      .filter((v) => v !== null).length;
    expect(bb!.length).toBe(wantCount);
    for (let i = 0; i < bb!.length; i++) expect(Number.isFinite(bb!.close[i])).toBe(true);
  });

  it('bilinmeyen sembol null döner', () => {
    expect(bundle.seriesOf('YOK')).toBeNull();
  });
});

describe('encodeSeries ↔ decodeSeries', () => {
  function sample(n: number): Candles {
    const c = emptyCandles(n);
    for (let i = 0; i < n; i++) {
      c.time[i] = (20000 + i) * DAY_SECONDS;
      c.open[i] = 10 + i * 0.5;
      c.high[i] = 11 + i * 0.5;
      c.low[i] = 9 + i * 0.5;
      c.close[i] = 10.25 + i * 0.5;
      c.volume[i] = 1_000_000 + i;
    }
    return c;
  }

  it('gidiş-dönüş kayıpsız (float32 toleransında)', () => {
    const src = sample(64);
    const back = decodeSeries(encodeSeries(src));
    expect(back.length).toBe(src.length);
    for (let i = 0; i < src.length; i++) {
      expect(back.time[i]).toBe(src.time[i]);
      expect(back.close[i]).toBeCloseTo(src.close[i], 4);
      expect(back.volume[i] / src.volume[i]).toBeCloseTo(1, 6);
    }
  });

  it('boş seri de geçerli dosya üretir', () => {
    expect(decodeSeries(encodeSeries(emptyCandles(0))).length).toBe(0);
  });

  it('bar başına 24 bayt + 32 bayt başlık', () => {
    expect(encodeSeries(sample(100)).byteLength).toBe(32 + 100 * 24);
  });
});

describe('bozuk girdi', () => {
  it('yanlış sihirli sayı reddedilir', () => {
    expect(() => decodeSeries(new ArrayBuffer(64))).toThrow(/sihirli sayı/);
  });

  it('kesik dosya reddedilir', () => {
    const full = encodeSeries(emptyCandles(10));
    expect(() => decodeSeries(full.slice(0, 40))).toThrow(/bayt/);
  });

  it('bozuk manifest tanınmaz', () => {
    expect(isManifest({ version: 1, market: 'bist', generated: 1, symbols: {} })).toBe(true);
    expect(isManifest({ version: 99, market: 'bist', generated: 1, symbols: {} })).toBe(false);
    expect(isManifest(null)).toBe(false);
    expect(isManifest({ version: 1, market: 'bist', generated: 1 })).toBe(false);
  });
});

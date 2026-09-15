import { describe, expect, it } from 'vitest';
import { diffScreen, readSnapshots, snapshotKey, type ScreenSnapshot } from './watch';

const snap = (overrides: Partial<ScreenSnapshot> = {}): ScreenSnapshot => ({
  name: 'Tarama 1',
  market: 'bist',
  code: '1|rsi~b~40~70|14.14.20.50.14.20.250||chg21~d',
  data: 'hash-a',
  generated: 1_757_800_000,
  symbols: ['AAA', 'BBB'],
  ...overrides,
});

describe('Kayıtlı tarama farkı', () => {
  it('anlık görüntü yoksa fark uydurmaz', () => {
    const d = diffScreen(null, snap());
    expect(d.status).toBe('ilk-bakis');
    expect(d.entered).toEqual([]);
    expect(d.since).toBeNull();
  });

  it('aynı veri paketinde fark ARAMAZ', () => {
    // Aynı pakete bakarken çıkacak fark piyasadan değil, bizim hatamızdan gelir.
    const d = diffScreen(snap(), snap({ symbols: ['AAA', 'CCC'] }));
    expect(d.status).toBe('ayni-veri');
    expect(d.entered).toEqual([]);
    expect(d.exited).toEqual([]);
  });

  it('kural değiştiyse farkı piyasaya yazmaz', () => {
    const d = diffScreen(
      snap(),
      snap({ code: '1|rsi~b~30~80|14.14.20.50.14.20.250||chg21~d', data: 'hash-b' }),
    );
    expect(d.status).toBe('kural-degisti');
    expect(d.entered).toEqual([]);
  });

  it('piyasa farklıysa karşılaştırmaz', () => {
    const d = diffScreen(snap(), snap({ market: 'nasdaq', data: 'hash-b' }));
    expect(d.status).toBe('kural-degisti');
  });

  it('yeni veride giren ve çıkanı alfabetik verir', () => {
    const d = diffScreen(snap(), snap({ data: 'hash-b', symbols: ['ZZZ', 'AAA', 'MMM'] }));
    expect(d.status).toBe('degisti');
    expect(d.entered).toEqual(['MMM', 'ZZZ']);
    expect(d.exited).toEqual(['BBB']);
    expect(d.stayed).toBe(1);
    expect(d.since).toBe(1_757_800_000);
  });

  it('hiçbir şey değişmediyse boş fark döner ama durum "değişti" kalır', () => {
    // Veri yenilendi, sonuç aynı: bu da bir bilgidir ("kimse girmedi").
    const d = diffScreen(snap(), snap({ data: 'hash-b' }));
    expect(d.status).toBe('degisti');
    expect(d.entered).toEqual([]);
    expect(d.exited).toEqual([]);
    expect(d.stayed).toBe(2);
  });
});

describe('Anlık görüntü deposu', () => {
  it('bozuk JSON depoyu çökertmez', () => {
    expect(readSnapshots('{bozuk')).toEqual({});
    expect(readSnapshots(null)).toEqual({});
    expect(readSnapshots('[1,2]')).toEqual({});
  });

  it('yalnızca geçerli kayıtları alır, ötekini atar', () => {
    const key = snapshotKey('bist', 'Tarama 1');
    const raw = JSON.stringify({
      [key]: snap(),
      bozuk: { name: 'x', market: 'bist' },
      yarim: { ...snap(), symbols: [1, 2] },
    });
    const out = readSnapshots(raw);
    expect(Object.keys(out)).toEqual([key]);
    expect(out[key].symbols).toEqual(['AAA', 'BBB']);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataBase, packPath } from './markets';

/**
 * Veri kökü tek kaynak: iki arayüz de buradan okuyor. Önizleme dağıtımı
 * uygulamayı alt yola koyup veriyi kökten okuduğu için override şart —
 * ve override'ın "/" ile bitip bitmemesi çağıranın derdi olmamalı.
 */
describe('dataBase', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('varsayılan: uygulamanın kendi tabanı altındaki data/', () => {
    vi.stubEnv('VITE_DATA_BASE', '');
    expect(dataBase()).toBe(`${import.meta.env.BASE_URL}data/`);
  });

  it('override verildiğinde o kazanır', () => {
    vi.stubEnv('VITE_DATA_BASE', '/aideneme/data/');
    expect(dataBase()).toBe('/aideneme/data/');
    expect(packPath('bist', 'manifest.json')).toBe('/aideneme/data/bist/pack/manifest.json');
  });

  it('sondaki eğik çizgi eksikse tamamlanır', () => {
    // Yoksa "/aideneme/databist/pack/…" gibi sessizce bozuk bir yol çıkardı.
    vi.stubEnv('VITE_DATA_BASE', '/aideneme/data');
    expect(dataBase()).toBe('/aideneme/data/');
  });
});

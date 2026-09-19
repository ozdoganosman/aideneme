import { describe, expect, it, vi } from 'vitest';
import { SectorsClient } from './sectors';

const MAP = { source: 'İş Yatırım', generated: 1, of: { GARAN: 'Bankacılık' } };

function fetchOf(status: number, body: unknown) {
  return vi.fn(async () => ({ ok: status === 200, status, json: async () => body }) as Response);
}

describe('sektör istemcisi', () => {
  it('dosyayı bir kez indirir, sonra önbellekten verir', async () => {
    const impl = fetchOf(200, MAP);
    const client = new SectorsClient(impl as unknown as typeof fetch);
    expect(await client.map('bist')).toEqual(MAP);
    expect(await client.map('bist')).toEqual(MAP);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('dosya yoksa null döner — ekran kümelere düşer', async () => {
    const client = new SectorsClient(fetchOf(404, null) as unknown as typeof fetch);
    expect(await client.map('bist')).toBeNull();
  });

  it('bozuk içerik sektör haritası sayılmaz', async () => {
    const client = new SectorsClient(fetchOf(200, { of: {} }) as unknown as typeof fetch);
    expect(await client.map('bist')).toBeNull();
  });

  it('ağ hatası kalıcı önbelleğe yazılmaz', async () => {
    const impl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ağ yok'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => MAP });
    const client = new SectorsClient(impl as unknown as typeof fetch);
    expect(await client.map('bist')).toBeNull();
    expect(await client.map('bist')).toEqual(MAP);
    expect(impl).toHaveBeenCalledTimes(2);
  });
});

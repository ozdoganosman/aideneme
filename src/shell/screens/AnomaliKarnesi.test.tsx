import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AnomaliKarnesi } from './AnomaliKarnesi';
import type { AnomaliKarnesi as Karne, UfukSonucu } from '../../core/screen/anomaliKarnesi';
import type { AnalysisClient } from '../../workers/analysisClient';

function ufuk(ek: Partial<UfukSonucu> = {}): UfukSonucu {
  return { n: 500, medyanFazla: -0.1, isabet: 0.49, gun: 150, p: 0.6, kontrolFazla: 0.05, ...ek };
}

function karne(ek: Partial<Karne> = {}): Karne & { ms: number } {
  const bos = { 5: ufuk(), 20: ufuk() };
  return {
    ufuklar: [5, 20],
    basGun: 20438,
    sonGun: 20707,
    degerlendirilenGun: 185,
    satirlar: [
      { kova: 'hacim', olay: 1355, ufuk: bos },
      { kova: 'boslukYukari', olay: 1433, ufuk: bos },
      {
        kova: 'boslukAsagi',
        olay: 904,
        ufuk: {
          5: ufuk({ n: 904, medyanFazla: -1.56, isabet: 0.39, p: 0.0002, kontrolFazla: 0.06 }),
          20: ufuk({ n: 796, medyanFazla: -3.06, isabet: 0.41, p: 0.0004 }),
        },
      },
      { kova: 'kopmaYukari', olay: 1738, ufuk: bos },
      // Anlamlı ama AZ örnek: hüküm cümlesine girmemeli.
      {
        kova: 'kopmaAsagi',
        olay: 12,
        ufuk: { 5: ufuk({ n: 12, medyanFazla: -5, p: 0.01 }), 20: ufuk({ n: 0 }) },
      },
      { kova: 'korelasyon', olay: 0, ufuk: { 5: ufuk({ n: 0 }), 20: ufuk({ n: 0 }) } },
    ],
    ms: 600,
    ...ek,
  };
}

function istemci(cevap: Promise<unknown>) {
  const anomaliKarne = vi.fn().mockReturnValue(cevap);
  return { client: { anomaliKarne } as unknown as AnalysisClient, anomaliKarne };
}

const SEKTORLER = { of: { GARAN: 'Bankacılık' }, source: 't', generated: 7 };

/** `<details>`i açar: jsdom özet tıklamasında `toggle` olayını güvenilir atmıyor. */
function ac() {
  const d = document.querySelector('details.anomali__karne') as HTMLDetailsElement;
  d.open = true;
  fireEvent(d, new Event('toggle'));
}

describe('Anomalinin karnesi', () => {
  it('AÇILMADAN hesaplanmıyor — ağır iş, kullanıcı istemeden ödenmez', () => {
    const { client, anomaliKarne } = istemci(Promise.resolve(karne()));
    render(<AnomaliKarnesi market="bist" client={client} sectors={SEKTORLER} />);
    expect(anomaliKarne).not.toHaveBeenCalled();
    expect(screen.getByText(/Bu sinyaller geçmişte ne yaptı/)).toBeInTheDocument();
  });

  it('açılınca bir kez istiyor; kapatıp açmak ikinci kez istemiyor', async () => {
    const { client, anomaliKarne } = istemci(Promise.resolve(karne()));
    render(<AnomaliKarnesi market="bist" client={client} sectors={SEKTORLER} />);
    ac();
    await screen.findByRole('table', { name: 'Anomali sinyallerinin geçmiş karnesi' });
    expect(anomaliKarne).toHaveBeenCalledWith('bist', SEKTORLER.of);
    ac();
    expect(anomaliKarne).toHaveBeenCalledTimes(1);
  });

  it('sektör dosyasına bakılmadan istemiyor', () => {
    const { client, anomaliKarne } = istemci(Promise.resolve(karne()));
    render(<AnomaliKarnesi market="bist" client={client} sectors={undefined} />);
    ac();
    expect(anomaliKarne).not.toHaveBeenCalled();
  });

  it('hüküm yalnızca anlamlı VE yeterli örnekli kovalar için', async () => {
    const { client } = istemci(Promise.resolve(karne()));
    render(<AnomaliKarnesi market="bist" client={client} sectors={SEKTORLER} />);
    ac();
    await screen.findByRole('table');
    const ozet = document.querySelector('.anomali__karne-ozet')!;
    expect(ozet).toHaveTextContent(
      /piyasanın gerisinde kalanlar — aşağı açılış boşluğu \(5 gün -%1,6, 20 gün -%3,1\)/,
    );
    expect(ozet).toHaveTextContent(/185 gün/);
    // 12 olaylı kova p=0,01 olsa da öne çıkarılmıyor.
    expect(ozet).not.toHaveTextContent(/kopma/);
  });

  it('tablo: Türkçe sayı, kontrol sütunu, az örnek ve olay yok işaretli', async () => {
    const { client } = istemci(Promise.resolve(karne()));
    render(<AnomaliKarnesi market="bist" client={client} sectors={SEKTORLER} />);
    ac();
    const tablo = await screen.findByRole('table');
    const satir = within(tablo).getByRole('row', { name: /Aşağı açılış boşluğu/ });
    expect(satir).toHaveTextContent('-%1,56 · isabet %39');
    expect(satir).toHaveTextContent('sıradan günler +%0,06 · p <0,001');
    expect(within(tablo).getByRole('row', { name: /Sektörden aşağı kopma/ })).toHaveTextContent(
      /az örnek/,
    );
    expect(within(tablo).getByRole('row', { name: /Korelasyon kırılması/ })).toHaveTextContent(
      /olay yok/,
    );
  });

  it('anlamlı ama PRATİKTE sıfır etki öne çıkarılmıyor (gerçek veride görüldü)', async () => {
    const k = karne();
    // p = 0,02 ama medyan −0,01 ve sıradan günler +0,12: fark 0,13 puan.
    k.satirlar = k.satirlar.map((s) =>
      s.kova === 'korelasyon'
        ? {
            ...s,
            olay: 1806,
            ufuk: {
              5: ufuk({ n: 1806, medyanFazla: -0.01, p: 0.02, kontrolFazla: 0.12 }),
              20: ufuk(),
            },
          }
        : s,
    );
    const { client } = istemci(Promise.resolve(k));
    render(<AnomaliKarnesi market="bist" client={client} sectors={SEKTORLER} />);
    ac();
    await screen.findByRole('table');
    expect(document.querySelector('.anomali__karne-ozet')).not.toHaveTextContent(/korelasyon/);
  });

  it('hiçbir kova anlamlı değilse bunu açıkça söylüyor', async () => {
    const hic = karne();
    hic.satirlar = hic.satirlar.map((s) => ({ ...s, ufuk: { 5: ufuk(), 20: ufuk() } }));
    const { client } = istemci(Promise.resolve(hic));
    render(<AnomaliKarnesi market="bist" client={client} sectors={SEKTORLER} />);
    ac();
    await screen.findByRole('table');
    expect(document.querySelector('.anomali__karne-ozet')).toHaveTextContent(
      /hiçbir sinyal, sonrasında piyasadan belirgin biçimde ayrışmadı/,
    );
  });

  it('uyarılar her zaman görünür: hayatta kalma yanlılığı ve iyimser p', async () => {
    const { client } = istemci(Promise.resolve(karne()));
    render(<AnomaliKarnesi market="bist" client={client} sectors={SEKTORLER} />);
    ac();
    await screen.findByRole('table');
    expect(screen.getByText(/hayatta\s+kalma yanlılığı/)).toBeInTheDocument();
    expect(screen.getByText(/biraz iyimser/)).toBeInTheDocument();
  });

  it('hata: açık hata durumu', async () => {
    const { client } = istemci(Promise.reject(new Error('yok')));
    render(<AnomaliKarnesi market="bist" client={client} sectors={SEKTORLER} />);
    ac();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Karne hesaplanamadı'));
  });
});

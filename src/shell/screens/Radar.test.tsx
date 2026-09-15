import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyCandles, type Candles } from '../../core/data/types';
import { DAY_SECONDS } from '../../core/data/pack';

const bundleFn = vi.fn();
vi.mock('../../data-client/client', () => ({
  dataClient: { bundle: (...a: unknown[]) => bundleFn(...a) },
}));
const sectorsFn = vi.fn();
vi.mock('../../data-client/sectors', () => ({
  sectorsClient: { map: (...a: unknown[]) => sectorsFn(...a) },
}));
const snapshotFn = vi.fn();
vi.mock('../../data-client/fundamentals', () => ({
  fundamentalsClient: { snapshot: (...a: unknown[]) => snapshotFn(...a) },
}));

import { Radar } from './Radar';

function seri(kapanislar: number[], hacimler?: number[]): Candles {
  const c = emptyCandles(kapanislar.length);
  for (let i = 0; i < kapanislar.length; i++) {
    c.time[i] = (19_000 + i) * DAY_SECONDS;
    c.open[i] = kapanislar[i];
    c.high[i] = kapanislar[i];
    c.low[i] = kapanislar[i];
    c.close[i] = kapanislar[i];
    c.volume[i] = hacimler?.[i] ?? 1000;
  }
  return c;
}

const SERILER: Record<string, Candles> = {
  // Son bar hacmi ortalamanın üç katı: bağıl hacim 3× çıkmalı.
  THYAO: seri([100, 102, 104, 106, 110], [1000, 1000, 1000, 1000, 3000]),
  GARAN: seri([50, 50, 50, 50, 48], [500, 500, 500, 500, 500]),
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  snapshotFn.mockResolvedValue(null);
  sectorsFn.mockResolvedValue(null);
  bundleFn.mockResolvedValue({
    names: ['GARAN', 'THYAO', 'TUPRS'],
    days: new Int32Array(),
    bars: 5,
    closeAt: () => NaN,
    seriesOf: (s: string) => SERILER[s] ?? null,
  });
});

const noop = () => {};

async function satirMetinleri(): Promise<string[]> {
  const tablo = await screen.findByRole('table', { name: 'Radar tablosu' });
  return within(tablo)
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent!.trim());
}

describe('Radar', () => {
  it('liste boşken ne yapılacağını söyler', async () => {
    render(<Radar market="bist" symbol="THYAO" onSelect={noop} onClose={noop} />);
    expect(await screen.findByText(/Liste boş/)).toBeInTheDocument();
  });

  it('fiyat, günlük değişim, hacim ve bağıl hacmi aynı satırda verir', async () => {
    const user = userEvent.setup();
    const sec = vi.fn();
    render(<Radar market="bist" symbol="GARAN" onSelect={sec} onClose={noop} />);

    await user.click(await screen.findByPlaceholderText('Sembol ara…'));
    await user.click(await screen.findByRole('option', { name: /THYAO/ }));

    const [satir] = await satirMetinleri();
    expect(satir).toContain('THYAO');
    expect(satir).toContain('110,00'); // fiyat
    expect(satir).toContain('+%3,77'); // 106 → 110
    expect(satir).toContain('3,00×'); // bağıl hacim: 3000 / 1000

    // Satırın kendisi bir düğme (VirtualTable ilk sütuna gerçek düğme koyuyor);
    // yanındaki "radardan çıkar" düğmesiyle karışmasın diye TAM ad aranıyor.
    await user.click(screen.getByRole('button', { name: 'THYAO' }));
    expect(sec).toHaveBeenCalledWith('THYAO');
  });

  // Sıralama radarın asıl işi: "bugün ne oldu" sorusu ancak sütun sıralanarak
  // cevaplanıyor. Kapsam "tüm piyasa" olduğunda liste boş olsa da çalışmalı.
  it('tüm piyasa kapsamında sütuna göre sıralıyor', async () => {
    const user = userEvent.setup();
    render(<Radar market="bist" symbol="" onSelect={noop} onClose={noop} />);
    await user.selectOptions(await screen.findByLabelText('Kapsam'), 'piyasa');

    // Varsayılan sıralama: günlük değişim, azalan → yükselen önce.
    expect((await satirMetinleri())[0]).toContain('THYAO');

    await user.click(screen.getByRole('button', { name: /Değ %/ }));
    expect((await satirMetinleri())[0]).toContain('GARAN');
  });

  // Kullanıcı isteği: radar seçimleri kalıcı olsun.
  it('liste tarayıcıda saklanıyor ve piyasaya göre ayrı', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Radar market="bist" symbol="" onSelect={noop} onClose={noop} />);
    await user.click(await screen.findByPlaceholderText('Sembol ara…'));
    await user.click(await screen.findByRole('option', { name: /THYAO/ }));
    expect((await satirMetinleri())[0]).toContain('THYAO');
    unmount();

    const tekrar = render(<Radar market="bist" symbol="" onSelect={noop} onClose={noop} />);
    expect((await satirMetinleri())[0]).toContain('THYAO');
    tekrar.unmount();

    // BIST listesi ABD radarına sızmamalı: semboller piyasaya özgü.
    render(<Radar market="us" symbol="" onSelect={noop} onClose={noop} />);
    expect(await screen.findByText(/Liste boş/)).toBeInTheDocument();
  });

  it('paket yüklenemezse sebebini yazar', async () => {
    bundleFn.mockRejectedValue(new Error('bist: paket dosyası üretilmemiş'));
    render(<Radar market="bist" symbol="" onSelect={noop} onClose={noop} />);
    expect(await screen.findByText(/paket dosyası üretilmemiş/)).toBeInTheDocument();
  });

  // Listede olup pakette olmayan sembol SESSİZCE düşmemeli.
  it('pakette bulunmayan sembolü sayıyla bildirir', async () => {
    localStorage.setItem('radar.liste.v1', JSON.stringify({ bist: ['THYAO', 'YOKXX'] }));
    render(<Radar market="bist" symbol="" onSelect={noop} onClose={noop} />);
    expect(await screen.findByText(/1 sembol bu piyasanın paketinde yok/)).toBeInTheDocument();
  });

  // Temel veri her piyasada yok: gelmezse fiyat sütunları çalışmaya devam eder.
  it('çarpan verisi yoksa F/K sütunu boş kalır, tablo çalışır', async () => {
    localStorage.setItem('radar.liste.v1', JSON.stringify({ bist: ['THYAO'] }));
    render(<Radar market="bist" symbol="" onSelect={noop} onClose={noop} />);
    expect((await screen.findAllByRole('row'))[1].textContent).toContain('110,00');
    expect((await satirMetinleri())[0]).toContain('—');
  });
});

/**
 * Filtreler.
 *
 * Radar bir izleme listesi değil tarama yüzeyi: "bağıl hacmi 2 katını
 * geçenler" ya da "F/K'sı 10'un altında olanlar" ancak filtreyle sorulabilir.
 */
describe('Radar — filtreler', () => {
  async function tumPiyasa(user: ReturnType<typeof userEvent.setup>) {
    render(<Radar market="bist" symbol="" onSelect={noop} onClose={noop} />);
    await user.selectOptions(await screen.findByLabelText('Kapsam'), 'piyasa');
  }

  it('sayısal filtre satırları eliyor ve kaç kaldığını yazıyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    expect((await satirMetinleri()).length).toBe(2);

    // Bağıl hacim: THYAO 3×, GARAN 1×.
    await user.selectOptions(screen.getByLabelText('Ölçüt'), 'bagilHacim');
    const deger = screen.getByLabelText('Değer');
    await user.clear(deger);
    await user.type(deger, '2');
    await user.click(screen.getByRole('button', { name: 'Filtreyi ekle' }));

    const kalan = await satirMetinleri();
    expect(kalan).toHaveLength(1);
    expect(kalan[0]).toContain('THYAO');
    expect(screen.getByText('1 / 2 sembol')).toBeInTheDocument();
  });

  // Değeri OLMAYAN satır sayısal filtreyi geçmemeli: "F/K < 10" araması
  // F/K'sı hiç olmayan şirketi getirseydi sonuç soruya cevap vermezdi.
  it('değeri olmayan satır sayısal filtreyi geçmiyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    // Çarpan verisi yok (snapshot null) → F/K her satırda boş.
    await user.selectOptions(screen.getByLabelText('Ölçüt'), 'pe');
    await user.selectOptions(screen.getByLabelText('Koşul'), 'lt');
    const deger = screen.getByLabelText('Değer');
    await user.clear(deger);
    await user.type(deger, '1000');
    await user.click(screen.getByRole('button', { name: 'Filtreyi ekle' }));

    expect(screen.getByText('0 / 2 sembol')).toBeInTheDocument();
  });

  it('sembol araması harf büyüklüğünden bağımsız', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    await user.type(screen.getByLabelText('Sembol ara'), 'thy');
    const kalan = await satirMetinleri();
    expect(kalan).toHaveLength(1);
    expect(kalan[0]).toContain('THYAO');
  });

  it('filtre çipi kaldırılabiliyor ve tercih saklanıyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    await user.selectOptions(screen.getByLabelText('Ölçüt'), 'bagilHacim');
    const deger = screen.getByLabelText('Değer');
    await user.clear(deger);
    await user.type(deger, '2');
    await user.click(screen.getByRole('button', { name: 'Filtreyi ekle' }));
    expect(JSON.parse(localStorage.getItem('radar.filtre.v1')!)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Filtreyi kaldır/ }));
    expect((await satirMetinleri()).length).toBe(2);
    expect(JSON.parse(localStorage.getItem('radar.filtre.v1')!)).toHaveLength(0);
  });

  // Sınıflandırma yoksa boş bir açılır kutu "sektör verisi var ama hiçbiri
  // eşleşmedi" gibi okunurdu.
  it('sektör dosyası yoksa sektör seçici hiç çizilmiyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    expect(screen.queryByLabelText('Sektör')).toBeNull();
  });

  it('sektör dosyası varsa sektöre göre süzüyor', async () => {
    sectorsFn.mockResolvedValue({
      of: { THYAO: 'Ulaştırma', GARAN: 'Bankacılık' },
      source: 'test',
      generated: 1,
    });
    const user = userEvent.setup();
    await tumPiyasa(user);
    await user.selectOptions(await screen.findByLabelText('Sektör'), 'Bankacılık');
    const kalan = await satirMetinleri();
    expect(kalan).toHaveLength(1);
    expect(kalan[0]).toContain('GARAN');
  });
});

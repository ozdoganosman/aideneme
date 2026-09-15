import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyCandles, type Candles } from '../../core/data/types';
import { DAY_SECONDS } from '../../core/data/pack';

const bundleBufferFn = vi.fn();
vi.mock('../../data-client/client', () => ({
  dataClient: { bundleBuffer: (...a: unknown[]) => bundleBufferFn(...a) },
}));
const snapshotFn = vi.fn();
const allFinancialsFn = vi.fn();
vi.mock('../../data-client/fundamentals', () => ({
  fundamentalsClient: {
    snapshot: (...a: unknown[]) => snapshotFn(...a),
    allFinancials: (...a: unknown[]) => allFinancialsFn(...a),
  },
}));
const sectorsFn = vi.fn();
vi.mock('../../data-client/sectors', () => ({
  sectorsClient: { map: (...a: unknown[]) => sectorsFn(...a) },
}));

import { metricsFor, DEFAULT_SCREEN_PARAMS } from '../../core/screen/metrics';
import { Radar, araliklarKurallara } from './Radar';

/** n barlık seri; son bar hacmi `sonHacim` ile ayrılabiliyor. */
function seri(kapanislar: number[], sonHacim = 1000): Candles {
  const c = emptyCandles(kapanislar.length);
  for (let i = 0; i < kapanislar.length; i++) {
    c.time[i] = (19_000 + i) * DAY_SECONDS;
    c.open[i] = kapanislar[i];
    c.high[i] = kapanislar[i] * 1.01;
    c.low[i] = kapanislar[i] * 0.99;
    c.close[i] = kapanislar[i];
    c.volume[i] = i === kapanislar.length - 1 ? sonHacim : 1000;
  }
  return c;
}

/** 40 barlık yükselen seri; son bar `sonDegisim` kadar hareket eder. */
function yukselen(baslangic: number, sonDegisim: number, sonHacim = 1000): Candles {
  const k: number[] = [];
  for (let i = 0; i < 40; i++) k.push(baslangic * (1 + i * 0.005));
  k[39] = k[38] * (1 + sonDegisim / 100);
  return seri(k, sonHacim);
}

const SERILER: Record<string, Candles> = {
  // Son bar +%4 ve hacmi ortalamanın üç katı.
  THYAO: yukselen(100, 4, 3000),
  // Son bar −%2, hacim normal.
  GARAN: yukselen(50, -2, 1000),
};

/**
 * Sahte worker istemcisi: ölçütleri GERÇEK `metricsFor` ile hesaplıyor, yani
 * test ekranın gösterdiği sayıların doğruluğunu da sınıyor — yalnızca akışı
 * değil.
 */
const loadFn = vi.fn();
const screenFn = vi.fn();
const FAKE_CLIENT = {
  load: (...a: unknown[]) => loadFn(...a),
  screen: (...a: unknown[]) => screenFn(...a),
} as unknown as Parameters<typeof Radar>[0]['client'];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  snapshotFn.mockResolvedValue(null);
  allFinancialsFn.mockResolvedValue(null);
  sectorsFn.mockResolvedValue(null);
  bundleBufferFn.mockResolvedValue({ buffer: new ArrayBuffer(8), fromCache: true, bytes: 8 });
  loadFn.mockResolvedValue({ symbols: ['GARAN', 'THYAO'], bars: 40 });
  screenFn.mockResolvedValue({
    rows: Object.entries(SERILER).map(([ad, c]) => metricsFor(ad, c, DEFAULT_SCREEN_PARAMS)!),
    ms: 3,
  });
});

const noop = () => {};

async function satirlar(): Promise<string[]> {
  const tablo = await screen.findByRole('table', { name: 'Radar tablosu' });
  return within(tablo)
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent!.trim());
}

async function tumPiyasa(user: ReturnType<typeof userEvent.setup>) {
  render(<Radar market="bist" symbol="" client={FAKE_CLIENT} onSelect={noop} onClose={noop} />);
  await user.selectOptions(await screen.findByLabelText('Kapsam'), 'piyasa');
}

describe('araliklarKurallara', () => {
  it('tek sınır tek kurala, iki sınır aralığa dönüyor', () => {
    expect(araliklarKurallara({ pe: { max: 10 } })).toEqual([{ metric: 'pe', op: 'lt', a: 10 }]);
    expect(araliklarKurallara({ roe: { min: 15 } })).toEqual([{ metric: 'roe', op: 'gt', a: 15 }]);
    expect(araliklarKurallara({ rsi: { min: 40, max: 70 } })).toEqual([
      { metric: 'rsi', op: 'between', a: 40, b: 70 },
    ]);
  });

  // Boş bırakılan sınır kural ÜRETMEMELİ: "sınırı olmayan filtre" diye bir şey
  // yok ve üretilseydi NaN eşikli bir kural hiçbir sembolü geçirmezdi.
  it('boş sınır kural üretmiyor', () => {
    expect(araliklarKurallara({ pe: {} })).toEqual([]);
    expect(araliklarKurallara({ pe: { min: Number.NaN } })).toEqual([]);
  });
});

describe('Radar', () => {
  it('liste boşken ne yapılacağını söyler', async () => {
    render(
      <Radar market="bist" symbol="THYAO" client={FAKE_CLIENT} onSelect={noop} onClose={noop} />,
    );
    expect(await screen.findByText(/Liste boş/)).toBeInTheDocument();
  });

  // Radar kendi küçük hesabını yapıyordu; artık tarama ekranıyla AYNI
  // fonksiyon (`metricsFor`) kullanılıyor, yani iki ekran aynı sembol için
  // aynı sayıyı veriyor.
  it('tarama ekranıyla aynı ölçütleri gösteriyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    const [ilk] = await satirlar();
    expect(ilk).toContain('THYAO');
    expect(ilk).toContain('+%4,00'); // 1 gün
    // Hacim oranı 2,73: ortalama SON barı da içeriyor ((19×1000 + 3000)/20 =
    // 1100). Tarama ekranının tanımı bu; radar kendi tanımını uydurmuyor.
    expect(ilk).toContain('2,73×');
  });

  it('satır tıklanınca sembolü bildiriyor', async () => {
    const user = userEvent.setup();
    const sec = vi.fn();
    render(<Radar market="bist" symbol="" client={FAKE_CLIENT} onSelect={sec} onClose={noop} />);
    await user.selectOptions(await screen.findByLabelText('Kapsam'), 'piyasa');
    await user.click(await screen.findByRole('button', { name: 'THYAO' }));
    expect(sec).toHaveBeenCalledWith('THYAO');
  });
});

describe('Radar — filtreler', () => {
  async function filtrePaneliniAc(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^Filtre paneli/ }));
  }

  it('aralık filtresi satırları eliyor ve sayaç düşüyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    expect(await screen.findByText('2 / 2')).toBeInTheDocument();

    await filtrePaneliniAc(user);
    await user.type(screen.getByLabelText('Hacim oranı en az'), '2');

    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
    const kalan = await satirlar();
    expect(kalan).toHaveLength(1);
    expect(kalan[0]).toContain('THYAO');
  });

  // Filtrelenen ölçüt sütun olarak da gelmeli: "neden bu satır kaldı"
  // sorusunun cevabı ekranda olsun.
  it('filtrelenen ölçüt sütun olarak ekleniyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    const tablo = screen.getByRole('table', { name: 'Radar tablosu' });
    expect(within(tablo).queryByRole('button', { name: /Zirveden/ })).toBeNull();

    await filtrePaneliniAc(user);
    await user.type(screen.getByLabelText('Zirveden en az'), '-50');
    expect(await within(tablo).findByRole('button', { name: /Zirveden/ })).toBeInTheDocument();
  });

  it('hazır filtre tek tıkla kuruluyor ve çip olarak görünüyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    await user.click(screen.getByRole('button', { name: 'Hazır' }));
    await user.click(screen.getByRole('button', { name: /Hacim patlaması/ }));

    expect(await screen.findByText('Hacim oranı ≥ 2,00')).toBeInTheDocument();
    expect((await satirlar())[0]).toContain('THYAO');

    // Panel KAPANMALI: filtre uygulandığında değişen şey arkadaki tablo ve
    // panel onun üstünde duruyor. Açık kalırsa kullanıcı kendi seçiminin
    // sonucunu göremez. Odak da tetikleyiciye dönmeli — panel gövdeye
    // taşındığı için odağı geri vermeyen bir kapanış klavyeyi kaybettirir.
    const tetik = screen.getByRole('button', { name: 'Hazır' });
    expect(screen.queryByRole('dialog', { name: 'Hazır filtreler' })).toBeNull();
    expect(tetik).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(tetik);
  });

  it('çip kaldırılabiliyor ve tercih saklanıyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    await filtrePaneliniAc(user);
    await user.type(screen.getByLabelText('Hacim oranı en az'), '2');
    await screen.findByText('1 / 2');
    expect(JSON.parse(localStorage.getItem('radar.filtre.v2')!)).toHaveProperty('volRatio');

    await user.click(screen.getByRole('button', { name: /Filtreyi kaldır: Hacim oranı/ }));
    expect(await screen.findByText('2 / 2')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('radar.filtre.v2')!)).toEqual({});
  });

  // Değeri OLMAYAN satır sayısal filtreyi geçmemeli (tarama ekranındaki kural).
  it('değeri olmayan satır filtreyi geçmiyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    await filtrePaneliniAc(user);
    // Çarpan verisi yok (snapshot null) → F/K her satırda boş.
    await user.type(screen.getByLabelText('F/K en çok'), '1000');
    expect(await screen.findByText('0 / 2')).toBeInTheDocument();
    expect(screen.getByText(/Filtrelere uyan sembol yok/)).toBeInTheDocument();
  });

  // 3,1 MB'lık tablo dosyası kullanılmayan bir ölçüt için inmemeli.
  it('karne ölçütü kullanılmadıkça tablo dosyası İNMİYOR', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    await satirlar();
    expect(allFinancialsFn).not.toHaveBeenCalled();

    await filtrePaneliniAc(user);
    await user.type(screen.getByLabelText('Karne: kârlılık en az'), '60');
    expect(allFinancialsFn).toHaveBeenCalledWith('bist');
  });

  it('sektör dosyası varsa sektör sütunu geliyor', async () => {
    sectorsFn.mockResolvedValue({
      of: { THYAO: 'Ulaştırma', GARAN: 'Bankacılık' },
      source: 'test',
      generated: 1,
    });
    const user = userEvent.setup();
    await tumPiyasa(user);
    expect((await satirlar()).join(' ')).toContain('Ulaştırma');
  });
});

describe('Radar — sütunlar', () => {
  // 300 px'lik panelde sekiz sütun yatay kaydırma demek; varsayılan üç ölçüt
  // ve kullanıcı istediğini ekliyor.
  it('varsayılan sütunlar dar tutuluyor, seçiciyle ekleniyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    const basliklar = () =>
      within(screen.getByRole('table', { name: 'Radar tablosu' }))
        .getAllByRole('columnheader')
        // Sıralanan sütun başlığına ok ekliyor ("1 gün ↓"); karşılaştırma
        // okunu atıyor, sınanan şey sütun KÜMESİ.
        .map((h) => h.textContent!.trim().replace(/\s*[↑↓]$/, ''));

    expect(basliklar()).toEqual(['Sembol', 'Fiyat', '1 gün', 'Hacim oranı', '']);

    await user.click(screen.getByRole('button', { name: 'Sütun seçici' }));
    await user.click(screen.getByRole('checkbox', { name: 'RSI' }));
    expect(basliklar()).toContain('RSI');
    expect(JSON.parse(localStorage.getItem('radar.sutun.v1')!)).toContain('rsi');
  });
});

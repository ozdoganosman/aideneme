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
import { gostergeDegerleri } from '../../core/screen/indikatorOlcutHesap';
import { gostergeOlcutId, type OlcutIstegi } from '../../core/screen/indikatorOlcut';

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
/**
 * Gösterge ölçümü de GERÇEK hesapla yapılıyor (`gostergeDegerleri`), yani
 * test ekranın gösterdiği sayının doğruluğunu da sınıyor. Sahte sayılarla
 * kurulsaydı "EMA 200 sütunu doğru mu" sorusu hiç sorulmamış olurdu.
 */
const gostergeOlcutFn = vi.fn(async (_market: unknown, istekler: OlcutIstegi[]) => {
  const degerler = new Map<string, Record<string, number>>();
  for (const [ad, c] of Object.entries(SERILER)) {
    degerler.set(ad, gostergeDegerleri(c, istekler));
  }
  return { degerler, ms: 1 };
});
const FAKE_CLIENT = {
  load: (...a: unknown[]) => loadFn(...a),
  screen: (...a: unknown[]) => screenFn(...a),
  gostergeOlcut: (m: unknown, i: OlcutIstegi[]) => gostergeOlcutFn(m, i),
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

async function tumPiyasa(
  user: ReturnType<typeof userEvent.setup>,
  ekstra: Partial<Parameters<typeof Radar>[0]> = {},
) {
  render(
    <Radar
      market="bist"
      symbol=""
      client={FAKE_CLIENT}
      onSelect={noop}
      onClose={noop}
      {...ekstra}
    />,
  );
  await user.selectOptions(await screen.findByLabelText('Kapsam'), 'piyasa');
}

/** Filtre panelini açar. */
async function filtrePaneli(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Filtre paneli/ }));
}

/**
 * Sayaç metni artık düğümlere bölünüyor ("<b>1</b> / 2 eşleşti"), o yüzden
 * düz metin araması tutmuyor. Eşleştirici KABIN metnine bakıyor.
 */
function sayac(beklenen: string) {
  return async () =>
    await screen.findByText((_metin, el) => {
      if (!el?.classList.contains('radar__sayac')) return false;
      return (el.textContent ?? '').replace(/\s+/g, ' ').trim() === beklenen;
    });
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
  /**
   * İlk açılışta radar BOŞ gelmemeli.
   *
   * Ölçüldü: kayıtlı tercihi olmayan kullanıcıda kapsam "İzleme listem",
   * liste de boş olduğu için tablo 0 satırla açılıyordu — tarayıcıyı ilk kez
   * açan kişi hiçbir hisse görmüyordu.
   */
  it('kayıtlı tercih yokken ve liste boşken tüm piyasayla açılıyor', async () => {
    render(
      <Radar market="bist" symbol="THYAO" client={FAKE_CLIENT} onSelect={noop} onClose={noop} />,
    );
    expect(await screen.findByLabelText('Kapsam')).toHaveValue('piyasa');
    expect((await satirlar()).length).toBeGreaterThan(0);
  });

  // Kullanıcının SEÇİMİ üstün: listeyi seçmişse boş bile olsa ona dokunulmuyor.
  it('kayıtlı tercih "liste" ise liste boş olsa da ona uyuluyor', async () => {
    localStorage.setItem('radar.kapsam.v1', JSON.stringify('liste'));
    render(
      <Radar market="bist" symbol="THYAO" client={FAKE_CLIENT} onSelect={noop} onClose={noop} />,
    );
    expect(await screen.findByLabelText('Kapsam')).toHaveValue('liste');
    expect(await screen.findByText(/Listeniz boş/)).toBeInTheDocument();
  });

  // Listede sembol varsa varsayılan yine liste: kullanıcı onu doldurmuş.
  it('listede sembol varsa varsayılan liste kalıyor', async () => {
    localStorage.setItem('radar.liste.v1', JSON.stringify({ bist: ['THYAO'] }));
    render(
      <Radar market="bist" symbol="THYAO" client={FAKE_CLIENT} onSelect={noop} onClose={noop} />,
    );
    expect(await screen.findByLabelText('Kapsam')).toHaveValue('liste');
  });

  // Boş durumun ÇIKIŞI olmalı: metni okuyup açılır listeyi aramak yerine tek tık.
  it('boş listede "Tüm piyasayı göster" düğmesi kapsamı değiştiriyor', async () => {
    localStorage.setItem('radar.kapsam.v1', JSON.stringify('liste'));
    const user = userEvent.setup();
    render(
      <Radar market="bist" symbol="THYAO" client={FAKE_CLIENT} onSelect={noop} onClose={noop} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Tüm piyasayı göster' }));
    expect(await screen.findByLabelText('Kapsam')).toHaveValue('piyasa');
    expect((await satirlar()).length).toBeGreaterThan(0);
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
    expect(await sayac('2 sembol')()).toBeInTheDocument();

    await filtrePaneliniAc(user);
    await user.type(screen.getByLabelText('Hacim oranı en az'), '2');

    expect(await sayac('1 / 2 eşleşti')()).toBeInTheDocument();
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
    await sayac('1 / 2 eşleşti')();
    expect(JSON.parse(localStorage.getItem('radar.filtre.v2')!)).toHaveProperty('volRatio');

    await user.click(screen.getByRole('button', { name: /Filtreyi kaldır: Hacim oranı/ }));
    expect(await sayac('2 sembol')()).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('radar.filtre.v2')!)).toEqual({});
  });

  // Değeri OLMAYAN satır sayısal filtreyi geçmemeli (tarama ekranındaki kural).
  it('değeri olmayan satır filtreyi geçmiyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    await filtrePaneliniAc(user);
    // Çarpan verisi yok (snapshot null) → F/K her satırda boş.
    await user.type(screen.getByLabelText('F/K en çok'), '1000');
    expect(await sayac('0 / 2 eşleşti')()).toBeInTheDocument();
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

  /*
    SEKTÖR SÜZGECİ. Zincirin son halkası: nabızda bir sektörün öne çıktığını
    gören kullanıcı radarı o sektöre daraltıp ölçütlerini üstüne koyabilmeli.
    Sektör sayısal olmadığı için `applyScreen` kurallarına giremiyor, ayrı
    süzülüyor — bu yüzden ayrı sınanıyor.
  */
  it('sektör süzgeci satırları eliyor ve çip olarak görünüyor', async () => {
    sectorsFn.mockResolvedValue({
      of: { THYAO: 'Ulaştırma', GARAN: 'Bankacılık' },
      source: 'test',
      generated: 1,
    });
    const user = userEvent.setup();
    await tumPiyasa(user);
    expect(await sayac('2 sembol')()).toBeInTheDocument();

    await filtrePaneliniAc(user);
    await user.click(screen.getByRole('checkbox', { name: 'Ulaştırma' }));

    expect(await sayac('1 / 2 eşleşti')()).toBeInTheDocument();
    expect((await satirlar())[0]).toContain('THYAO');
    // Düğme sayacı sektörü de sayıyor; aksi hâlde "filtre yok" der gibi durur.
    expect(screen.getByRole('button', { name: /^Filtre paneli, 1 etkin/ })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Etkin filtreler' })).getByText('Ulaştırma'),
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('radar.sektor.v1')!)).toEqual(['Ulaştırma']);
  });

  // Sınıflandırma YOKSA bölüm hiç çizilmemeli: boş bir "Sektör" başlığı,
  // filtrenin var olduğunu ama çalışmadığını düşündürür.
  it('sınıflandırma yoksa sektör bölümü çizilmiyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    await filtrePaneliniAc(user);
    expect(screen.queryByRole('group', { name: /^Sektör/ })).toBeNull();
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

describe('Radar — grafikteki göstergeler', () => {
  const EMA10 = [{ id: 'ema', parametreler: { uzunluk: 10 } }];

  it('grafikte açık gösterge panelde listeleniyor ama ÖLÇÜLMÜYOR', async () => {
    // "Hazır" ile "hesaplanmış" ayrı şeyler: açık olan her göstergeyi 600
    // sembolde peşin hesaplamak, kullanıcının istemediği bir işi her radar
    // açılışına ödetmek olurdu.
    const user = userEvent.setup();
    await tumPiyasa(user, { gostergeler: EMA10 });
    await filtrePaneli(user);
    expect(await screen.findByText(/Grafikteki göstergeler/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /EMA 10 ölçütlerini radardan ekle/ })).toBeTruthy();
    expect(gostergeOlcutFn).not.toHaveBeenCalled();
  });

  it('tek düğmeyle eklenince ölçülüyor ve sütun olarak geliyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user, { gostergeler: EMA10 });
    await filtrePaneli(user);
    await user.click(screen.getByRole('button', { name: /EMA 10 ölçütlerini radardan ekle/ }));

    await vi.waitFor(() => expect(gostergeOlcutFn).toHaveBeenCalled());
    const istekler = gostergeOlcutFn.mock.calls[0][1];
    expect(istekler).toHaveLength(1);
    expect(istekler[0].id).toBe('ema');
    // Eşik kutusu açılıyor: artık hazır bir ölçütten farkı yok.
    expect(await screen.findByLabelText('EMA 10 en az')).toBeTruthy();
  });

  it('eklenen göstergenin eşiği GERÇEK sayıyla süzüyor', async () => {
    // THYAO 100'den, GARAN 50'den başlıyor; EMA 10 eşiği ikisini ayırıyor.
    const user = userEvent.setup();
    await tumPiyasa(user, { gostergeler: EMA10 });
    await filtrePaneli(user);
    await user.click(screen.getByRole('button', { name: /EMA 10 ölçütlerini radardan ekle/ }));
    await user.type(await screen.findByLabelText('EMA 10 en az'), '90');

    await vi.waitFor(async () => {
      const s = await satirlar();
      expect(s.some((r) => r.startsWith('THYAO'))).toBe(true);
      expect(s.some((r) => r.startsWith('GARAN'))).toBe(false);
    });
  });

  it('gösterge çıkarılınca ona bağlı filtre de siliniyor', async () => {
    // Bırakılsaydı ölçüt artık hesaplanmayacağı için NaN olurdu; NaN hiçbir
    // kuralı geçmediğinden radar sessizce boşalır, kullanıcı da sebebini
    // göremezdi.
    const user = userEvent.setup();
    await tumPiyasa(user, { gostergeler: EMA10 });
    await filtrePaneli(user);
    await user.click(screen.getByRole('button', { name: /EMA 10 ölçütlerini radardan ekle/ }));
    await user.type(await screen.findByLabelText('EMA 10 en az'), '90');
    await vi.waitFor(async () => expect((await satirlar()).length).toBe(1));

    await user.click(screen.getByRole('button', { name: /EMA 10 ölçütlerini radardan çıkar/ }));
    await vi.waitFor(async () => expect((await satirlar()).length).toBe(2));
  });

  it('kullanıcı göstergesi ölçülemiyorsa SEBEBİ yazılıyor', async () => {
    // Listede görünmüyor diye sessiz kalmak, kullanıcının kendi göstergesini
    // boşuna aramasına yol açardı.
    const user = userEvent.setup();
    await tumPiyasa(user, { gostergeler: EMA10, kullaniciGostergesiVar: true });
    await filtrePaneli(user);
    expect(await screen.findByText(/Kendi yazdığın göstergeler radarda ölçülemiyor/)).toBeTruthy();
  });

  it('aynı gösterge iki farklı parametreyle AYRI ölçüt', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user, {
      gostergeler: [
        { id: 'ema', parametreler: { uzunluk: 10 } },
        { id: 'ema', parametreler: { uzunluk: 20 } },
      ],
    });
    await filtrePaneli(user);
    expect(screen.getByRole('button', { name: /EMA 10 ölçütlerini radardan ekle/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /EMA 20 ölçütlerini radardan ekle/ })).toBeTruthy();
  });
});

describe('Radar — ölçüt kıyası', () => {
  it('sağ liste yalnızca AYNI ÖLÇEKTEKİ ölçütleri veriyor', async () => {
    // "%R 260 > EMA 200" tip olarak geçerli ama anlamsız bir filtre; hata
    // vermez, sessizce ya hep ya hiç sonuç döndürür. Kurulduktan sonra
    // uyarmak yerine hiç kurdurmuyoruz.
    const user = userEvent.setup();
    await tumPiyasa(user, { gostergeler: [{ id: 'ema', parametreler: { uzunluk: 10 } }] });
    await filtrePaneli(user);
    await user.click(screen.getByRole('button', { name: /EMA 10 ölçütlerini radardan ekle/ }));

    await user.selectOptions(await screen.findByLabelText('Kıyas sol ölçüt'), 'last');
    const sag = screen.getByLabelText('Kıyas sağ ölçüt') as HTMLSelectElement;
    const secenekler = [...sag.options].map((o) => o.textContent);
    expect(secenekler).toContain('EMA 10');
    // RSI 0..100 salınımı; fiyat seviyesiyle kıyaslanamaz.
    expect(secenekler).not.toContain('RSI');
  });

  it('"Fiyat > EMA" kuralı gerçek sayılarla süzüyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user, { gostergeler: [{ id: 'ema', parametreler: { uzunluk: 10 } }] });
    await filtrePaneli(user);
    await user.click(screen.getByRole('button', { name: /EMA 10 ölçütlerini radardan ekle/ }));

    const emaId = gostergeOlcutId('ema', { uzunluk: 10 }, 'ema');
    await user.selectOptions(await screen.findByLabelText('Kıyas sol ölçüt'), 'last');
    await user.selectOptions(screen.getByLabelText('Kıyas sağ ölçüt'), emaId);
    await user.selectOptions(screen.getByLabelText('Kıyas yönü'), 'gt');
    await user.click(screen.getByRole('button', { name: 'Ekle' }));

    // THYAO son barda +%4, GARAN −%2: biri EMA'sının üstünde, öteki altında.
    await vi.waitFor(async () => {
      const s = await satirlar();
      expect(s.some((r) => r.startsWith('THYAO'))).toBe(true);
      expect(s.some((r) => r.startsWith('GARAN'))).toBe(false);
    });
    expect(await screen.findByText('Fiyat > EMA 10')).toBeTruthy();
  });

  it('kıyas kuralı çip olarak silinebiliyor', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user, { gostergeler: [{ id: 'ema', parametreler: { uzunluk: 10 } }] });
    await filtrePaneli(user);
    await user.click(screen.getByRole('button', { name: /EMA 10 ölçütlerini radardan ekle/ }));
    const emaId = gostergeOlcutId('ema', { uzunluk: 10 }, 'ema');
    await user.selectOptions(await screen.findByLabelText('Kıyas sol ölçüt'), 'last');
    await user.selectOptions(screen.getByLabelText('Kıyas sağ ölçüt'), emaId);
    await user.click(screen.getByRole('button', { name: 'Ekle' }));
    await vi.waitFor(async () => expect((await satirlar()).length).toBe(1));

    await user.click(screen.getByRole('button', { name: 'Filtreyi kaldır: Fiyat > EMA 10' }));
    await vi.waitFor(async () => expect((await satirlar()).length).toBe(2));
  });

  it('ölçütü grafikte kapatılan kıyas UYGULANMIYOR ve çip bunu söylüyor', async () => {
    // Sessizce durmuş bir filtreyi etkinmiş gibi göstermek, boşalan (ya da
    // dolan) radarın sebebini gizlemek olurdu.
    const user = userEvent.setup();
    const emaId = gostergeOlcutId('ema', { uzunluk: 10 }, 'ema');
    localStorage.setItem('radar.gosterge.v1', JSON.stringify([`gos:ema:10`]));
    localStorage.setItem(
      'radar.kiyas.v1',
      JSON.stringify([{ a: 'last', op: 'gt', b: emaId, adA: 'Fiyat', adB: 'EMA 10' }]),
    );
    // Grafikte HİÇ gösterge açık değil: kural iki taraflı kurulamıyor.
    await tumPiyasa(user, { gostergeler: [] });
    await vi.waitFor(async () => expect((await satirlar()).length).toBe(2));
    expect(await screen.findByText(/Fiyat > EMA 10 \(kapalı\)/)).toBeTruthy();
  });
});

describe('Radar — taranamayan semboller', () => {
  /**
   * Gerçek veride ölçülen kusur: izleme listesine dört sembol eklenmiş
   * kullanıcıya radar "2 sembol" diyor, ipucunda da "Radardaki 2 sembolden 2
   * tanesi görünüyor" yazıyordu — eksik olduğunu söylemek bir yana TAM
   * olduğunu iddia ediyordu. Kaybolan ikisi (UMPAS, ISATR) son 250 günde
   * ölçüm yapacak kadar işlem görmemişti.
   */
  beforeEach(() => {
    // Paket UMPAS'ı da taşıyor ama tarama onun için satır ÜRETMİYOR:
    // `metricsFor` iki bardan az veriyle ölçüm yapmayı reddediyor.
    loadFn.mockResolvedValue({ symbols: ['GARAN', 'THYAO', 'UMPAS'], bars: 40 });
  });

  it('kapsamda olup satır üretmeyen sembolü SÖYLÜYOR', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    expect(await screen.findByText(/1 sembol taranamadı \(UMPAS\)/)).toBeTruthy();
  });

  it('sebebini de yazıyor — sadece sayı değil', async () => {
    const user = userEvent.setup();
    await tumPiyasa(user);
    expect(await screen.findByText(/ölçüm yapacak kadar işlem görmemişler/)).toBeTruthy();
  });

  it('hepsi ölçülebiliyorsa not HİÇ çıkmıyor', async () => {
    // Gereksiz uyarı da bir kusurdur: her açılışta görünen bir not okunmaz olur.
    loadFn.mockResolvedValue({ symbols: ['GARAN', 'THYAO'], bars: 40 });
    const user = userEvent.setup();
    await tumPiyasa(user);
    await screen.findByRole('table', { name: 'Radar tablosu' });
    expect(screen.queryByText(/sembol taranamadı/)).toBeNull();
  });

  it('izleme listesi kapsamında da söylüyor', async () => {
    // En can yakıcı hâli: kullanıcının KENDİ eklediği sembol sessizce düşüyordu.
    localStorage.setItem('radar.liste.v1', JSON.stringify({ bist: ['THYAO', 'UMPAS'] }));
    localStorage.setItem('radar.kapsam.v1', JSON.stringify('liste'));
    render(<Radar market="bist" symbol="" client={FAKE_CLIENT} onSelect={noop} onClose={noop} />);
    expect(await screen.findByText(/1 sembol taranamadı \(UMPAS\)/)).toBeTruthy();
  });
});

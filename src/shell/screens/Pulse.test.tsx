import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PulseRow } from '../../core/screen/pulse';
import type { AkisGunleri } from '../../core/screen/akisGunleri';

const pulseFn = vi.fn();
const correlateFn = vi.fn();
const akisFn = vi.fn();
const FAKE_ANALYSIS = {
  client: { pulse: pulseFn, correlate: correlateFn, akisGunleri: akisFn, size: 2 },
  symbols: ['AAA', 'BBB', 'CCC', 'DDD'],
  bars: 250,
  status: 'ready' as const,
  error: null,
  progress: null,
};
vi.mock('../useAnalysis', () => ({ useAnalysis: () => FAKE_ANALYSIS }));

const sectorsFn = vi.fn();
vi.mock('../../data-client/sectors', () => ({
  sectorsClient: { map: (...a: unknown[]) => sectorsFn(...a) },
}));

// Canvas jsdom'da çizilmez.
vi.mock('../chart/HeatMap', () => ({
  HeatMap: ({ rows, order, layout }: { rows: PulseRow[]; order?: string[]; layout?: string }) => (
    <div data-testid="heatmap" data-order={order?.join(',') ?? 'yok'} data-layout={layout ?? 'yok'}>
      {rows.length} kutu
    </div>
  ),
}));

import userEvent from '@testing-library/user-event';
import { decodeScreen } from '../../core/screen/share';
import { METRIC_DEFS } from '../../core/screen/metrics';

import Pulse from './Pulse';

function row(symbol: string, changePct: number, value: number): PulseRow {
  return {
    symbol,
    last: 10,
    changePct,
    value,
    fromHigh: -2,
    fromLow: 5,
    newHigh: changePct > 3,
    newLow: false,
    bars: 250,
  };
}

const push = vi.fn();
const STATE = { v: 'nabiz', m: 'bist', s: '', tf: 'D', cmp: '' };

beforeEach(() => {
  vi.clearAllMocks();
  sectorsFn.mockResolvedValue(null); // varsayılan: sınıflandırma yok
  akisFn.mockResolvedValue(null); // varsayılan: kare yok → oynatıcı yok
  const rows = [
    row('AAA', 4, 5000),
    row('BBB', 1, 1000),
    row('CCC', -2, 9000),
    row('DDD', -1, 100),
  ];
  pulseFn.mockResolvedValue({
    rows,
    summary: {
      symbols: 4,
      advancing: 2,
      declining: 2,
      unchanged: 0,
      breadthPct: 50,
      medianChangePct: 0,
      totalValue: 15100,
      upValue: 6000,
      downValue: 9100,
      flowPct: -20.5,
      newHighs: 1,
      newLows: 0,
    },
    ms: 12,
  });
  correlateFn.mockResolvedValue({
    symbols: ['AAA', 'BBB', 'CCC', 'DDD'],
    matrix: new Float64Array(16),
    order: [2, 3, 0, 1],
    clusterOf: [0, 0, 1, 1],
    clusters: 2,
    ms: 99,
  });
});

/**
 * Akış TABLOSU. Sektör adı artık iki yerde: haritada (şekil) ve tabloda
 * (ayrıntı). İkisi de doğru; test hangisini sınadığını söylemek zorunda.
 */
function akisTablosu(): HTMLElement {
  const tablo = document.querySelector('table.pulse__flows');
  if (!tablo) throw new Error('akış tablosu yok');
  return tablo as HTMLElement;
}

describe('Nabız', () => {
  it('genişlik ve para akışını özet kartlarında gösterir', async () => {
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('Genişlik')).toBeInTheDocument());

    expect(screen.getByText('2 yükselen · 2 düşen')).toBeInTheDocument();
    // Sayıca eşit ama para düşenlerde → akış negatif.
    expect(screen.getByText('-%20,5')).toBeInTheDocument();
    expect(screen.getByText('1 / 0')).toBeInTheDocument();
  });

  // İki yerleşim iki ayrı soruya cevap veriyor ve biri ötekinin yerine
  // geçmiyor. Varsayılan para akışı: ekranın kendi sorusu "Piyasada bugün ne
  // oluyor?" ve ona cevap veren şey paranın nerede olduğu. Ağaç haritası
  // kutuları büyüklüğe göre sıraladığı için kümeleme sırasını KORUYAMAZ —
  // o yüzden sıra değil, yerleşim seçiliyor.
  it('varsayılan yerleşim para akışı (ağaç haritası)', async () => {
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByTestId('heatmap')).toHaveTextContent('4 kutu'));
    expect(screen.getByTestId('heatmap')).toHaveAttribute('data-layout', 'treemap');
  });

  it('kümeleme sırası açılınca ızgaraya geçer ve sırayı alır', async () => {
    const user = userEvent.setup();
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByTestId('heatmap')).toHaveTextContent('4 kutu'));

    await user.click(screen.getByText('Kümeleme sırası'));

    await waitFor(() =>
      expect(screen.getByTestId('heatmap')).toHaveAttribute('data-order', 'CCC,DDD,AAA,BBB'),
    );
    expect(screen.getByTestId('heatmap')).toHaveAttribute('data-layout', 'grid');
  });

  it('grup akışı işlem değerine göre sıralı ve en çok işlem görenle etiketli', async () => {
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(within(akisTablosu()).getByText(/CCC grubu/)).toBeInTheDocument());

    const rows = screen.getAllByRole('row');
    const flowRows = rows.filter((r) => r.textContent?.includes('grubu'));
    expect(flowRows[0]).toHaveTextContent('CCC grubu'); // 9100 > 6000
    expect(flowRows[1]).toHaveTextContent('AAA grubu');
  });

  it('grup etiketinin sektör olmadığını açıkça söyler', async () => {
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() =>
      expect(screen.getByText(/Resmî sektör sınıflandırması değil/)).toBeInTheDocument(),
    );
  });

  it('nabız kümelemeyi beklemez (ısı haritası önce gelir)', async () => {
    let resolveCorrelate: ((v: unknown) => void) | null = null;
    correlateFn.mockReturnValue(new Promise((r) => (resolveCorrelate = r)));

    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByTestId('heatmap')).toHaveTextContent('4 kutu'));
    expect(screen.getByTestId('heatmap')).toHaveAttribute('data-order', 'yok');
    expect(resolveCorrelate).not.toBeNull();
  });
});

describe('Nabız — sektör bazlı para akışı', () => {
  const SECTORS = {
    source: 'İş Yatırım',
    generated: 1,
    of: { AAA: 'Bankacılık', BBB: 'Bankacılık', CCC: 'Demir Çelik' },
  };

  it('sınıflandırma varsa varsayılan görünüm sektörler olur', async () => {
    sectorsFn.mockResolvedValue(SECTORS);
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText(/Para akışı — sektörler/)).toBeInTheDocument());
    expect(within(akisTablosu()).getByText('Bankacılık')).toBeInTheDocument();

    // HARİTA da doğru olmalı: tablo geçerken haritanın boş ya da yanlış
    // ölçekli olması mümkün. "Hangi endüstride para var ve yönü ne?" iki
    // boyutlu bir soru; alan büyüklüğü, renk yönü taşıyor.
    const harita = document.querySelector('.flowmap');
    expect(harita).not.toBeNull();
    const kutular = [...harita!.querySelectorAll<HTMLElement>('.flowmap__cell')];
    expect(kutular.length).toBeGreaterThan(1);
    // Haritanın TEK iddiası bu: alan işlem değerine orantılı. Sıralamayı
    // sınamak yetmez — yanlış ölçekli bir harita da sırayı doğru verir.
    // Kutular yüzde uzayında konumlandığı için oran genişlikten bağımsız.
    const alan = (ad: string) => {
      const kutu = kutular.find((k) => k.textContent?.includes(ad));
      if (!kutu) throw new Error(`haritada ${ad} yok`);
      return parseFloat(kutu.style.width) * parseFloat(kutu.style.height);
    };
    // Bankacılık = AAA 5000 + BBB 1000 = 6000 · Demir Çelik = CCC 9000.
    const toplam = 5000 + 1000 + 9000 + 100;
    expect(alan('Bankacılık') / 10000).toBeCloseTo(6000 / toplam, 3);
    expect(alan('Demir Çelik') / 10000).toBeCloseTo(9000 / toplam, 3);
    expect(within(akisTablosu()).getByText('Demir Çelik')).toBeInTheDocument();
  });

  it('eşleşmeyen sembolü gizlemez ve kapsamayı yazar', async () => {
    sectorsFn.mockResolvedValue(SECTORS);
    render(<Pulse state={STATE} push={push} />);
    // DDD'nin sektörü yok: ayrı satırda görünmeli, toplamdan düşülmemeli.
    await waitFor(() =>
      expect(within(akisTablosu()).getByText('Sınıflandırılmamış')).toBeInTheDocument(),
    );
    expect(screen.getByText(/3\/4 sembol eşleşti/)).toBeInTheDocument();
  });

  it('sektör payları toplam işlem değerinin tamamı üzerinden', async () => {
    sectorsFn.mockResolvedValue(SECTORS);
    render(<Pulse state={STATE} push={push} />);
    // Bankacılık = AAA 5000 + BBB 1000 = 6000 / 15100 = %39,7
    await waitFor(() => expect(screen.getByText('%39,7')).toBeInTheDocument());
    // Sınıflandırılmamış = DDD 100 / 15100 = %0,7 — gizlenmiş olsaydı paylar şişerdi.
    expect(screen.getByText('%0,7')).toBeInTheDocument();
  });

  it('sektör satırından o sektör seçili tarayıcıya geçilir', async () => {
    sectorsFn.mockResolvedValue(SECTORS);
    const user = userEvent.setup();
    render(<Pulse state={STATE} push={push} />);
    await user.click(
      await screen.findByRole('button', { name: 'Bankacılık sektörünü tarayıcıda aç' }),
    );

    expect(push).toHaveBeenCalledWith(expect.objectContaining({ v: 'tarayici' }));
    const link = push.mock.calls.at(-1)![0].f as string;
    const known = new Set(METRIC_DEFS.map((m) => m.id));
    const decoded = decodeScreen(link, known);
    expect(decoded.dropped).toEqual([]);
    // Sektör seçili ama KURAL yok: filtreyi kullanıcı kuracak.
    expect(decoded.state!.sectors).toEqual(['Bankacılık']);
    expect(decoded.state!.rules).toEqual([]);
  });

  /*
    TABLONUN ERİŞİLEBİLİR ADI. Sütun başlığı "Sektör"/"Grup" diye değişiyordu
    ama `caption` sabitti: sektör görünümünde ekran okuyucu tabloyu hâlâ
    "Kümelere göre" diye duyuruyordu. Gören kullanıcı farkı sütun başlığından
    anlıyor; duyanın tek ipucu bu satır.
  */
  it('tablonun erişilebilir adı gruplamayla değişiyor', async () => {
    sectorsFn.mockResolvedValue(SECTORS);
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(within(akisTablosu()).getByText('Bankacılık')).toBeInTheDocument());
    expect(akisTablosu()).toHaveAccessibleName(/Sektörlere göre/);

    await userEvent.selectOptions(screen.getByLabelText('Gruplama'), 'cluster');
    await waitFor(() => expect(akisTablosu()).toHaveAccessibleName(/Davranış gruplarına göre/));
  });

  it('sınıflandırılmamış satır tarayıcıya geçiş sunmaz', async () => {
    sectorsFn.mockResolvedValue(SECTORS);
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() =>
      expect(within(akisTablosu()).getByText('Sınıflandırılmamış')).toBeInTheDocument(),
    );
    // "Sektörü bilinmiyor" bir sektör değil; tarayıcıda karşılığı yok.
    expect(
      screen.queryByRole('button', { name: 'Sınıflandırılmamış sektörünü tarayıcıda aç' }),
    ).toBeNull();
  });

  /*
    VİRGÜLLÜ SEKTÖR ADI. Eskiden bu satırda "Tara" düğmesi HİÇ çıkmıyordu:
    virgül bağlantıdaki sektör ayırıcısıydı, ad bölünürse tarayıcı sessizce
    tüm piyasayı gösterirdi ve düğmeyi gizlemek doğru karardı.

    Borsa İstanbul'un resmî sınıflandırması gelince o karar yetmez oldu:
    23 sektörün 7'sinin adında virgül var ve işlem değerinde en büyük sektör
    ("Kimya, Petrol, Plastik") onlardan biri. Geçiş, en çok kullanılacak
    yerlerde yoktu. Ayırıcı artık kaçırılıyor (bkz. `share.ts`), düğme de
    çıkıyor — ve bağlantı ADI AYNEN taşıyor.
  */
  it('virgüllü sektör adı da tarayıcıya geçiş sunuyor', async () => {
    sectorsFn.mockResolvedValue({
      ...SECTORS,
      of: { AAA: 'Gıda, İçecek', BBB: 'Gıda, İçecek', CCC: 'Demir Çelik' },
    });
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() =>
      expect(within(akisTablosu()).getByText('Gıda, İçecek')).toBeInTheDocument(),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Gıda, İçecek sektörünü tarayıcıda aç' }),
    );
    const hedef = push.mock.calls.at(-1)![0] as { v: string; f: string };
    expect(hedef.v).toBe('tarayici');
    // Bağlantı tek bir sektör taşımalı ve adı bölünmemiş olmalı.
    expect(decodeScreen(hedef.f, new Set(['chg21'])).state!.sectors).toEqual(['Gıda, İçecek']);

    expect(
      screen.getByRole('button', { name: 'Demir Çelik sektörünü tarayıcıda aç' }),
    ).toBeInTheDocument();
  });

  it('sınıflandırma yoksa davranış gruplarına düşer ve nedenini söyler', async () => {
    sectorsFn.mockResolvedValue(null);
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() =>
      expect(screen.getByText(/Para akışı — davranış grupları/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Sektör dosyası bu piyasada yok/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Gruplama')).toBeNull();
  });
});

describe('Pulse — paket inerken', () => {
  it('"hesaplanıyor" demez, ne kadar indiğini yazar', async () => {
    const prev = { status: FAKE_ANALYSIS.status, progress: FAKE_ANALYSIS.progress };
    Object.assign(FAKE_ANALYSIS, {
      status: 'loading',
      progress: { loaded: 259 * 1024, total: 979 * 1024 },
    });
    try {
      render(<Pulse state={STATE} push={push} />);
      expect(await screen.findByText(/Veri paketi indiriliyor/)).toBeInTheDocument();
      // İndirme sırasında "hesaplanıyor" yanlış bilgiydi.
      expect(screen.queryByText('hesaplanıyor…')).toBeNull();
    } finally {
      Object.assign(FAKE_ANALYSIS, prev);
    }
  });
});

describe('Pulse — veri gelmezse', () => {
  it('sonsuza kadar iskelet göstermez, nedenini yazar', async () => {
    // Sessiz başarısızlık: ekran "yükleniyor" gibi durup hiç bitmiyordu.
    const prev = { status: FAKE_ANALYSIS.status, error: FAKE_ANALYSIS.error };
    Object.assign(FAKE_ANALYSIS, { status: 'error', error: 'Paket indirilemedi (HTTP 404)' });
    try {
      render(<Pulse state={STATE} push={push} />);
      expect(await screen.findByText('Piyasa verisi yüklenemedi')).toBeInTheDocument();
      expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
    } finally {
      Object.assign(FAKE_ANALYSIS, prev);
    }
  });
});

describe('Nabız — hesap çökerse', () => {
  it('"sonuç yok" demez, hatayı gösterir', async () => {
    // Boş sonuç ile ÇÖKEN hesap aynı şey değil: ilkinde kullanıcı filtresini
    // gevşetir, ikincisinde bekler. İkisini aynı ekranla anlatmak yanıltıyordu.
    pulseFn.mockRejectedValue(new Error('worker çöktü'));
    render(<Pulse state={STATE} push={push} />);
    expect(await screen.findByText('Piyasa özeti hesaplanamadı')).toBeInTheDocument();
    expect(screen.getByText(/worker çöktü/)).toBeInTheDocument();
  });
});

/**
 * Sektör ROTASYONU.
 *
 * Eksik olan buydu: akış yalnızca SON BARI ölçüyordu. "Piyasada bugün ne
 * oluyor" için doğru, ama "endüstriden para akışı" bir pencere sorusu —
 * cevabı pay SEVİYESİ değil pay DEĞİŞİMİ.
 */
describe('Nabız — sektör rotasyonu', () => {
  const SEKTORLER = {
    of: { AAA: 'Banka', BBB: 'Banka', CCC: 'Çimento', DDD: 'Çimento' },
    source: 'test',
    generated: 1,
  };

  function pencere(symbol: string, value: number, prevValue: number, returnPct: number) {
    return { symbol, value, prevValue, returnPct, bars: 21 };
  }

  beforeEach(() => {
    sectorsFn.mockResolvedValue(SEKTORLER);
  });

  it('dönem seçilince pencere toplamları isteniyor', async () => {
    const user = userEvent.setup();
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(pulseFn).toHaveBeenCalled());
    // Son bar görünümünde pencere İSTENMİYOR: 200 sembollük ikinci döngü
    // boşuna çalışmasın.
    expect(pulseFn.mock.calls[0][1]).toEqual({});

    await user.selectOptions(await screen.findByLabelText('Dönem'), '21');
    await waitFor(() =>
      expect(pulseFn.mock.calls[pulseFn.mock.calls.length - 1][1]).toEqual({ rotationBars: 21 }),
    );
  });

  it('pay değişimini puan olarak gösteriyor ve tek cümleyle özetliyor', async () => {
    const user = userEvent.setup();
    // Banka payı %40 → %60 (+20 puan), Çimento tersi.
    pulseFn.mockImplementation(async (_m: string, o: { rotationBars?: number } = {}) => ({
      rows: [row('AAA', 4, 5000), row('BBB', 1, 1000), row('CCC', -2, 9000), row('DDD', -1, 100)],
      summary: {
        symbols: 4,
        advancing: 2,
        declining: 2,
        unchanged: 0,
        breadthPct: 50,
        medianChangePct: 0,
        totalValue: 15100,
        upValue: 6000,
        downValue: 9100,
        flowPct: -20.5,
        newHighs: 1,
        newLows: 0,
      },
      windows: o.rotationBars
        ? [
            pencere('AAA', 400, 250, 8),
            pencere('BBB', 200, 150, 4),
            pencere('CCC', 300, 500, -3),
            pencere('DDD', 100, 100, -1),
          ]
        : undefined,
      ms: 12,
    }));

    render(<Pulse state={STATE} push={push} />);
    await user.selectOptions(await screen.findByLabelText('Dönem'), '21');

    expect(await screen.findByText(/para en çok/i)).toHaveTextContent('Banka');
    expect(screen.getByText(/para en çok/i)).toHaveTextContent('+%20,0 puan');

    // Tablo pay DEĞİŞİMİNE göre sıralı: sorulan şey "nereye kaydı".
    const satirlar = within(akisTablosu())
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent!);
    expect(satirlar[0]).toContain('Banka');
    expect(satirlar[0]).toContain('+%20,0 puan');
  });

  // Pencere verisi gelmezse eski (son bar) görünüm korunmalı; boş tablo değil.
  it('pencere verisi yoksa son bar görünümü kalıyor', async () => {
    const user = userEvent.setup();
    render(<Pulse state={STATE} push={push} />);
    await user.selectOptions(await screen.findByLabelText('Dönem'), '21');
    // Sahte istemci `windows` döndürmüyor (varsayılan mock).
    await waitFor(() => expect(screen.getByText(/Ağırlıklı değişim/)).toBeInTheDocument());
    expect(screen.queryByText(/para en çok/i)).toBeNull();
  });
});

/*
 * PARA AKIŞI OYNATICISI.
 *
 * Sektör haritası tek kareydi: bugün. "Para hangi endüstriye göçüyor?" bir
 * hareket sorusu; tek kare hareketi göstermez. Kareler worker'dan gün eksenine
 * hizalı geliyor; arayüz onları kaydırıcıyla gezdiriyor ya da oynatıyor.
 */
describe('Nabız — para akışı oynatıcısı', () => {
  const SEKTORLER = {
    of: { AAA: 'Banka', BBB: 'Banka', CCC: 'Çimento' },
    source: 'test',
    generated: 1,
  };

  /**
   * Üç kare (gün 20000…20002; son kare bugün). Son kare, `pulseFn`in
   * bugünkü satırlarıyla BİREBİR aynı: AAA 5000/+4, BBB 1000/+1, CCC 9000/−2,
   * DDD 100/−1 (sektörü yok). İlk karede para tersine: Banka 10 000,
   * Çimento 100; DDD ilk iki gün işlem görmüyor (değer 0, değişim NaN).
   */
  function kareler(): AkisGunleri {
    const N = 3;
    const deger = new Float32Array(4 * N);
    const degisim = new Float32Array(4 * N).fill(Number.NaN);
    const yaz = (s: number, d: number, v: number, c: number) => {
      deger[s * N + d] = v;
      degisim[s * N + d] = c;
    };
    // AAA
    yaz(0, 0, 9000, 5);
    yaz(0, 1, 7000, 2);
    yaz(0, 2, 5000, 4);
    // BBB
    yaz(1, 0, 1000, 1);
    yaz(1, 1, 1000, 0);
    yaz(1, 2, 1000, 1);
    // CCC
    yaz(2, 0, 100, -2);
    yaz(2, 1, 4000, -1);
    yaz(2, 2, 9000, -2);
    // DDD yalnızca bugün
    yaz(3, 2, 100, -1);
    return {
      gunler: Int32Array.from([20000, 20001, 20002]),
      semboller: ['AAA', 'BBB', 'CCC', 'DDD'],
      deger,
      degisim,
    };
  }

  function haritaAlani(ad: string): number {
    const kutular = [...document.querySelectorAll<HTMLElement>('.flowmap .flowmap__cell')];
    const kutu = kutular.find((k) => k.textContent?.includes(ad));
    if (!kutu) throw new Error(`haritada ${ad} yok`);
    return (parseFloat(kutu.style.width) * parseFloat(kutu.style.height)) / 10000;
  }

  beforeEach(() => {
    sectorsFn.mockResolvedValue(SEKTORLER);
    akisFn.mockResolvedValue(kareler());
  });

  it('kaydırıcı geçmiş güne alınca harita o kareye geçiyor, tablo bugünde kalıyor', async () => {
    render(<Pulse state={STATE} push={push} />);
    const kaydirici = await screen.findByLabelText('Para akışı günü');
    expect(akisFn).toHaveBeenCalledWith('bist', expect.any(Number));
    // Başlangıç bugün: harita bugünkü tabloyla aynı paylaşımda.
    expect(document.querySelector('.pulse__oynatici-tarih')).toHaveTextContent('bugün');
    // Banka 6000 / (6000 + 9000 + 100)
    expect(haritaAlani('Banka')).toBeCloseTo(6000 / 15100, 3);

    fireEvent.change(kaydirici, { target: { value: '0' } });
    await waitFor(() =>
      expect(document.querySelector('.pulse__oynatici-tarih')).toHaveTextContent(/2 gün önce/),
    );
    // İlk karede para bankada: 10 000 / 10 100.
    expect(haritaAlani('Banka')).toBeCloseTo(10000 / 10100, 3);
    // Harita geçmişi gösterirken TABLO bugünü göstermeye devam ediyor ve bu
    // açıkça söyleniyor — iki farklı günü aynı ekranda sessizce koymak yanlış.
    expect(screen.getByText(/alttaki tablo bugünü/)).toBeInTheDocument();
    expect(within(akisTablosu()).getByText('Banka')).toBeInTheDocument();
    // Haritanın etiketi de günü taşıyor: ekran okuyucu hangi günü duyduğunu bilsin.
    expect(screen.getByRole('list', { name: /para akışı haritası.*gün/ })).toBeInTheDocument();
  });

  it('bugünkü kare tablodaki sayıyla birebir — iki ayrı toplama semantiği yok', async () => {
    render(<Pulse state={STATE} push={push} />);
    await screen.findByLabelText('Para akışı günü');
    // Kareler yüklenmeden ÖNCEKİ harita `pulse` satırlarından; yüklenince son
    // kareden. İkisi aynı alanı vermeli: Banka 6000/15100, Çimento 9000/15100
    // (DDD sektörsüz ama paydada — bugünkü tabloda da öyle).
    expect(haritaAlani('Banka')).toBeCloseTo(6000 / 15100, 3);
    expect(haritaAlani('Çimento')).toBeCloseTo(9000 / 15100, 3);
    // Ağırlıklı değişim de aynı: Banka (5000×4 + 1000×1)/6000 = 3,5.
    expect(
      screen.getByRole('button', { name: /^Banka: işlem değeri payı, ağırlıklı değişim \+%3,50/ }),
    ).toBeInTheDocument();
  });

  it('oynat: baştan başlıyor, kare kare ilerliyor, sonda kendi duruyor', async () => {
    const user = userEvent.setup();
    render(<Pulse state={STATE} push={push} />);
    await screen.findByLabelText('Para akışı günü');
    await user.click(screen.getByRole('button', { name: 'Para akışını oynat' }));
    // Sondayken basıldı → baştan.
    expect(document.querySelector('.pulse__oynatici-tarih')).toHaveTextContent(/2 gün önce/);
    expect(screen.getByRole('button', { name: 'Oynatmayı durdur' })).toBeInTheDocument();
    await waitFor(
      () =>
        expect(document.querySelector('.pulse__oynatici-tarih')).toHaveTextContent(/1 gün önce/),
      { timeout: 2000 },
    );
    await waitFor(
      () => expect(document.querySelector('.pulse__oynatici-tarih')).toHaveTextContent('bugün'),
      { timeout: 2000 },
    );
    // Sonda durdu: döngü yok, düğme yine "oynat".
    expect(screen.getByRole('button', { name: 'Para akışını oynat' })).toBeInTheDocument();
  });

  it('kaydırıcıya dokunmak oynatmayı durduruyor', async () => {
    const user = userEvent.setup();
    render(<Pulse state={STATE} push={push} />);
    const kaydirici = await screen.findByLabelText('Para akışı günü');
    await user.click(screen.getByRole('button', { name: 'Para akışını oynat' }));
    fireEvent.change(kaydirici, { target: { value: '1' } });
    expect(screen.getByRole('button', { name: 'Para akışını oynat' })).toBeInTheDocument();
    expect(document.querySelector('.pulse__oynatici-tarih')).toHaveTextContent(/1 gün önce/);
  });

  it('hareket azaltma tercihi: otomatik oynatma kapalı, kaydırıcı çalışıyor', async () => {
    const asil = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      ...asil(q),
      matches: q.includes('prefers-reduced-motion'),
    })) as typeof window.matchMedia;
    try {
      render(<Pulse state={STATE} push={push} />);
      const kaydirici = await screen.findByLabelText('Para akışı günü');
      expect(screen.getByRole('button', { name: 'Para akışını oynat' })).toBeDisabled();
      expect(screen.getByText(/Hareket azaltma tercihin açık/)).toBeInTheDocument();
      fireEvent.change(kaydirici, { target: { value: '0' } });
      await waitFor(() =>
        expect(document.querySelector('.pulse__oynatici-tarih')).toHaveTextContent(/2 gün önce/),
      );
    } finally {
      window.matchMedia = asil;
    }
  });

  it('rotasyon döneminde oynatıcı yok: iki zaman ekseni üst üste binmesin', async () => {
    const user = userEvent.setup();
    render(<Pulse state={STATE} push={push} />);
    await screen.findByLabelText('Para akışı günü');
    await user.selectOptions(screen.getByLabelText('Dönem'), '21');
    await waitFor(() => expect(screen.queryByLabelText('Para akışı günü')).toBeNull());
  });

  it('kareler gelmezse oynatıcı çizilmiyor, harita bugünle kalıyor', async () => {
    akisFn.mockRejectedValue(new Error('yok'));
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(akisFn).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('.flowmap')).not.toBeNull());
    expect(screen.queryByLabelText('Para akışı günü')).toBeNull();
    expect(haritaAlani('Banka')).toBeCloseTo(6000 / 15100, 3);
  });

  it('sınıflandırma yokken kare istenmiyor — sektör görünümü de yok', async () => {
    sectorsFn.mockResolvedValue(null);
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(pulseFn).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('.flowmap')).not.toBeNull());
    expect(screen.getByText(/davranış grupları/)).toBeInTheDocument();
    expect(akisFn).not.toHaveBeenCalled();
  });
});

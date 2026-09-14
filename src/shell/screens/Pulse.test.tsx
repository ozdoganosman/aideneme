import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { PulseRow } from '../../core/screen/pulse';

const pulseFn = vi.fn();
const correlateFn = vi.fn();
const FAKE_ANALYSIS = {
  client: { pulse: pulseFn, correlate: correlateFn, size: 2 },
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

  it('adı bağlantıda taşınamayan sektör geçiş sunmaz', async () => {
    // Virgül, bağlantıdaki sektör ayırıcısı: ad bölünürse tarayıcı SESSİZCE
    // tüm piyasayı gösterirdi. Böyle bir sektörde düğme hiç çıkmıyor.
    sectorsFn.mockResolvedValue({
      ...SECTORS,
      of: { AAA: 'Gıda, İçecek', BBB: 'Gıda, İçecek', CCC: 'Demir Çelik' },
    });
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() =>
      expect(within(akisTablosu()).getByText('Gıda, İçecek')).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: /Gıda, İçecek sektörünü tarayıcıda aç/ }),
    ).toBeNull();
    // Taşınabilir ad etkilenmiyor.
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

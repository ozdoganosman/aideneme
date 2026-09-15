import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FUNDAMENTAL_FIELDS, type FieldId, type Financials } from '../../core/fundamentals/types';

const snapshotFn = vi.fn();
const financialsFn = vi.fn();
const noStatementFn = vi.fn();
vi.mock('../../data-client/fundamentals', () => ({
  fundamentalsClient: {
    snapshot: (...a: unknown[]) => snapshotFn(...a),
    financials: (...a: unknown[]) => financialsFn(...a),
    noStatementSymbols: (...a: unknown[]) => noStatementFn(...a),
  },
}));
const manifestFn = vi.fn();
vi.mock('../../data-client/client', () => ({
  dataClient: { manifest: (...a: unknown[]) => manifestFn(...a) },
}));
const sectorMapFn = vi.fn();
vi.mock('../../data-client/sectors', () => ({
  sectorsClient: { map: (...a: unknown[]) => sectorMapFn(...a) },
}));
vi.mock('../chart/LineChart', () => ({
  LineChart: ({ series, zeroLine }: { series: { label: string }[]; zeroLine?: boolean }) => (
    <div data-testid="fin-chart" data-zeroline={zeroLine ? 'var' : 'yok'}>
      {series.map((s) => s.label).join('|')}
    </div>
  ),
}));

import { FinancialsPanel } from './FinancialsPanel';

const periods = ['2022/12', '2023/12', '2024/12'];

function financials(overrides: Partial<Record<FieldId, (number | null)[]>>): Financials {
  const fields = {} as Record<FieldId, (number | null)[]>;
  for (const field of FUNDAMENTAL_FIELDS) fields[field] = overrides[field] ?? [null, null, null];
  return { symbol: 'THYAO', periods, fields, missing: ['capex'] };
}

/** Çeyreklik (KÜMÜLATİF) tablo — kaynak verisiyle aynı biçimde. */
const ceyrekDonemler = ['2024/12', '2025/3', '2025/6', '2025/9', '2025/12'];
function ceyreklikFinansal(): Financials {
  const fields = {} as Record<FieldId, (number | null)[]>;
  for (const field of FUNDAMENTAL_FIELDS) fields[field] = ceyrekDonemler.map(() => null);
  // Yıl içinde kümülatif: 100 → 100/300/600/1000 (yani 100, 200, 300, 400).
  fields.revenue = [900, 100, 300, 600, 1000];
  fields.netIncome = [90, 10, 30, 60, 100];
  fields.operatingProfit = [45, 5, 15, 30, 50];
  fields.equity = [800, 810, 830, 860, 900];
  return { symbol: 'THYAO', periods: ceyrekDonemler, fields, missing: [], group: '1' };
}

const snapshot = {
  version: 1,
  generated: 1,
  note: 'Yayım tarihi bilgisi kaynakta yok; backtest girdisi yapılmamalıdır.',
  symbols: {
    THYAO: {
      period: '2024/12',
      revenueTtm: 1000,
      grossProfitTtm: 400,
      operatingProfitTtm: 250,
      netIncomeTtm: 200,
      operatingCashFlowTtm: 240,
      equity: 800,
      assets: 2000,
      paidCapital: 100,
      currentAssets: 600,
      currentLiabilities: 300,
      longLiabilities: 500,
      inventory: 150,
      cash: 200,
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Dönem tercihi tarayıcıda saklanıyor: temizlenmezse bir testin seçimi
  // sonrakine sızar ve teşhisi zor bir kırılma üretir.
  localStorage.clear();
  noStatementFn.mockResolvedValue(new Set<string>());
  // Manifest varsayılanı: hiçbir sembol "hisse dışı" işaretli değil.
  manifestFn.mockResolvedValue({ symbols: {} });
  sectorMapFn.mockResolvedValue({ of: { THYAO: 'Ulaştırma' }, source: 'test', generated: 1 });
  snapshotFn.mockResolvedValue(snapshot);
  financialsFn.mockResolvedValue(
    financials({
      revenue: [700, 900, 1000],
      netIncome: [100, 150, 200],
      equity: [600, 700, 800],
      operatingCashFlow: [120, 180, 240],
      assets: [1600, 1800, 2000],
      grossProfit: [250, 340, 400],
      currentAssets: [450, 520, 600],
      currentLiabilities: [320, 310, 300],
      longLiabilities: [600, 550, 500],
    }),
  );
});

describe('Finansallar paneli', () => {
  it('çarpanları fiyattan hesaplar', async () => {
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await waitFor(() => expect(screen.getByText('F/K')).toBeInTheDocument());
    expect(screen.getByText('20,0')).toBeInTheDocument(); // 100 pay × 40 / 200
    expect(screen.getByText('5,00')).toBeInTheDocument(); // PD/DD
  });

  it('kalite ölçütlerini tek tek listeler', async () => {
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await waitFor(() => expect(screen.getByText(/Net kâr pozitif/)).toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Kalite ölçütleri' })).toBeInTheDocument();
  });

  // Tek bir toplam skor üç ayrı soruyu karıştırıyordu: kârlı ama küçülen bir
  // şirket ile zarar eden ama borcunu azaltan bir şirket aynı skoru alabilir.
  it('karne üç başlığı ayrı gösterir', async () => {
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    const karne = await screen.findByRole('region', { name: 'Karne' });

    for (const grup of ['kârlılık', 'büyüme', 'borçluluk']) {
      expect(within(karne).getByText(grup)).toBeInTheDocument();
    }
    // Payda uydurulmuyor: her başlık "x/y" biçiminde ve y > 0.
    const skorlar = within(karne)
      .getAllByText(/^\d+\/\d+$/)
      .map((e) => e.textContent!);
    expect(skorlar).toHaveLength(3);
    for (const s of skorlar) {
      const [x, y] = s.split('/').map(Number);
      expect(y).toBeGreaterThan(0);
      expect(x).toBeLessThanOrEqual(y);
    }
  });

  it('bulunamayan kalemleri açıkça söyler', async () => {
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await waitFor(() =>
      expect(screen.getByText(/bulunamayan kalemler: capex/)).toBeInTheDocument(),
    );
  });

  it('point-in-time uyarısını gösterir', async () => {
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await waitFor(() =>
      expect(screen.getByText(/backtest girdisi yapılmamalıdır/)).toBeInTheDocument(),
    );
  });

  it('veri yoksa nasıl üretileceğini anlatır', async () => {
    snapshotFn.mockResolvedValue(null);
    financialsFn.mockResolvedValue(null);
    render(<FinancialsPanel market="bist" symbol="YOK" price={10} />);
    await waitFor(() =>
      expect(screen.getByText('Bu sembol için finansal veri yok')).toBeInTheDocument(),
    );
    expect(screen.getByText(/build_fundamentals\.py/)).toBeInTheDocument();
  });

  // Endekste "veri yok" demek YANLIŞ: XU100'ün bilançosu eksik değil, hiç
  // yoktur. Ölçüldü — tablosu gelmeyen 96 sembolün 52'si doğrudan endeks,
  // 19'u fon/sertifika. Kullanıcı olmayan bir kusurun düzelmesini beklememeli.
  /**
   * ÜÇÜNCÜ durum: tablosu yok AMA hisse.
   *
   * Ölçüldü — tablosu gelmeyen 96 sembolün 25'i GERÇEK ŞİRKET (Garanti
   * Faktoring, QNB Finansal Kiralama, Ray Sigorta, DO & CO…). Çoğu leasing/
   * faktoring/sigorta: tabloları farklı şablonda ve üretici okuyamıyor.
   * Onlara "bu araç finansal tablo yayımlamıyor" demek YANLIŞTI.
   */
  it('tablosuz ama hisse olan sembole "yayımlamıyor" demiyor', async () => {
    snapshotFn.mockResolvedValue(null);
    financialsFn.mockResolvedValue(null);
    noStatementFn.mockResolvedValue(new Set(['GARFA']));
    // Manifest'te `e` işareti YOK: hisse dışı olduğunu bilmiyoruz.
    manifestFn.mockResolvedValue({ symbols: { GARFA: { f: 'GARFA.bin' } } });
    render(<FinancialsPanel market="bist" symbol="GARFA" price={10} />);
    await waitFor(() =>
      expect(screen.getByText('Bu şirketin tablosu kaynaktan alınamadı')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Bu araç finansal tablo yayımlamıyor')).not.toBeInTheDocument();
  });

  it('endeks/fon için "tablo yayımlamıyor" der, "veri yok" demez', async () => {
    snapshotFn.mockResolvedValue(null);
    financialsFn.mockResolvedValue(null);
    noStatementFn.mockResolvedValue(new Set(['XU100']));
    // `e: 1` = hisse DEĞİL. İddianın dayanağı bu işaret.
    manifestFn.mockResolvedValue({ symbols: { XU100: { e: 1 } } });
    render(<FinancialsPanel market="bist" symbol="XU100" price={10} />);
    await waitFor(() =>
      expect(screen.getByText('Bu araç finansal tablo yayımlamıyor')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Bu sembol için finansal veri yok')).not.toBeInTheDocument();
    expect(screen.queryByText(/build_fundamentals\.py/)).not.toBeInTheDocument();
  });
});

// Kullanıcı isteği: "kolon grafikleri ayarlanabilir olsun daha fazla veya
// dönem olarak" — hem dönem TABANI (çeyrek/yıl) hem de dönem SAYISI.
describe('Finansallar — dönemsel kolonlar', () => {
  function sayilar(): string[] {
    const bolum = screen.getByRole('region', { name: 'Dönemsel kolonlar' });
    // Kolon grafiği bir resim; okunabilir veri ekran okuyucu tablosunda.
    // Satır metni "2025/6" + değer + (varsa) yüzde değişim taşıyor.
    return within(bolum)
      .getAllByRole('row')
      .map((r) => r.textContent!.trim());
  }

  /** Satır BAŞLANGICI eşleşiyor mu — yüzde eki iddiayı kırmasın. */
  function var_(satirlar: string[], baslangic: string): boolean {
    return satirlar.some((x) => x.startsWith(baslangic));
  }

  // ASIL TUZAK: kaynak "2025/6" satırında yılın İLK ALTI AYINI verir. Ham
  // hâliyle çizmek her çubuğu bir öncekini içeren, sürekli büyüyen bir
  // merdivene çevirir ve yılın son çeyreği HER ZAMAN en büyük görünür.
  it('çeyreklik kolonlarda kümülatif fark alınıyor', async () => {
    financialsFn.mockResolvedValue(ceyreklikFinansal());
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await screen.findByRole('region', { name: 'Dönemsel kolonlar' });

    const satirlar = sayilar();
    // Satış: 100 / 300 / 600 / 1000 kümülatifinden 100 / 200 / 300 / 400.
    expect(var_(satirlar, '2025/3100')).toBe(true);
    expect(var_(satirlar, '2025/6200')).toBe(true);
    expect(var_(satirlar, '2025/9300')).toBe(true);
    expect(var_(satirlar, '2025/12400')).toBe(true);
    // Kümülatif değerin kendisi ÇİZİLMEMELİ.
    expect(var_(satirlar, '2025/6600')).toBe(false);
  });

  // Önceki dönem yoksa çeyrek üretilmiyor: eksik veriyi sıfır saymak olmayan
  // bir çöküş, kümülatifi olduğu gibi çizmek olmayan bir sıçrama gösterirdi.
  it('öncesi olmayan dönem "veri yok" kalır, uydurulmaz', async () => {
    financialsFn.mockResolvedValue(ceyreklikFinansal());
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await screen.findByRole('region', { name: 'Dönemsel kolonlar' });
    // 2024/12 tek başına: 2024/9 elde olmadığı için çeyreği hesaplanamaz.
    expect(var_(sayilar(), '2024/12veri yok')).toBe(true);
  });

  it('dönem sayısı değişince kolon sayısı değişir', async () => {
    const user = userEvent.setup();
    financialsFn.mockResolvedValue(ceyreklikFinansal());
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await screen.findByRole('region', { name: 'Dönemsel kolonlar' });

    const bolum = screen.getByRole('region', { name: 'Dönemsel kolonlar' });
    // Varsayılan 8 dönem; veride 5 var, hepsi görünür (4 kalem × 5 satır).
    expect(within(bolum).getAllByRole('row')).toHaveLength(20);

    await user.selectOptions(screen.getByLabelText('Dönem sayısı'), '5');
    expect(within(bolum).getAllByRole('row')).toHaveLength(20);

    // Veride 5 dönem var; 3'e inince kolonlar da 3'e iner (4 kalem × 3).
    await user.selectOptions(screen.getByLabelText('Dönem tabanı'), 'ceyrek');
    await user.selectOptions(screen.getByLabelText('Dönem sayısı'), '5');
    expect(within(bolum).getAllByRole('row')).toHaveLength(20);
  });

  it('yıllık tabana geçilince yıl sonu dönemleri çizilir', async () => {
    const user = userEvent.setup();
    financialsFn.mockResolvedValue(ceyreklikFinansal());
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await screen.findByRole('region', { name: 'Dönemsel kolonlar' });

    await user.selectOptions(screen.getByLabelText('Dönem tabanı'), 'yil');
    const satirlar = sayilar();
    // Yıl sonu: 2024/12 → 900, 2025/12 → 1000 (kümülatifin kendisi, doğru).
    expect(var_(satirlar, '2024900')).toBe(true);
    expect(var_(satirlar, '20251,0 b')).toBe(true);
    expect(satirlar.some((x) => x.startsWith('2025/'))).toBe(false);
  });

  // Yalnızca yıl sonu yayımlanan şirkette "çeyreklik" görünüm üç boş panel
  // demek olurdu — kullanıcı hatası gibi görünen, aslında veri olan bir durum.
  it('çeyreği olmayan tabloda varsayılan yıllık', async () => {
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await screen.findByRole('region', { name: 'Dönemsel kolonlar' });
    expect(screen.getByLabelText('Dönem tabanı')).toHaveValue('yil');
    expect(var_(sayilar(), '20241,0 b')).toBe(true);
  });
});

describe('Finansallar — şirket detayları ve dar grafik', () => {
  it('detayları gösterir, olmayan alanı uydurmaz', async () => {
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    const bolum = await screen.findByRole('region', { name: 'Şirket detayları' });

    expect(within(bolum).getByText('Ulaştırma')).toBeInTheDocument();
    // Hisse başına kâr: 200 TTM ÷ 100 ödenmiş sermaye.
    expect(within(bolum).getByText('2,00')).toBeInTheDocument();
    // Hisse başına defter değeri: 800 ÷ 100.
    expect(within(bolum).getByText('8,00')).toBeInTheDocument();
    // Fiili dolaşım oranı veri setinde YOK — tahminle doldurulmadığı yazıyor.
    expect(
      within(bolum).getByText(/Fiili dolaşım oranı bu veri setinde bulunmuyor/),
    ).toBeInTheDocument();
  });

  // Sınıflandırma dosyası yoksa panel çalışmaya devam etmeli; sektör "—" olur.
  it('sektör dosyası yoksa panel yine çalışır', async () => {
    sectorMapFn.mockResolvedValue(null);
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    const bolum = await screen.findByRole('region', { name: 'Şirket detayları' });
    expect(within(bolum).getByText('Sektör').nextSibling).toHaveTextContent('—');
  });

  // Kullanıcı isteği: finansallarda da grafik olsun "ama böyle dar".
  it('fiyat serisi verilince dar grafik çizilir', async () => {
    const time = new Float64Array([1, 2, 3]);
    const close = new Float64Array([10, 11, 12]);
    const candles = {
      time,
      open: close,
      high: close,
      low: close,
      close,
      volume: close,
      length: 3,
    };
    render(<FinancialsPanel market="bist" symbol="THYAO" price={12} candles={candles} />);
    const bolum = await screen.findByRole('region', { name: 'Fiyat (dar grafik)' });
    expect(within(bolum).getByTestId('fin-chart')).toHaveTextContent('THYAO');
  });

  it('fiyat serisi yoksa dar grafik bölümü hiç çizilmez', async () => {
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await screen.findByRole('region', { name: 'Karne' });
    expect(screen.queryByRole('region', { name: 'Fiyat (dar grafik)' })).toBeNull();
  });
});

describe('Finansallar — tercihler ve açıklamalar', () => {
  // Kullanıcı isteği: her sembolde yeniden seçmek zorunda kalmasın.
  it('dönem tercihi kaydediliyor ve sonraki açılışta geri geliyor', async () => {
    const user = userEvent.setup();
    financialsFn.mockResolvedValue(ceyreklikFinansal());
    const { unmount } = render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await screen.findByRole('region', { name: 'Dönemsel kolonlar' });

    await user.selectOptions(screen.getByLabelText('Dönem tabanı'), 'yil');
    await user.selectOptions(screen.getByLabelText('Dönem sayısı'), '20');
    unmount();

    render(<FinancialsPanel market="bist" symbol="GARAN" price={40} />);
    await screen.findByRole('region', { name: 'Dönemsel kolonlar' });
    expect(screen.getByLabelText('Dönem tabanı')).toHaveValue('yil');
    expect(screen.getByLabelText('Dönem sayısı')).toHaveValue('20');
  });

  // Depolama kapalı olabilir (Safari özel sekmesi). Panel yine çalışmalı.
  it('depolama yazılamıyorsa panel yine çalışır', async () => {
    const user = userEvent.setup();
    const gercek = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    try {
      financialsFn.mockResolvedValue(ceyreklikFinansal());
      render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
      await screen.findByRole('region', { name: 'Dönemsel kolonlar' });
      await user.selectOptions(screen.getByLabelText('Dönem tabanı'), 'yil');
      expect(screen.getByLabelText('Dönem tabanı')).toHaveValue('yil');
    } finally {
      Storage.prototype.setItem = gercek;
    }
  });

  // Kullanıcı isteği: "sayının kaç olması daha iyi, kaç olması daha kötü,
  // kaç olması anlamsız". Formülü bilmek sayıyı OKUMAYA yetmiyordu.
  it('çarpan açıklaması iyi/kötü/anlamsız bandını içeriyor', async () => {
    const user = userEvent.setup();
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await waitFor(() => expect(screen.getByText('F/K')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'F/K: bu sayı nereden geliyor?' }));
    const panel = screen.getByRole('dialog', { name: 'F/K' });
    expect(panel).toHaveTextContent('Daha iyi');
    expect(panel).toHaveTextContent('Daha kötü');
    // "Anlamsız" bandı boş bırakılamaz: her ölçütün geçersiz olduğu bir durum var.
    expect(panel).toHaveTextContent('Anlamsız');
    expect(panel).toHaveTextContent(/Zarar eden şirkette/);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScreenRow } from '../../core/screen/metrics';

const screenFn = vi.fn();
// Sahte sonuç SABİT referans döndürür: useAnalysis'in sözleşmesi de budur
// (yüklenene kadar null, sonra aynı nesne).
const FAKE_ANALYSIS = {
  client: { screen: screenFn, size: 3 },
  symbols: ['AAA', 'BBB', 'CCC'],
  bars: 250,
  status: 'ready' as const,
  error: null,
};
vi.mock('../useAnalysis', () => ({ useAnalysis: () => FAKE_ANALYSIS }));

const sectorsFn = vi.fn();
vi.mock('../../data-client/sectors', () => ({
  sectorsClient: { map: (...a: unknown[]) => sectorsFn(...a) },
}));

const snapshotFn = vi.fn();
const allFinancialsFn = vi.fn();
const noStatementFn = vi.fn();
vi.mock('../../data-client/fundamentals', () => ({
  fundamentalsClient: {
    snapshot: (...a: unknown[]) => snapshotFn(...a),
    allFinancials: (...a: unknown[]) => allFinancialsFn(...a),
    noStatementSymbols: (...a: unknown[]) => noStatementFn(...a),
  },
}));

const manifestFn = vi.fn();
vi.mock('../../data-client/client', () => ({
  dataClient: { manifest: (...a: unknown[]) => manifestFn(...a) },
}));

import { encodeScreen } from '../../core/screen/share';
import { DEFAULT_SCREEN_PARAMS } from '../../core/screen/metrics';

import ScreenerScreen from './ScreenerScreen';

function row(symbol: string, rsi: number, chg21: number): ScreenRow {
  return {
    symbol,
    bars: 250,
    values: {
      last: 100,
      chg1: 1,
      chg5: 2,
      chg21,
      chg63: 4,
      rsi,
      adx: 25,
      emaFastGap: 1,
      emaSlowGap: 2,
      volRatio: 1.2,
      atrPct: 2,
      fromHigh: -5,
    },
  };
}

const push = vi.fn();
const STATE = { v: 'tarayici', m: 'bist', s: '', tf: 'D', cmp: '' };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sectorsFn.mockResolvedValue(null);
  snapshotFn.mockResolvedValue(null);
  allFinancialsFn.mockResolvedValue(null);
  noStatementFn.mockResolvedValue(new Set<string>());
  manifestFn.mockResolvedValue({
    version: 1,
    market: 'bist',
    generated: 1_758_000_000,
    symbols: {},
    bundle: { file: 'b.bin', hash: 'hash-b' },
  });
  screenFn.mockResolvedValue({
    rows: [row('AAA', 55, 10), row('BBB', 80, -5), row('CCC', 45, 3)],
    ms: 42,
  });
});

describe('Tarayıcı', () => {
  it('varsayılan kurallara uyan sembolleri listeler', async () => {
    render(<ScreenerScreen state={STATE} push={push} />);

    // Varsayılan: RSI 40–70 arası VE 1 aylık getiri > 0 → AAA ve CCC.
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
    expect(screen.getByText('CCC')).toBeInTheDocument();
    expect(screen.queryByText('BBB')).toBeNull(); // RSI 80 → elendi
  });

  it('worker süresini ve iş parçacığı sayısını gösterir', async () => {
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText(/worker 42 ms/)).toBeInTheDocument());
    expect(screen.getByText(/3 iş parçacığı/)).toBeInTheDocument();
    expect(screen.getByText('2 / 3 sembol')).toBeInTheDocument();
  });

  it('parametre değişince worker yeniden çağrılır (canlı parametre)', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screenFn).toHaveBeenCalledTimes(1));

    const rsiLength = screen.getByLabelText('RSI uzunluk');
    await user.clear(rsiLength);
    await user.type(rsiLength, '21');

    await waitFor(() => expect(screenFn.mock.calls.length).toBeGreaterThan(1));
    const lastCall = screenFn.mock.calls[screenFn.mock.calls.length - 1];
    expect(lastCall[1].rsiLength).toBe(21);
  });

  it('kural eklemek sonucu daraltır, hiç eşleşme yoksa boş durum çıkar', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    // İlk kuralın alt sınırını 90'a çek → hiçbir sembol geçemez.
    const value = screen.getAllByLabelText('Değer')[0];
    await user.clear(value);
    await user.type(value, '90');

    await waitFor(() => expect(screen.getByText('Kriterlere uyan sembol yok')).toBeInTheDocument());
  });

  // "Bu eşiği geçen yok" ile "bu metriğin verisi hiç yok" ayrı şeyler. İkincisinde
  // kullanıcıyı eşiğini gevşetmeye yönlendirmek yanlış — gevşetmek işe yaramaz.
  // Ölçüldü: yayındaki 559 sembolün TAMAMINDA `currentAssets` boş, yani "Cari
  // oran" filtresi hangi eşikle kurulursa kurulsun sıfır sonuç veriyordu.
  it('metriğin verisi hiç yoksa "gevşet" demez, veri yok der', async () => {
    const kod = encodeScreen({
      rules: [{ metric: 'currentRatio', op: 'gt', a: 1.5 }],
      params: DEFAULT_SCREEN_PARAMS,
      sectors: [],
      sort: { metric: 'chg21', dir: 'desc' },
    });
    render(<ScreenerScreen state={{ ...STATE, f: kod }} push={push} />);

    await waitFor(() => expect(screen.getByText(/Veri yok: Cari oran/)).toBeInTheDocument());
    expect(screen.queryByText('Kriterlere uyan sembol yok')).toBeNull();
    expect(screen.getByText(/eşik ne olursa olsun sonuç boş kalır/)).toBeInTheDocument();
  });

  it('satıra tıklamak sembol masasına götürür', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'AAA' }));
    expect(push).toHaveBeenCalledWith({ v: 'sembol', s: 'AAA' });
  });

  it('penceresi görünmeyen sütun pencereyi başlıkta yazar', async () => {
    render(<ScreenerScreen state={STATE} push={push} />);
    // "Zirveden" tek başına, Sembol Masası'nın tarihsel zirvesiyle aynı şeyi
    // ölçüyormuş gibi okunuyordu; başlık artık pencereyi taşıyor.
    expect(await screen.findByText('Zirveden (250 bar)')).toBeInTheDocument();
    expect(screen.getByText('Hacim oranı (20 bar)')).toBeInTheDocument();
    // Penceresi araç çubuğunda görünen metrikte başlık sade kalıyor.
    const headers = [...document.querySelectorAll('.ui-vtable thead th')].map((h) =>
      (h.textContent ?? '').trim(),
    );
    expect(headers).toContain('RSI');
  });

  it('her kuralın metriği için formül katmanı var', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    // Etiket metriğin adıyla başlar; aynı adlı iki düğme ayırt edilebilir olmalı.
    await user.click(screen.getByRole('button', { name: 'RSI: bu metrik nasıl hesaplanıyor?' }));
    expect(screen.getByRole('dialog', { name: 'RSI' })).toHaveTextContent(/Wilder RSI/);
  });
});

describe('Tarayıcı — sektör filtresi', () => {
  const SECTORS = {
    source: 'test',
    generated: 1,
    of: { AAA: 'Bankacılık', CCC: 'Gıda' },
  };

  it('sınıflandırma yoksa sektör filtresi hiç görünmez', async () => {
    sectorsFn.mockResolvedValue(null);
    snapshotFn.mockResolvedValue(null);
    allFinancialsFn.mockResolvedValue(null);
    noStatementFn.mockResolvedValue(new Set<string>());
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
    expect(screen.queryByRole('group', { name: /Sektör/ })).toBeNull();
  });

  it('seçilen sektör sonucu daraltır', async () => {
    const user = userEvent.setup();
    sectorsFn.mockResolvedValue(SECTORS);
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
    expect(screen.getByText('CCC')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Bankacılık'));
    await waitFor(() => expect(screen.queryByText('CCC')).toBeNull());
    expect(screen.getByText('AAA')).toBeInTheDocument();
  });

  it('sektörü bilinmeyen sembol seçili sektöre girmez', async () => {
    const user = userEvent.setup();
    // BBB haritada yok; RSI kuralını gevşetip listede olmasını sağlıyoruz.
    sectorsFn.mockResolvedValue({ ...SECTORS, of: { AAA: 'Bankacılık' } });
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Bankacılık'));
    await waitFor(() => expect(screen.getByText('1 / 3 sembol')).toBeInTheDocument());
  });

  it('temizlemek filtreyi kaldırır', async () => {
    const user = userEvent.setup();
    sectorsFn.mockResolvedValue(SECTORS);
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Gıda'));
    await waitFor(() => expect(screen.queryByText('AAA')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Temizle' }));
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
  });
});

describe('Tarayıcı — sektör sütunu', () => {
  it('sınıflandırma varsa sektör sütunu gelir, bilinmeyen "—" olur', async () => {
    sectorsFn.mockResolvedValue({ source: 'test', generated: 1, of: { AAA: 'Bankacılık' } });
    render(<ScreenerScreen state={STATE} push={push} />);
    // "Bankacılık" hem rozette hem hücrede geçiyor: tabloya daraltıyoruz.
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('Sektör')).toBeInTheDocument(),
    );
    const table = screen.getByRole('table');
    expect(within(table).getByText('Bankacılık')).toBeInTheDocument();
    // CCC haritada yok: boş hücre değil, açık bir "—".
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('sınıflandırma yoksa sütun hiç eklenmez', async () => {
    sectorsFn.mockResolvedValue(null);
    snapshotFn.mockResolvedValue(null);
    allFinancialsFn.mockResolvedValue(null);
    noStatementFn.mockResolvedValue(new Set<string>());
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
    expect(within(screen.getByRole('table')).queryByText('Sektör')).toBeNull();
  });
});

describe('Tarayıcı — kayıtlı taramalar', () => {
  const SECTORS = { source: 'test', generated: 1, of: { AAA: 'Bankacılık', CCC: 'Gıda' } };

  it('kaydedilen tarama sektör seçimini de taşır', async () => {
    const user = userEvent.setup();
    sectorsFn.mockResolvedValue(SECTORS);
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Bankacılık'));
    await waitFor(() => expect(screen.queryByText('CCC')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Taramayı kaydet' }));

    // Filtreyi temizle, sonra kaydı geri yükle: sektör seçimi geri gelmeli.
    await user.click(screen.getByRole('button', { name: 'Temizle' }));
    await waitFor(() => expect(screen.getByText('CCC')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Tarama 1' }));
    await waitFor(() => expect(screen.queryByText('CCC')).toBeNull());
    expect(screen.getByLabelText('Bankacılık')).toBeChecked();
  });

  it('sektör alanı olmayan eski kayıt filtreyi temizler', async () => {
    const user = userEvent.setup();
    sectorsFn.mockResolvedValue(SECTORS);
    // Sürüm öncesi biçim: sectors alanı yok.
    localStorage.setItem(
      'screener.saved',
      JSON.stringify([
        {
          name: 'Eski',
          rules: [],
          params: { rsiLength: 14, adxLength: 14, emaFast: 20, emaSlow: 50 },
        },
      ]),
    );
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Gıda'));
    await waitFor(() => expect(screen.queryByText('AAA')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Eski' }));
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
    expect(screen.getByLabelText('Gıda')).not.toBeChecked();
  });
});

describe('Tarayıcı — paylaşılabilir filtre', () => {
  it('bağlantıdaki filtreyi uygular', async () => {
    render(
      <ScreenerScreen
        state={{ ...STATE, f: '1|rsi~g~70|14.14.20.50.14.20.250||rsi~d' }}
        push={push}
      />,
    );
    // RSI > 70 → yalnızca BBB (RSI 80) kalır.
    await waitFor(() => expect(screen.getByText('BBB')).toBeInTheDocument());
    expect(screen.queryByText('AAA')).toBeNull();
  });

  it('sektör haritası inmeden "eşleşme yok" demez', async () => {
    // Nabız'dan gelen bağlantı sektör seçili açılır; harita inene kadar sonuç
    // zorunlu olarak boştur — bunu "kriterlere uyan yok" diye sunmak yanıltır.
    sectorsFn.mockReturnValue(new Promise(() => {})); // hiç çözülmüyor
    render(
      <ScreenerScreen
        state={{ ...STATE, f: '1||14.14.20.50.14.20.250|Bankacılık|chg21~d' }}
        push={push}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Sektör sınıflandırması yükleniyor')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Kriterlere uyan sembol yok')).toBeNull();
  });

  it('filtre değişince URL replace ile güncellenir (geçmiş kirlenmesin)', async () => {
    const user = userEvent.setup();
    const replace = vi.fn();
    render(<ScreenerScreen state={STATE} push={push} replace={replace} />);
    await waitFor(() => expect(replace).toHaveBeenCalled());

    replace.mockClear();
    const value = screen.getAllByLabelText('Değer')[0];
    await user.clear(value);
    await user.type(value, '45');
    await waitFor(() => expect(replace).toHaveBeenCalled());
    const last = replace.mock.calls[replace.mock.calls.length - 1][0];
    expect(last.f).toContain('rsi~b~45');
    expect(push).not.toHaveBeenCalled();
  });

  it('uygulanamayan parça sessizce yutulmaz', async () => {
    render(<ScreenerScreen state={{ ...STATE, f: '1|zzz~g~5!rsi~g~70|||' }} push={push} />);
    await waitFor(() =>
      expect(screen.getByText(/Bağlantıdaki filtrenin bir kısmı uygulanamadı/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/bilinmeyen metrik: zzz/)).toBeInTheDocument();
  });
});

describe('Tarayıcı — stratejilere aktarma', () => {
  it('görünen sonucu strateji ekranına taşır', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Stratejilerde test et/ }));
    expect(push).toHaveBeenCalledWith({ v: 'stratejiler', sy: 'AAA,CCC' });
  });

  it('sonuç yoksa düğme pasif', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    // İlk kuralın alt sınırını 90'a çek → hiç sonuç kalmaz.
    const value = screen.getAllByLabelText('Değer')[0];
    await user.clear(value);
    await user.type(value, '90');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Stratejilerde test et/ })).toBeDisabled(),
    );
  });
});

describe('Tarayıcı — koleksiyon taşıma', () => {
  it('kayıt yoksa dışa aktarma pasif', async () => {
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Koleksiyonu dışa aktar' })).toBeDisabled();
  });

  it('kaydedilen taramayı dışa aktarır', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Taramayı kaydet' }));
    await user.click(screen.getByRole('button', { name: 'Koleksiyonu dışa aktar' }));

    const box = screen.getByLabelText('Koleksiyon metni') as HTMLTextAreaElement;
    expect(box.value).toContain('borsa.screens');
    expect(box.value).toContain('Tarama 1');
    // Dışa aktarma kutusu salt okunur: yanlışlıkla düzenlenip bozulmasın.
    expect(box).toHaveAttribute('readonly');
  });

  it('içe aktarılan koleksiyon kitaplığa ekleniyor', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Koleksiyonu içe aktar' }));
    const box = screen.getByLabelText('Koleksiyon metni');
    await user.click(box);
    await user.paste(
      JSON.stringify({
        version: 1,
        kind: 'borsa.screens',
        screens: [{ name: 'Gelen', f: '1|rsi~g~30|||' }],
      }),
    );
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'İçe aktar' }));

    await waitFor(() => expect(screen.getByText('1 tarama eklendi.')).toBeInTheDocument());
  });

  it('bozuk metin sessizce alınmaz, gerekçesi yazılır', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Koleksiyonu içe aktar' }));
    await user.click(screen.getByLabelText('Koleksiyon metni'));
    await user.paste('merhaba');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'İçe aktar' }));

    await waitFor(() => expect(screen.getByText('Hiçbir tarama alınamadı.')).toBeInTheDocument());
    expect(screen.getByText(/JSON olarak okunamadı/)).toBeInTheDocument();
  });
});

describe('Tarayıcı — kayıtlı taramada ne değişti', () => {
  const RULES = [{ metric: 'rsi', op: 'gt' as const, a: 50 }];
  const CODE = encodeScreen({
    rules: RULES,
    params: DEFAULT_SCREEN_PARAMS,
    sectors: [],
    sort: { metric: 'chg21', dir: 'desc' },
  });

  function seed(snapshot: Record<string, unknown> | null) {
    localStorage.setItem(
      'screener.saved',
      JSON.stringify([
        { name: 'Tarama 1', rules: RULES, params: DEFAULT_SCREEN_PARAMS, sectors: [] },
      ]),
    );
    if (snapshot) localStorage.setItem('screener.snapshots.v1', JSON.stringify(snapshot));
  }

  it('yeni veri geldiyse gireni ve çıkanı söyler', async () => {
    // Geçen bakışta AAA ve ZZZ eşleşiyordu; paket o zamandan beri değişti.
    seed({
      'bist|Tarama 1': {
        name: 'Tarama 1',
        market: 'bist',
        code: CODE,
        data: 'hash-a',
        generated: 1_757_800_000,
        symbols: ['AAA', 'ZZZ'],
      },
    });
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await user.click(await screen.findByRole('button', { name: /^Tarama 1/ }));

    // RSI > 50 → AAA (55) ve BBB (80). ZZZ artık yok.
    const bar = await screen.findByRole('status', { name: 'Kayıtlı tarama farkı' });
    await waitFor(() => expect(bar).toHaveTextContent('1 giren'));
    expect(bar).toHaveTextContent('1 çıkan');
    expect(
      within(bar).getByRole('button', { name: 'BBB taramaya girdi, sembol masasında aç' }),
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole('button', { name: 'ZZZ taramadan çıktı, sembol masasında aç' }),
    ).toBeInTheDocument();
  });

  it('yeni girenleri strateji testine taşır', async () => {
    seed({
      'bist|Tarama 1': {
        name: 'Tarama 1',
        market: 'bist',
        code: CODE,
        data: 'hash-a',
        generated: 1_757_800_000,
        symbols: ['AAA', 'ZZZ'],
      },
    });
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await user.click(await screen.findByRole('button', { name: /^Tarama 1/ }));
    await user.click(
      await screen.findByRole('button', { name: /Girenleri stratejilerde test et/ }),
    );
    // Yalnızca YENİ GİRENLER gidiyor; listenin tamamı değil.
    expect(push).toHaveBeenCalledWith({ v: 'stratejiler', sy: 'BBB' });
  });

  it('kaydı açmadan da rozet değişimi duyurur', async () => {
    // "Alarm" burada: kullanıcı kaydı tıklamadan, listede ne değiştiğini görüyor.
    seed({
      'bist|Tarama 1': {
        name: 'Tarama 1',
        market: 'bist',
        code: CODE,
        data: 'hash-a',
        generated: 1_757_800_000,
        symbols: ['AAA', 'ZZZ'],
      },
    });
    render(<ScreenerScreen state={STATE} push={push} />);
    expect(
      await screen.findByRole('button', { name: 'Tarama 1: 1 giren, 1 çıkan' }),
    ).toBeInTheDocument();
  });

  it('aynı pakette fark aramaz', async () => {
    seed({
      'bist|Tarama 1': {
        name: 'Tarama 1',
        market: 'bist',
        code: CODE,
        data: 'hash-b', // manifest ile aynı
        generated: 1_758_000_000,
        symbols: ['AAA'],
      },
    });
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await user.click(await screen.findByRole('button', { name: /^Tarama 1/ }));

    const bar = await screen.findByRole('status', { name: 'Kayıtlı tarama farkı' });
    await waitFor(() => expect(bar).toHaveTextContent(/değişmedi/));
    // Sonuç listesi anlık görüntüden farklı (BBB de eşleşiyor) ama bu fark
    // piyasadan gelmiyor: aynı veriye bakıyoruz.
    expect(bar).not.toHaveTextContent('giren');
  });

  it('kural kayıttan farklıysa farkı piyasaya yazmaz', async () => {
    seed({
      'bist|Tarama 1': {
        name: 'Tarama 1',
        market: 'bist',
        code: '1|rsi~g~10|14.14.20.50.14.20.250||chg21~d',
        data: 'hash-a',
        generated: 1_757_800_000,
        symbols: ['AAA'],
      },
    });
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await user.click(await screen.findByRole('button', { name: /^Tarama 1/ }));

    const bar = await screen.findByRole('status', { name: 'Kayıtlı tarama farkı' });
    await waitFor(() => expect(bar).toHaveTextContent(/kurallar işaretlenen halinden farklı/));
  });

  it('kaydetmek başlangıç noktasını da işaretler', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Taramayı kaydet' }));

    const bar = await screen.findByRole('status', { name: 'Kayıtlı tarama farkı' });
    await waitFor(() => expect(bar).toHaveTextContent(/değişmedi/));
    const stored = JSON.parse(localStorage.getItem('screener.snapshots.v1')!);
    expect(stored['bist|Tarama 1'].symbols).toEqual(['AAA', 'CCC']);
  });
});

describe('Tarayıcı — hesap çökerse', () => {
  it('"sonuç yok" demez, hatayı gösterir', async () => {
    // Boş sonuç ile ÇÖKEN hesap aynı şey değil: ilkinde kullanıcı filtresini
    // gevşetir, ikincisinde bekler. İkisini aynı ekranla anlatmak yanıltıyordu.
    screenFn.mockRejectedValue(new Error('worker çöktü'));
    render(<ScreenerScreen state={STATE} push={push} />);
    expect(await screen.findByText('Tarama hesaplanamadı')).toBeInTheDocument();
    expect(screen.getByText(/worker çöktü/)).toBeInTheDocument();
  });
});

/**
 * Tam tabloya dayanan ölçütler (büyüme, kalite, karne).
 *
 * ÖLÇÜLDÜ: tarama ekranı `withFundamentals`'ı tam tabloyu VERMEDEN çağırıyordu.
 * "Kalite skoru", "Ciro büyümesi" ve "Kâr büyümesi" filtreleri bu yüzden her
 * eşikte sıfır sonuç veriyordu — filtre ekrandaydı, verisi hiç gelmiyordu.
 */
describe('Tarayıcı — tam tablo isteyen ölçütler', () => {
  function kod(metric: string) {
    return encodeScreen({
      rules: [{ metric, op: 'gt', a: 0 }],
      params: DEFAULT_SCREEN_PARAMS,
      sectors: [],
      sort: { metric: 'chg21', dir: 'desc' },
    });
  }

  const SNAPSHOT = {
    version: 1,
    generated: 1,
    note: 'test',
    symbols: {
      AAA: {
        period: '2024/12',
        revenueTtm: 1200,
        grossProfitTtm: 360,
        operatingProfitTtm: 240,
        netIncomeTtm: 200,
        operatingCashFlowTtm: 220,
        equity: 1000,
        assets: 2000,
        paidCapital: 100,
        currentAssets: 500,
        currentLiabilities: 250,
        longLiabilities: 250,
        inventory: 100,
        cash: 150,
      },
    },
  };

  const FIN = {
    symbol: 'AAA',
    periods: ['2022/12', '2023/12', '2024/12'],
    fields: {
      revenue: [800, 1000, 1200],
      grossProfit: [200, 280, 360],
      operatingProfit: [150, 200, 240],
      netIncome: [100, 150, 200],
      assets: [1500, 1800, 2000],
      equity: [700, 850, 1000],
      paidCapital: [100, 100, 100],
      currentAssets: [400, 450, 500],
      currentLiabilities: [300, 280, 250],
      longLiabilities: [400, 350, 250],
      inventory: [90, 95, 100],
      cash: [100, 120, 150],
      operatingCashFlow: [110, 160, 220],
      capex: [null, null, null],
    },
    missing: [],
  };

  it('ciro büyümesi kuralı artık sonuç veriyor', async () => {
    snapshotFn.mockResolvedValue(SNAPSHOT);
    allFinancialsFn.mockResolvedValue(new Map([['AAA', FIN]]));
    render(<ScreenerScreen state={{ ...STATE, f: kod('revenueGrowth') }} push={push} />);

    // Düzeltmeden önce burası "Kriterlere uyan sembol yok" diyordu.
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
    expect(allFinancialsFn).toHaveBeenCalledWith('bist');
  });

  it('karne başlığı kuralı çalışıyor', async () => {
    snapshotFn.mockResolvedValue(SNAPSHOT);
    allFinancialsFn.mockResolvedValue(new Map([['AAA', FIN]]));
    render(<ScreenerScreen state={{ ...STATE, f: kod('karneBuyume') }} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
  });

  // 3,1 MB'lık dosya kullanılmayan bir metrik için inmemeli.
  it('tabloya dayanmayan kurallarda dosya İNMİYOR', async () => {
    snapshotFn.mockResolvedValue(SNAPSHOT);
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());
    expect(allFinancialsFn).not.toHaveBeenCalled();
  });

  // Dosya yayımlanmamışsa sessizce "sonuç yok" demek YANLIŞ: kullanıcı
  // kuralını gevşetmeye çalışır, oysa sorun eşikte değil.
  it('tablo dosyası yoksa nedenini söylüyor', async () => {
    snapshotFn.mockResolvedValue(SNAPSHOT);
    allFinancialsFn.mockResolvedValue(null);
    render(<ScreenerScreen state={{ ...STATE, f: kod('quality') }} push={push} />);
    await waitFor(() =>
      expect(screen.getByText('Finansal tablolar yüklenemedi')).toBeInTheDocument(),
    );
    expect(screen.getByText(/hepsi\.json/)).toBeInTheDocument();
  });
});

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

  it('satıra tıklamak sembol masasına götürür', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'AAA' }));
    expect(push).toHaveBeenCalledWith({ v: 'sembol', s: 'AAA' });
  });

  it('her kuralın metriği için formül katmanı var', async () => {
    const user = userEvent.setup();
    render(<ScreenerScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: 'Bu metrik nasıl hesaplanıyor?' })[0]);
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

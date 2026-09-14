import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DAY_SECONDS } from '../../core/data/pack';
import { emptyCandles, type Candles } from '../../core/data/types';

const FAKE_ANALYSIS = {
  client: { size: 2 },
  symbols: ['THYAO', 'GARAN'],
  bars: 250,
  status: 'ready' as const,
  error: null,
};
vi.mock('../useAnalysis', () => ({ useAnalysis: () => FAKE_ANALYSIS }));

const seriesFn = vi.fn();
vi.mock('../../data-client/client', () => ({
  dataClient: { series: (...a: unknown[]) => seriesFn(...a) },
}));

import Portfolio from './Portfolio';

/** 2021-01-01'den başlayan, sonunda `last` fiyatına ulaşan seri. */
function series(last: number, n = 400): Candles {
  const startDay = Math.floor(Date.UTC(2021, 0, 4) / 1000 / DAY_SECONDS);
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    const v = 10 + ((last - 10) * i) / (n - 1);
    c.time[i] = (startDay + i) * DAY_SECONDS;
    c.open[i] = v;
    c.high[i] = v;
    c.low[i] = v;
    c.close[i] = v;
    c.volume[i] = 1000;
  }
  return c;
}

const push = vi.fn();
const STATE = { v: 'portfoy', m: 'bist', s: '', tf: 'D', cmp: '' };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seriesFn.mockImplementation((_market: string, symbol: string) =>
    Promise.resolve({ candles: series(symbol === 'THYAO' ? 30 : 20), entry: {}, fromCache: true }),
  );
});

async function addPosition(
  user: ReturnType<typeof userEvent.setup>,
  symbol: string,
  shares: number,
  price: number,
) {
  const combo = screen.getByRole('combobox', { name: 'Sembol' });
  await user.click(combo);
  await user.type(combo, symbol);
  // DİKKAT: sayfadaki native <select>'lerin <option>'ları da 'option' rolündedir;
  // seçim listesine kapsam vermeden ilk seçeneği tıklamak piyasa kutusunu seçer.
  const listbox = screen.getByRole('listbox', { name: 'Sembol' });
  await user.click(within(listbox).getAllByRole('option')[0]);

  const sharesInput = screen.getByLabelText('Adet');
  await user.clear(sharesInput);
  await user.type(sharesInput, String(shares));

  const priceInput = screen.getByLabelText('Fiyat');
  await user.clear(priceInput);
  await user.type(priceInput, String(price));

  await user.click(screen.getByRole('button', { name: 'Ekle' }));
}

describe('Portföy', () => {
  it('işlem yokken ne yapılacağını söyler', () => {
    render(<Portfolio state={STATE} push={push} />);
    expect(screen.getByText('Henüz işlem yok')).toBeInTheDocument();
  });

  it('alış ekleyince pozisyon, değer ve K/Z hesaplanır', async () => {
    const user = userEvent.setup();
    render(<Portfolio state={STATE} push={push} />);
    await addPosition(user, 'THYAO', 100, 15);

    await waitFor(() => expect(screen.getByText('Portföy değeri')).toBeInTheDocument());
    // 100 adet, son fiyat 30 → 3.000; maliyet 1.500 → +%100
    // ("3.000" hem özet kartında hem pozisyon satırında görünür.)
    await waitFor(() => expect(screen.getAllByText('3.000').length).toBeGreaterThan(0));
    expect(screen.getByText(/maliyet 1\.500/)).toBeInTheDocument();
    expect(screen.getByText('+100.00%')).toBeInTheDocument();
  });

  it('değerleme tarihi son fiyat günüdür, "bugün" değil', async () => {
    const user = userEvent.setup();
    render(<Portfolio state={STATE} push={push} />);
    await addPosition(user, 'THYAO', 10, 12);

    await waitFor(() => expect(screen.getByText(/değerleme 20\d\d-/)).toBeInTheDocument());
    const hint = screen.getByText(/değerleme 20\d\d-/).textContent ?? '';
    const shown = hint.match(/değerleme (\d{4}-\d{2}-\d{2})/)![1];
    expect(new Date(shown).getTime()).toBeLessThan(Date.now()); // veri geçmişte
    expect(shown.startsWith(String(new Date().getUTCFullYear()))).toBe(false);
  });

  it('maliyet yöntemini ve verinin nerede saklandığını açıkça yazar', () => {
    render(<Portfolio state={STATE} push={push} />);
    expect(screen.getByText(/ağırlıklı ortalama/)).toBeInTheDocument();
    expect(screen.getByText(/yalnızca bu tarayıcıda saklanır/)).toBeInTheDocument();
  });

  it('risk ve senaryo panelleri pozisyon gelince görünür', async () => {
    const user = userEvent.setup();
    render(<Portfolio state={STATE} push={push} />);
    await addPosition(user, 'THYAO', 100, 15);

    await waitFor(() => expect(screen.getByRole('region', { name: 'Risk' })).toBeInTheDocument());
    expect(screen.getByText('Günlük VaR %95')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Senaryolar' })).toBeInTheDocument();
    expect(screen.getByText('Mart 2020 pandemi satışı')).toBeInTheDocument();
  });

  it('işlemler tarayıcıda kalıcıdır (yeniden mount)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Portfolio state={STATE} push={push} />);
    await addPosition(user, 'THYAO', 50, 11);
    await waitFor(() => expect(screen.getByText('Portföy değeri')).toBeInTheDocument());
    unmount();

    render(<Portfolio state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('Portföy değeri')).toBeInTheDocument());
    expect(screen.queryByText('Henüz işlem yok')).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DAY_SECONDS } from '../../core/data/pack';
import { emptyCandles, type Candles } from '../../core/data/types';

const correlateFn = vi.fn();
const FAKE_ANALYSIS = {
  client: { correlate: correlateFn, size: 2 },
  symbols: ['AAA', 'BBB', 'CCC', 'DDD'],
  bars: 250,
  status: 'ready' as const,
  error: null,
};
vi.mock('../useAnalysis', () => ({ useAnalysis: () => FAKE_ANALYSIS }));

const seriesFn = vi.fn();
vi.mock('../../data-client/client', () => ({
  dataClient: { series: (...a: unknown[]) => seriesFn(...a) },
}));

// Canvas jsdom'da çizilmez; grafik yerine sembolleri listeleyen sahte.
vi.mock('../chart/NormalizedChart', () => ({
  NormalizedChart: ({ series }: { series: { symbol: string }[] }) => (
    <div data-testid="normchart">{series.map((s) => s.symbol).join('|')}</div>
  ),
}));

import Compare from './Compare';

function sample(n = 50): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    const v = 100 + i;
    c.time[i] = (20000 + i) * DAY_SECONDS;
    c.open[i] = v;
    c.high[i] = v;
    c.low[i] = v;
    c.close[i] = v;
    c.volume[i] = 1000;
  }
  return c;
}

const push = vi.fn();
const STATE = { v: 'karsilastir', m: 'bist', s: '', tf: 'D', cmp: 'AAA,BBB' };

beforeEach(() => {
  vi.clearAllMocks();
  seriesFn.mockResolvedValue({ candles: sample(), entry: {}, fromCache: true });
  // 4 sembollük matris: AAA–BBB güçlü, CCC–DDD ayrı küme.
  const matrix = Float64Array.from([
    1, 0.9, 0.1, 0.05, 0.9, 1, 0.08, 0.02, 0.1, 0.08, 1, 0.85, 0.05, 0.02, 0.85, 1,
  ]);
  correlateFn.mockResolvedValue({
    symbols: ['AAA', 'BBB', 'CCC', 'DDD'],
    matrix,
    order: [0, 1, 2, 3],
    clusterOf: [0, 0, 1, 1],
    clusters: 2,
    ms: 91,
  });
});

describe('Karşılaştır', () => {
  it('seçili semboller için korelasyon matrisi çizer', async () => {
    render(<Compare state={STATE} push={push} />);

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('0,90'); // AAA–BBB
    expect(screen.getByText(/2 küme/)).toBeInTheDocument();
    expect(screen.getByText(/worker 91 ms/)).toBeInTheDocument();
  });

  it('normalize grafiğe yalnızca verisi gelen semboller girer', async () => {
    render(<Compare state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByTestId('normchart')).toHaveTextContent('AAA|BBB'));
    expect(seriesFn).toHaveBeenCalledTimes(2);
  });

  it('aynı kümedeki sembolleri korelasyonla sıralı listeler', async () => {
    render(<Compare state={STATE} push={push} />);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Küme komşuları' })).toBeInTheDocument(),
    );

    const mates = screen.getByRole('region', { name: 'Küme komşuları' });
    expect(mates).toHaveTextContent('BBB');
    expect(mates).not.toHaveTextContent('CCC'); // farklı küme
  });

  it('sembol çıkarmak URL durumunu günceller', async () => {
    const user = userEvent.setup();
    render(<Compare state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByTestId('normchart')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'AAA sembolünü çıkar' }));
    expect(push).toHaveBeenCalledWith({ cmp: 'BBB' });
  });

  it('pencere değişince korelasyon yeniden hesaplanır', async () => {
    const user = userEvent.setup();
    render(<Compare state={STATE} push={push} />);
    await waitFor(() => expect(correlateFn).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText('Pencere'), '60');
    await waitFor(() => expect(correlateFn).toHaveBeenCalledTimes(2));
    expect(correlateFn.mock.calls[1][1]).toMatchObject({ lookback: 60 });
  });

  it('tek sembolde matris yerine yönlendirme gösterir', async () => {
    render(<Compare state={{ ...STATE, cmp: 'AAA' }} push={push} />);
    await waitFor(() => expect(screen.getByText('En az iki sembol seç')).toBeInTheDocument());
  });
});

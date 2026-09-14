import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DAY_SECONDS } from '../../core/data/pack';
import { emptyCandles, type Candles } from '../../core/data/types';

const sectorsFn = vi.fn();
vi.mock('../../data-client/sectors', () => ({
  sectorsClient: { map: (...a: unknown[]) => sectorsFn(...a) },
}));

const bundleFn = vi.fn();
vi.mock('../../data-client/client', () => ({
  dataClient: { bundle: (...a: unknown[]) => bundleFn(...a) },
}));

import { SectorPanel } from './SectorPanel';

function candles(last: number, prev: number, volume: number): Candles {
  const c = emptyCandles(2);
  c.time[0] = 19000 * DAY_SECONDS;
  c.time[1] = 19001 * DAY_SECONDS;
  c.close[0] = prev;
  c.close[1] = last;
  c.volume[0] = volume;
  c.volume[1] = volume;
  return c;
}

const SERIES: Record<string, Candles> = {
  GARAN: candles(102, 100, 10_000), // +%2, değer 1.020.000
  AKBNK: candles(99, 100, 5_000), //  −%1, değer   495.000
  EREGL: candles(50, 50, 1_000),
};

const SECTORS = {
  source: 'Test kaynağı',
  generated: 1,
  of: { GARAN: 'Bankacılık', AKBNK: 'Bankacılık', EREGL: 'Demir Çelik' },
};

const onSelect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  sectorsFn.mockResolvedValue(SECTORS);
  bundleFn.mockResolvedValue({
    names: ['AKBNK', 'EREGL', 'GARAN'],
    bars: 2,
    days: Int32Array.from([19000, 19001]),
    closeAt: () => NaN,
    seriesOf: (s: string) => SERIES[s] ?? null,
  });
});

describe('Sektör paneli', () => {
  it('paket kendiliğinden inmez; önce boyutu söyleyip izin ister', async () => {
    render(<SectorPanel market="bist" symbol="GARAN" onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText('Bankacılık')).toBeInTheDocument());
    expect(screen.getByText(/yaklaşık 1 MB/)).toBeInTheDocument();
    expect(bundleFn).not.toHaveBeenCalled();
  });

  it('yükledikten sonra akranları ve sektör içindeki sırayı gösterir', async () => {
    const user = userEvent.setup();
    render(<SectorPanel market="bist" symbol="AKBNK" onSelect={onSelect} />);
    await user.click(await screen.findByRole('button', { name: 'Akranları yükle' }));

    // AKBNK işlem değerinde GARAN'ın gerisinde: sıra 2 / 2.
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());
    expect(screen.getByText('Sektör içindeki sıra')).toBeInTheDocument();
  });

  it('sektör değişimini işlem değeriyle ağırlıklandırır', async () => {
    const user = userEvent.setup();
    render(<SectorPanel market="bist" symbol="GARAN" onSelect={onSelect} />);
    await user.click(await screen.findByRole('button', { name: 'Akranları yükle' }));
    // (1.020.000×2 + 495.000×−1) / 1.515.000 = +%1,02
    await waitFor(() => expect(screen.getByText('+%1,02')).toBeInTheDocument());
  });

  it('akrana tıklamak o sembole geçirir', async () => {
    const user = userEvent.setup();
    render(<SectorPanel market="bist" symbol="AKBNK" onSelect={onSelect} />);
    await user.click(await screen.findByRole('button', { name: 'Akranları yükle' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'GARAN' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'GARAN' }));
    expect(onSelect).toHaveBeenCalledWith('GARAN');
  });

  it('sınıflandırma yoksa panel akran uydurmaz', async () => {
    sectorsFn.mockResolvedValue(null);
    render(<SectorPanel market="bist" symbol="GARAN" onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText('Sektör sınıflandırması yok')).toBeInTheDocument());
    expect(bundleFn).not.toHaveBeenCalled();
  });

  it('sembolün sektörü bilinmiyorsa rastgele grup göstermez', async () => {
    render(<SectorPanel market="bist" symbol="XXXXX" onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText('XXXXX sınıflandırılmamış')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Akranları yükle' })).toBeNull();
  });
});

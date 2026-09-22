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

vi.mock('../chart/LineChart', () => ({
  LineChart: ({ series }: { series: { label: string; values: ArrayLike<number> }[] }) => (
    <div
      data-testid="sektor-grafik"
      data-son={series
        .map((x) => `${x.label}:${x.values[x.values.length - 1].toFixed(2)}`)
        .join('|')}
    />
  ),
}));

import { SectorPanel } from './SectorPanel';

/** N barlık seri: ilk bar `bas`, son bar `son` (aradakiler doğrusal). */
function seri(bas: number, son: number, n: number, volume = 1000): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    c.time[i] = (19_000 + i) * DAY_SECONDS;
    c.close[i] = bas + ((son - bas) * i) / (n - 1);
    c.volume[i] = volume;
  }
  return c;
}

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

/**
 * Pencere karşılaştırması.
 *
 * "Bu hisse %2 düştü" eksik bir cümle: sektörü %3 düştüyse hisse aslında iyi
 * gitmiştir. Panel bunu tek barla söyleyemiyordu.
 */
describe('Sektör paneli — dönem karşılaştırması', () => {
  beforeEach(() => {
    // 21 bar: GARAN +%10, AKBNK +%30 → sektör ortalaması +%20.
    const uzun: Record<string, Candles> = {
      GARAN: seri(100, 110, 21, 10_000),
      AKBNK: seri(100, 130, 21, 5_000),
      EREGL: seri(50, 50, 21, 1_000),
    };
    bundleFn.mockResolvedValue({
      names: ['AKBNK', 'EREGL', 'GARAN'],
      bars: 21,
      days: Int32Array.from([]),
      closeAt: () => NaN,
      seriesOf: (s: string) => uzun[s] ?? null,
    });
  });

  async function yukle(user: ReturnType<typeof userEvent.setup>) {
    render(<SectorPanel market="bist" symbol="GARAN" onSelect={onSelect} />);
    await user.click(await screen.findByRole('button', { name: 'Akranları yükle' }));
    await screen.findByTestId('sektor-grafik');
  }

  it('sembolü ve sektör ortalamasını ORTAK tabanda çiziyor', async () => {
    const user = userEvent.setup();
    await yukle(user);
    // İkisi de pencerenin başında %0; sonda GARAN +%10, ortalama +%20.
    expect(screen.getByTestId('sektor-grafik')).toHaveAttribute(
      'data-son',
      'GARAN:10.00|Sektör ort.:20.00',
    );
  });

  // ASIL CEVAP: fark PUAN olarak. İki yüzdenin farkı bir yüzde değildir.
  it('sektöre göre göreli gücü puan olarak veriyor', async () => {
    const user = userEvent.setup();
    await yukle(user);
    expect(screen.getByText('-%10,0 puan')).toBeInTheDocument();
  });

  it('dönem değişince yeniden paket indirmiyor', async () => {
    const user = userEvent.setup();
    await yukle(user);
    const oncekiCagri = bundleFn.mock.calls.length;
    await user.selectOptions(screen.getByLabelText('Dönem'), '5');
    // 21 barlık doğrusal seride son 5 barın tabanı 108 (GARAN) ve 124
    // (AKBNK): pencere getirileri %1,85 ve %4,84, ortalama %3,35.
    await waitFor(() =>
      expect(screen.getByTestId('sektor-grafik')).toHaveAttribute(
        'data-son',
        'GARAN:1.85|Sektör ort.:3.35',
      ),
    );
    // Ham kapanışlar bellekte: pencere değişimi ağ isteği DEĞİL.
    expect(bundleFn.mock.calls.length).toBe(oncekiCagri);
  });
});

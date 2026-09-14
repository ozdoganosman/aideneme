import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { FUNDAMENTAL_FIELDS, type FieldId, type Financials } from '../../core/fundamentals/types';

const snapshotFn = vi.fn();
const financialsFn = vi.fn();
vi.mock('../../data-client/fundamentals', () => ({
  fundamentalsClient: {
    snapshot: (...a: unknown[]) => snapshotFn(...a),
    financials: (...a: unknown[]) => financialsFn(...a),
  },
}));
vi.mock('../chart/LineChart', () => ({
  LineChart: ({ series }: { series: { label: string }[] }) => (
    <div data-testid="fin-chart">{series.map((s) => s.label).join('|')}</div>
  ),
}));

import { FinancialsPanel } from './FinancialsPanel';

const periods = ['2022/12', '2023/12', '2024/12'];

function financials(overrides: Partial<Record<FieldId, (number | null)[]>>): Financials {
  const fields = {} as Record<FieldId, (number | null)[]>;
  for (const field of FUNDAMENTAL_FIELDS) fields[field] = overrides[field] ?? [null, null, null];
  return { symbol: 'THYAO', periods, fields, missing: ['capex'] };
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
    expect(screen.getByText('20.0')).toBeInTheDocument(); // 100 pay × 40 / 200
    expect(screen.getByText('5.00')).toBeInTheDocument(); // PD/DD
  });

  it('kalite ölçütlerini tek tek listeler', async () => {
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await waitFor(() => expect(screen.getByText(/Net kâr pozitif/)).toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Kalite ölçütleri' })).toBeInTheDocument();
  });

  it('yıllık seriyi grafiğe verir', async () => {
    render(<FinancialsPanel market="bist" symbol="THYAO" price={40} />);
    await waitFor(() =>
      expect(screen.getByTestId('fin-chart')).toHaveTextContent('Satış|Net kâr|Özkaynak'),
    );
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
});

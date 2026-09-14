import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { PulseRow } from '../../core/screen/pulse';

const pulseFn = vi.fn();
const correlateFn = vi.fn();
const FAKE_ANALYSIS = {
  client: { pulse: pulseFn, correlate: correlateFn, size: 2 },
  symbols: ['AAA', 'BBB', 'CCC', 'DDD'],
  bars: 250,
  status: 'ready' as const,
  error: null,
};
vi.mock('../useAnalysis', () => ({ useAnalysis: () => FAKE_ANALYSIS }));

// Canvas jsdom'da çizilmez.
vi.mock('../chart/HeatMap', () => ({
  HeatMap: ({ rows, order }: { rows: PulseRow[]; order?: string[] }) => (
    <div data-testid="heatmap" data-order={order?.join(',') ?? 'yok'}>
      {rows.length} kutu
    </div>
  ),
}));

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

describe('Nabız', () => {
  it('genişlik ve para akışını özet kartlarında gösterir', async () => {
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('Genişlik')).toBeInTheDocument());

    expect(screen.getByText('2 yükselen · 2 düşen')).toBeInTheDocument();
    // Sayıca eşit ama para düşenlerde → akış negatif.
    expect(screen.getByText('-20.5%')).toBeInTheDocument();
    expect(screen.getByText('1 / 0')).toBeInTheDocument();
  });

  it('ısı haritası kümeleme sırasıyla çizilir', async () => {
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByTestId('heatmap')).toHaveTextContent('4 kutu'));
    await waitFor(() =>
      expect(screen.getByTestId('heatmap')).toHaveAttribute('data-order', 'CCC,DDD,AAA,BBB'),
    );
  });

  it('grup akışı işlem değerine göre sıralı ve en çok işlem görenle etiketli', async () => {
    render(<Pulse state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText(/CCC grubu/)).toBeInTheDocument());

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

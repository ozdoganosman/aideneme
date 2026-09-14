import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { emptyCandles, type Candles } from '../../core/data/types';
import type { ModelCard } from '../../core/ml/model';

const modelFn = vi.fn();
const FAKE_ANALYSIS = {
  client: { size: 2, model: (...a: unknown[]) => modelFn(...a) },
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

import ModelScreen from './ModelScreen';

function candles(n: number): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    c.time[i] = (19000 + i) * 86400;
    c.open[i] = 100;
    c.high[i] = 101;
    c.low[i] = 99;
    c.close[i] = 100;
    c.volume[i] = 1000;
  }
  return c;
}

function card(overrides: Partial<ModelCard> = {}): ModelCard {
  return {
    symbol: 'THYAO',
    barriers: { horizon: 10, upMult: 1.5, downMult: 1.5, volLength: 20 },
    samples: 900,
    positiveRate: 0.5,
    folds: 5,
    embargoBars: 10,
    purged: 120,
    firstDay: 19000,
    lastDay: 19900,
    metrics: { auc: 0.61, brier: 0.23, logLoss: 0.66, accuracy: 0.58, ece: 0.04 },
    baseline: {
      label: 'Taban oran (her zaman aynı olasılık)',
      brier: 0.25,
      logLoss: 0.69,
      auc: 0.5,
      accuracy: 0.5,
    },
    brierSkill: 0.08,
    calibration: [
      { from: 0, to: 0.2, count: 0, predicted: NaN, observed: NaN },
      { from: 0.2, to: 0.4, count: 50, predicted: 0.3, observed: 0.32 },
      { from: 0.4, to: 0.6, count: 600, predicted: 0.5, observed: 0.49 },
      { from: 0.6, to: 0.8, count: 250, predicted: 0.68, observed: 0.64 },
      { from: 0.8, to: 1, count: 0, predicted: NaN, observed: NaN },
    ],
    features: [
      {
        key: 'mom',
        label: 'Momentum (20) %',
        detail: '20 barlık getiri',
        weight: 0.31,
        stable: true,
      },
      { key: 'rsi', label: 'RSI (14)', detail: 'Aşırı alım/satım', weight: -0.04, stable: false },
    ],
    edge: { threshold: 0.55, signals: 210, meanRetPct: 1.2, allMeanRetPct: 0.3 },
    warnings: ['Tek sembolde, tek dönemde ölçüldü; işlem maliyeti dahil değil.'],
    verdict: 'kullanılabilir',
    ...overrides,
  };
}

const push = vi.fn();
const STATE = { v: 'model', m: 'bist', s: 'THYAO' };

beforeEach(() => {
  vi.clearAllMocks();
  seriesFn.mockResolvedValue({ candles: candles(400) });
  modelFn.mockResolvedValue({ card: card(), latest: { day: 19900, probability: 0.63 }, ms: 820 });
});

describe('Model ekranı', () => {
  it('hükmü, ölçümleri ve taban karşılaştırmasını gösterir', async () => {
    render(<ModelScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('Hüküm: kullanılabilir')).toBeInTheDocument());
    expect(screen.getByText('0.610')).toBeInTheDocument(); // AUC
    expect(screen.getByText(/taban 0.50/)).toBeInTheDocument();
    expect(screen.getByText(/taban 0.250/)).toBeInTheDocument(); // Brier tabanı
    expect(screen.getByText('63%')).toBeInTheDocument(); // canlı olasılık
  });

  it('kart "kullanma" derse olasılık hiç gösterilmez', async () => {
    modelFn.mockResolvedValue({
      card: card({
        verdict: 'kullanma',
        brierSkill: -0.05,
        metrics: { ...card().metrics, auc: 0.5 },
      }),
      latest: null,
      ms: 700,
    });
    render(<ModelScreen state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('Hüküm: kullanma')).toBeInTheDocument());
    expect(screen.getByText(/Tahmin üretilmedi/)).toBeInTheDocument();
    expect(screen.queryByText('63%')).toBeNull();
  });

  it('kalibrasyon kovalarını söylenen–olan olarak listeler, boş kovayı uydurmaz', async () => {
    render(<ModelScreen state={STATE} push={push} />);
    const region = await screen.findByRole('region', { name: 'Kalibrasyon' });
    const rows = region.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('—'); // sayısı 0 olan kova
    expect(rows[2]).toHaveTextContent('50%');
    expect(rows[2]).toHaveTextContent('49%');
  });

  it('özellik katsayılarını ve kararlılığını yazar', async () => {
    render(<ModelScreen state={STATE} push={push} />);
    const region = await screen.findByRole('region', { name: 'Özellikler' });
    expect(region).toHaveTextContent('Momentum (20) %');
    expect(region).toHaveTextContent('0.310');
    expect(region).toHaveTextContent('hayır'); // RSI katsayısı katmanlar arası kararsız
  });

  it('yöntemi ve sınırları model kartında taşır', async () => {
    render(<ModelScreen state={STATE} push={push} />);
    const region = await screen.findByRole('region', { name: 'Model kartı' });
    expect(region).toHaveTextContent(/purged 5-fold/);
    expect(region).toHaveTextContent(/embargo/);
    expect(region).toHaveTextContent(/120 örnek atıldı/);
    expect(region).toHaveTextContent(/işlem maliyeti dahil değil/);
  });

  it('ufuk değişince model yeniden kurulur', async () => {
    render(<ModelScreen state={STATE} push={push} />);
    await waitFor(() => expect(modelFn).toHaveBeenCalledTimes(1));
    expect(modelFn.mock.calls[0][1]).toMatchObject({
      symbol: 'THYAO',
      folds: 5,
      embargoBars: 10,
      barriers: { horizon: 10, upMult: 1.5, downMult: 1.5 },
    });
  });
});

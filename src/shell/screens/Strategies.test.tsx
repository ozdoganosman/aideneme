import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BacktestMetrics } from '../../core/backtest/metrics';
import { emptyCandles, type Candles } from '../../core/data/types';
import { STRATEGY_PRESETS } from '../../core/strategy/presets';
import type { SymbolResult } from '../../core/strategy/rank';

const rankFn = vi.fn();
const backtestFn = vi.fn();
const rankSeriesFn = vi.fn();
const pulseFn = vi.fn();
const FAKE_ANALYSIS = {
  client: {
    size: 3,
    rank: (...a: unknown[]) => rankFn(...a),
    backtest: (...a: unknown[]) => backtestFn(...a),
    rankSeries: (...a: unknown[]) => rankSeriesFn(...a),
    pulse: (...a: unknown[]) => pulseFn(...a),
  },
  symbols: ['AAA', 'BBB'],
  bars: 250,
  status: 'ready' as const,
  error: null,
};
vi.mock('../useAnalysis', () => ({ useAnalysis: () => FAKE_ANALYSIS }));

const seriesFn = vi.fn();
const manifestFn = vi.fn();
vi.mock('../../data-client/client', () => ({
  dataClient: {
    series: (...a: unknown[]) => seriesFn(...a),
    manifest: (...a: unknown[]) => manifestFn(...a),
  },
}));

const sectorsFn = vi.fn();
vi.mock('../../data-client/sectors', () => ({
  sectorsClient: { map: (...a: unknown[]) => sectorsFn(...a) },
}));

import Strategies from './Strategies';

function metrics(over: Partial<BacktestMetrics>): BacktestMetrics {
  return {
    bars: 250,
    years: 1,
    trades: 4,
    totalReturnPct: 10,
    cagrPct: 10,
    volatilityPct: 20,
    sharpe: 0.5,
    sortino: 0.7,
    calmar: 0.8,
    ulcer: 5,
    maxDrawdownPct: 12,
    maxDrawdownBars: 30,
    winRatePct: 55,
    profitFactor: 1.4,
    expectancyPct: 1,
    avgWinPct: 4,
    avgLossPct: -3,
    avgBars: 12,
    avgMaePct: -3,
    avgMfePct: 5,
    exposurePct: 40,
    costDragPct: 1.2,
    buyHoldReturnPct: 8,
    buyHoldCagrPct: 8,
    excessCagrPct: 2,
    ...over,
  };
}

/** Kazanan strateji: 20 sembolün hepsinde al-tut'u yeniyor. */
function winners(excess: number): SymbolResult[] {
  return Array.from({ length: 20 }, (_, i) => ({
    symbol: `S${i}`,
    metrics: metrics({ excessCagrPct: excess, cagrPct: 8 + excess }),
  }));
}

function candles(n: number): Candles {
  const c = emptyCandles(n);
  for (let i = 0; i < n; i++) {
    c.time[i] = (19000 + i) * 86400;
    c.open[i] = c.high[i] = c.low[i] = c.close[i] = 100;
    c.volume[i] = 1000;
  }
  return c;
}

const push = vi.fn();
const STATE = { v: 'stratejiler', m: 'bist', s: 'AAA' };

beforeEach(() => {
  vi.clearAllMocks();
  sectorsFn.mockResolvedValue(null); // varsayılan: sınıflandırma yok
  const results: Record<string, SymbolResult[]> = {};
  const skipped: Record<string, number> = {};
  STRATEGY_PRESETS.forEach((preset, i) => {
    // İlk strateji her sembolde yeniyor; ikincisi kaybediyor;
    // üçüncüsü hiç ölçülemiyor (ısınma sığmadı).
    results[preset.id] = i === 0 ? winners(4) : i === 1 ? winners(-3) : i === 2 ? [] : winners(0.1);
    skipped[preset.id] = i === 2 ? 200 : 0;
  });
  rankFn.mockResolvedValue({ results, skipped, symbols: 200, ms: 164.7 });
  seriesFn.mockResolvedValue({ candles: candles(3000) });
  backtestFn.mockResolvedValue({ metrics: metrics({ excessCagrPct: 1.5 }), ms: 12 });
  pulseFn.mockResolvedValue({
    rows: [
      { symbol: 'AAA', value: 900 },
      { symbol: 'BBB', value: 500 },
    ],
    summary: {},
    ms: 5,
  });
  manifestFn.mockResolvedValue({
    version: 1,
    market: 'bist',
    generated: 1,
    symbols: {
      AAA: { f: 'AAA.bin', n: 3000, d0: 1, d1: 2, b: 1_048_576, h: 'a' },
      BBB: { f: 'BBB.bin', n: 3000, d0: 1, d1: 2, b: 524_288, h: 'b' },
    },
  });
  rankSeriesFn.mockImplementation(async (symbol: string) => ({
    symbol,
    metrics: Object.fromEntries(
      STRATEGY_PRESETS.slice(0, 2).map((p) => [p.id, metrics({ excessCagrPct: 3 })]),
    ),
    skipped: STRATEGY_PRESETS.slice(2).map((p) => p.id),
    bars: 3000,
    ms: 9,
  }));
});

describe('Stratejiler', () => {
  it('piyasa kapsamında stratejileri al-tut farkına göre sıralar', async () => {
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const rows = screen.getAllByRole('row').slice(1); // başlık satırı hariç
    expect(within(rows[0]).getByText(STRATEGY_PRESETS[0].name)).toBeInTheDocument();
    expect(within(rows[0]).getByText('anlamlı')).toBeInTheDocument();
  });

  it('ölçülemeyen satırda "—%" gibi yarım bir işaret bırakmaz', async () => {
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText(/Al-tut farkı/)).toBeInTheDocument());
    // Yüzde işareti şablonda sabitti; sayı yokken "—%" çıkıyordu.
    expect(document.body.textContent).not.toContain('—%');
  });

  it('ölçülemeyen stratejiyi "zayıf" saymaz, gerekçesini yazar', async () => {
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText('ölçülemedi')).toBeInTheDocument());
    expect(screen.getByText(/200 sembolde ısınma barlarına sığmıyor/)).toBeInTheDocument();
  });

  it('maks. düşüşü Laboratuvar ile aynı işaretle yazar', async () => {
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByText(/Al-tut farkı/)).toBeInTheDocument());
    // Maks. düşüş sütunu (satırın 3. sayısal hücresi); sahte veride %12.
    const row = document.querySelector('tbody tr')!;
    const nums = [...row.querySelectorAll('td.num')].map((c) => c.textContent ?? '');
    expect(nums[2]).toBe('-%12,0');
  });

  it('bağımsızlık uyarısını tablodan ayırmaz', async () => {
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getByText(/p-değeri gerçekte olduğundan İYİMSERDİR/)).toBeInTheDocument();
  });

  it('maliyet kapatılınca yeniden hesaplanır', async () => {
    const user = userEvent.setup();
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(rankFn).toHaveBeenCalledTimes(1));
    expect(rankFn.mock.calls[0][2].costs.commissionBps).toBeGreaterThan(0);

    await user.click(screen.getByLabelText('Maliyet dahil'));
    await waitFor(() => expect(rankFn).toHaveBeenCalledTimes(2));
    expect(rankFn.mock.calls[1][2].costs.commissionBps).toBe(0);
  });

  it('tek sembol kapsamında tüm geçmişi kullanır ve p-değeri göstermez', async () => {
    const user = userEvent.setup();
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Kapsam'), 'symbol');
    await waitFor(() => expect(backtestFn).toHaveBeenCalledTimes(STRATEGY_PRESETS.length));
    expect(seriesFn).toHaveBeenCalledWith('bist', 'AAA');
    expect(screen.queryByText(/p \(iki yönlü/)).toBeNull();
    expect(screen.getByText(/tek gözlem olduğu için p-değeri hesaplanmaz/i)).toBeInTheDocument();
  });

  it('derin tarama kendiliğinden başlamaz, önce indirme boyutunu söyler', async () => {
    const user = userEvent.setup();
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Kapsam'), 'deep');
    // 1 MB + 0,5 MB = 1,5 MB; manifestten okunuyor, tahmin değil.
    await waitFor(() => expect(screen.getByText('1.5 MB')).toBeInTheDocument());
    expect(rankSeriesFn).not.toHaveBeenCalled();
    expect(seriesFn).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Derin taramayı başlat' }));
    await waitFor(() => expect(rankSeriesFn).toHaveBeenCalledTimes(2));
    expect(seriesFn).toHaveBeenCalledWith('bist', 'AAA');
  });

  it('derin taramada ısınma sığmayan strateji ölçülemedi kalır', async () => {
    const user = userEvent.setup();
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Kapsam'), 'deep');
    await user.click(await screen.findByRole('button', { name: 'Derin taramayı başlat' }));
    await waitFor(() => expect(screen.getAllByText('ölçülemedi').length).toBeGreaterThan(0));
    // Ölçülenler için p-değeri sütunu derin kapsamda da var (birden çok sembol).
    expect(screen.getByText(/p \(iki yönlü/)).toBeInTheDocument();
  });

  it('en iyi sembole tıklamak sembol masasına götürür', async () => {
    const user = userEvent.setup();
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: STRATEGY_PRESETS[0].name }));
    await user.click(screen.getByRole('button', { name: 'S0' }));
    expect(push).toHaveBeenCalledWith({ v: 'sembol', s: 'S0' });
  });
});

describe('Stratejiler — tarama sonucu kapsamı', () => {
  it('sy= ile gelince o kapsamda açılır ve yalnızca o sembolleri hazırlar', async () => {
    render(<Strategies state={{ ...STATE, sy: 'AAA,BBB' }} push={push} />);
    // Kapsam seçicisi tarama sonucunu gösterir ve indirme planı o sembollerden.
    await waitFor(() => expect(screen.getByText(/Tarama sonucu \(2 sembol\)/)).toBeInTheDocument());
    expect(rankFn).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Bu sembollerde test et' })).toBeInTheDocument(),
    );
  });

  it('seçimin tarama kriterlerine koşullu olduğunu söyler', async () => {
    render(<Strategies state={{ ...STATE, sy: 'AAA' }} push={push} />);
    await waitFor(() => expect(screen.getByText(/o kriterlere koşulludur/)).toBeInTheDocument());
  });

  it('liste boşsa kapsam seçeneği hiç görünmez', async () => {
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.queryByText(/Tarama sonucu/)).toBeNull();
  });
});

describe('Strategies — veri gelmezse', () => {
  it('sonsuza kadar iskelet göstermez, nedenini yazar', async () => {
    // Sessiz başarısızlık: ekran "yükleniyor" gibi durup hiç bitmiyordu.
    const prev = { status: FAKE_ANALYSIS.status, error: FAKE_ANALYSIS.error };
    Object.assign(FAKE_ANALYSIS, { status: 'error', error: 'Paket indirilemedi (HTTP 404)' });
    try {
      render(<Strategies state={STATE} push={push} />);
      expect(await screen.findByText('Strateji verisi yüklenemedi')).toBeInTheDocument();
      expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
    } finally {
      Object.assign(FAKE_ANALYSIS, prev);
    }
  });
});

/**
 * SEKTÖR kapsamı.
 *
 * Piyasa geneli ortalama sektör farklarını yutuyor: bankada işe yarayan bir
 * kural çimentoda çalışmayabilir ve tek bir piyasa sıralaması ikisini aynı
 * sayıya karıştırıyor.
 */
describe('Stratejiler — sektör kapsamı', () => {
  const HARITA = {
    source: 'test',
    generated: 1,
    of: { AAA: 'Bankacılık', BBB: 'Çimento' },
  };

  it('sınıflandırma yoksa seçenek HİÇ görünmüyor', async () => {
    render(<Strategies state={STATE} push={push} />);
    await waitFor(() => expect(screen.getByLabelText('Kapsam')).toBeInTheDocument());
    expect(within(screen.getByLabelText('Kapsam')).queryByText('Sektör (tam geçmiş)')).toBeNull();
  });

  it('sektör seçilince YALNIZCA o sektörün sembolleri planlanıyor', async () => {
    const user = userEvent.setup();
    sectorsFn.mockResolvedValue(HARITA);
    render(<Strategies state={STATE} push={push} />);

    await user.selectOptions(await screen.findByLabelText('Kapsam'), 'sektor');
    // Sektör seçilmeden indirme planı hesaplanmıyor: boş liste için paket
    // indirip "0 sembol" demek olurdu.
    expect(await screen.findByText('Önce bir sektör seçin.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Sektör'), 'Bankacılık');
    // AAA bankacılıkta, BBB değil → tek sembol.
    expect(await screen.findByText(/1 sembol ·/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Bankacılık sektöründe test et' }),
    ).toBeInTheDocument();
  });
});

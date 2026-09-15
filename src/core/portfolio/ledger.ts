/**
 * Portföy defteri: işlemler → pozisyonlar, gerçekleşen kâr/zarar, getiri.
 *
 * Maliyet yöntemi **ağırlıklı ortalama** (Türkiye'deki yaygın uygulama ve
 * aracı kurum ekstrelerinin varsayılanı). FIFO farklı sonuç verir; yöntem
 * arayüzde açıkça yazılır ki karşılaştırma yapan kullanıcı şaşırmasın.
 *
 * Saf: tarih/ağ/DOM yok, her şey girdiden türetilir.
 */

export type Side = 'buy' | 'sell';

export interface Txn {
  id: string;
  symbol: string;
  /** Unix saniye. */
  date: number;
  side: Side;
  shares: number;
  price: number;
  /** Komisyon vb. (para birimi). */
  fee?: number;
}

export interface Position {
  symbol: string;
  shares: number;
  /** Ağırlıklı ortalama maliyet (komisyon dahil). */
  avgCost: number;
  /**
   * MALİYET AĞIRLIKLI ortalama alış tarihi (unix saniye).
   *
   * `firstDate` değil: iki alışın ilki küçük, ikincisi büyükse pozisyonun
   * parası aslında ikinci tarihte bağlanmıştır. Reel (TÜFE düzeltmeli)
   * getiri bu tarihi kullanıyor — paranın ne zaman bağlandığı, enflasyona
   * ne kadar maruz kaldığını belirleyen şeydir.
   *
   * `avgCost` ile AYNI yinelemeyle tutuluyor: ağırlıklı ortalama maliyet
   * yönteminde satış ortalamayı değiştirmez, alış ise eski ağırlıkla yeniyi
   * harmanlar.
   */
  avgDate: number;
  /** Bu sembolde kapanan işlemlerden gerçekleşen kâr/zarar. */
  realizedPnl: number;
  /** Ödenen toplam komisyon. */
  fees: number;
  firstDate: number;
  lastDate: number;
}

export interface Ledger {
  positions: Position[];
  /** Kapanmış dahil tüm sembollerin gerçekleşen toplamı. */
  realizedPnl: number;
  fees: number;
  /** Portföye giren (+) / çıkan (−) nakit akışları, IRR için. */
  cashFlows: { date: number; amount: number }[];
  /** Satılamayan (elde olmayan) hisse satışı gibi tutarsızlıklar. */
  warnings: string[];
}

export function buildLedger(txns: Txn[]): Ledger {
  const sorted = [...txns].sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
  const bySymbol = new Map<string, Position>();
  const cashFlows: { date: number; amount: number }[] = [];
  const warnings: string[] = [];
  let realized = 0;
  let fees = 0;

  for (const txn of sorted) {
    if (!(txn.shares > 0) || !(txn.price >= 0)) {
      warnings.push(`${txn.symbol}: geçersiz adet/fiyat (${txn.shares} @ ${txn.price}) atlandı.`);
      continue;
    }
    const fee = txn.fee ?? 0;
    fees += fee;

    let position = bySymbol.get(txn.symbol);
    if (!position) {
      position = {
        symbol: txn.symbol,
        shares: 0,
        avgCost: 0,
        avgDate: txn.date,
        realizedPnl: 0,
        fees: 0,
        firstDate: txn.date,
        lastDate: txn.date,
      };
      bySymbol.set(txn.symbol, position);
    }
    position.fees += fee;
    position.lastDate = txn.date;

    if (txn.side === 'buy') {
      const eskiTutar = position.shares * position.avgCost;
      const yeniTutar = txn.shares * txn.price + fee;
      const cost = eskiTutar + yeniTutar;
      // Tarih de TUTARLA ağırlıklanıyor, adetle değil: enflasyona maruz kalan
      // şey adet değil paradır.
      position.avgDate =
        cost > 0 ? (position.avgDate * eskiTutar + txn.date * yeniTutar) / cost : txn.date;
      position.shares += txn.shares;
      position.avgCost = position.shares > 0 ? cost / position.shares : 0;
      cashFlows.push({ date: txn.date, amount: -(txn.shares * txn.price + fee) });
    } else {
      if (txn.shares > position.shares + 1e-9) {
        warnings.push(
          `${txn.symbol}: elde ${position.shares} varken ${txn.shares} satış var — ` +
            'açığa satış desteklenmiyor, fazlası yok sayıldı.',
        );
      }
      const sold = Math.min(txn.shares, position.shares);
      const pnl = sold * (txn.price - position.avgCost) - fee;
      position.realizedPnl += pnl;
      realized += pnl;
      position.shares -= sold;
      if (position.shares <= 1e-9) {
        position.shares = 0;
        position.avgCost = 0;
      }
      cashFlows.push({ date: txn.date, amount: sold * txn.price - fee });
    }
  }

  return {
    positions: [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol, 'tr')),
    realizedPnl: realized,
    fees,
    cashFlows,
    warnings,
  };
}

export interface Valuation {
  symbol: string;
  shares: number;
  avgCost: number;
  price: number;
  value: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedPct: number;
  /** Portföy içindeki ağırlık (%). */
  weightPct: number;
}

export interface PortfolioValue {
  rows: Valuation[];
  totalValue: number;
  totalCost: number;
  unrealizedPnl: number;
  /** Fiyatı bulunamayan semboller — değerleme eksik kalır, gizlenmez. */
  missingPrices: string[];
}

export function valuePortfolio(
  positions: Position[],
  priceOf: (symbol: string) => number | undefined,
): PortfolioValue {
  const rows: Valuation[] = [];
  const missing: string[] = [];
  let totalValue = 0;
  let totalCost = 0;

  for (const position of positions) {
    if (position.shares <= 0) continue;
    const price = priceOf(position.symbol);
    if (price === undefined || !Number.isFinite(price)) {
      missing.push(position.symbol);
      continue;
    }
    const value = position.shares * price;
    const cost = position.shares * position.avgCost;
    totalValue += value;
    totalCost += cost;
    rows.push({
      symbol: position.symbol,
      shares: position.shares,
      avgCost: position.avgCost,
      price,
      value,
      costBasis: cost,
      unrealizedPnl: value - cost,
      unrealizedPct: cost > 0 ? ((value - cost) / cost) * 100 : 0,
      weightPct: 0,
    });
  }

  for (const row of rows) row.weightPct = totalValue > 0 ? (row.value / totalValue) * 100 : 0;
  rows.sort((a, b) => b.value - a.value);

  return {
    rows,
    totalValue,
    totalCost,
    unrealizedPnl: totalValue - totalCost,
    missingPrices: missing,
  };
}

const YEAR_SECONDS = 365.25 * 86400;

/**
 * Para ağırlıklı getiri (IRR/XIRR).
 *
 * Zaman ağırlıklı getiri fon performansını ölçer; YATIRIMCININ getirisi
 * para akışlarının zamanlamasına bağlıdır. Tepe noktasında para eklediyseniz
 * bunu yalnızca IRR gösterir.
 */
export function moneyWeightedReturn(
  cashFlows: { date: number; amount: number }[],
  finalValue: number,
  finalDate: number,
): number {
  const flows = [...cashFlows, { date: finalDate, amount: finalValue }].sort(
    (a, b) => a.date - b.date,
  );
  if (flows.length < 2) return NaN;
  const t0 = flows[0].date;

  const npv = (rate: number): number =>
    flows.reduce((sum, f) => {
      const years = (f.date - t0) / YEAR_SECONDS;
      return sum + f.amount / Math.pow(1 + rate, years);
    }, 0);

  // İkiye bölme: -%99 ile +%1000 arasında kök arar (Newton'dan daha dayanıklı).
  let low = -0.99;
  let high = 10;
  let fLow = npv(low);
  let fHigh = npv(high);
  if (!Number.isFinite(fLow) || !Number.isFinite(fHigh) || fLow * fHigh > 0) return NaN;

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-9) return mid * 100;
    if (fLow * fMid < 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return ((low + high) / 2) * 100;
}

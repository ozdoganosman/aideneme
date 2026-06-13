import { useEffect, useState } from 'react';
import { Candles } from '../data/types';
import { optimize, StrategyResult, explainStrategy } from '../indicators/backtest';
import { fetchStrategies, StrategiesFile } from '../data/bistStatic';

interface Props {
  candles: Candles;
  symbol: string;
  onClose: () => void;
  onSelect: (name: string) => void;
}

// Exclude short-term / high-turnover strategies (avg holding < ~5 weeks).
const MIN_HOLD = 25;

export function Backtest({ candles, symbol, onClose, onSelect }: Props) {
  const [data, setData] = useState<{ results: StrategyResult[]; holdPct: number } | null>(null);
  const [market, setMarket] = useState<StrategiesFile | null>(null);
  const [marketLoaded, setMarketLoaded] = useState(false);
  const [tab, setTab] = useState<'market' | 'symbol'>('market');

  useEffect(() => {
    setData(null);
    const t = setTimeout(() => setData(optimize(candles)), 20);
    return () => clearTimeout(t);
  }, [candles]);

  useEffect(() => {
    fetchStrategies()
      .then(setMarket)
      .catch(() => setMarket(null))
      .finally(() => setMarketLoaded(true));
  }, []);

  const pick = (name: string) => {
    onSelect(name);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Strateji Taraması</b>
          <button className="row-x" onClick={onClose} title="Kapat">×</button>
        </div>

        <div className="bt-tabs">
          <button className={tab === 'market' ? 'active' : ''} onClick={() => setTab('market')}>
            📊 Piyasa Geneli{market ? ` · ${market.nSymbols} hisse` : ''}
          </button>
          <button className={tab === 'symbol' ? 'active' : ''} onClick={() => setTab('symbol')}>
            📈 {symbol}
          </button>
        </div>

        <div className="modal-body">
          <details className="bt-glossary">
            <summary>ℹ️ Stratejiler ne demek? (basitçe)</summary>
            <div>
              <p>
                <b>EMA kesişimi:</b> İki hareketli ortalamadan kısa olan uzunu yukarı keserse AL, aşağı keserse SAT
                (trend takibi).
              </p>
              <p>
                <b>MACD:</b> Kısa ve uzun ortalamanın farkının yönüne/sinyaline göre AL-SAT (momentum).
              </p>
              <p>
                <b>Williams %R:</b> Fiyatın son N günün neresinde olduğunu ölçer; dipten dönüşte AL, tepeden dönüşte SAT
                (aşırı alım/satım).
              </p>
              <p className="lg-muted">
                Sayılar (örn. 9/21) gün sayısıdır — küçük = hızlı/çok sinyal, büyük = yavaş/az sinyal. Her satırdaki ⓘ
                üstüne gelince o stratejinin açıklamasını gösterir.
              </p>
            </div>
          </details>

          {tab === 'market' ? renderMarket(market, marketLoaded, pick) : renderSymbol(data, pick, candles.length)}
          <div className="bt-hint">
            Çubuk = getiri. Bir stratejiye <b>tıkla</b> → grafikte AL/SAT noktaları işaretlenir.
            <br />⚠️ Geçmişe dönük (in-sample); geçmiş performans geleceği garanti etmez.
          </div>
        </div>
      </div>
    </div>
  );
}

function renderMarket(
  market: StrategiesFile | null,
  loaded: boolean,
  pick: (n: string) => void,
) {
  if (!loaded) return <div className="bt-note">Yükleniyor…</div>;
  if (!market || market.results.length === 0)
    return <div className="bt-note">Piyasa geneli sonuç henüz hazır değil (CI bir sonraki dağıtımda üretecek).</div>;

  const filtered = market.results.filter((r) => (r.avgHold ?? 999) >= MIN_HOLD);
  const list = filtered.length ? filtered : market.results;
  const rows = list.slice(0, 12);
  const max = Math.max(...rows.map((r) => Math.abs(r.avgRet)), 1);
  const w = list[0];

  return (
    <>
      <p className="bt-intro">
        ~{market.nSymbols} BIST hissesinin tümünde geçmiş günlük veriyle test edildi; <b>ortalama getiri</b>ye göre
        sıralı (kısa vadeli / çok işlem yapanlar hariç). Karşılaştırma — <b>Al-Tut</b> ortalaması:{' '}
        <b className="up">{fmtX(market.holdAvg)}</b>
      </p>

      <Winner
        name={w.name}
        big={fmtX(w.avgRet)}
        stats={`Medyan ${fmtX(w.medRet)} · Hisselerin %${w.beatPct.toFixed(0)}'inde Al-Tut'u geçti · Kazanma %${w.avgWin.toFixed(0)}`}
        onClick={() => pick(w.name)}
      />

      <div className="bt-list">
        {rows.map((r, i) => (
          <Row
            key={r.name}
            rank={i + 1}
            name={r.name}
            value={r.avgRet}
            max={max}
            label={fmtX(r.avgRet)}
            sub={`Al-Tut'u geçme %${r.beatPct.toFixed(0)} · Kazanma %${r.avgWin.toFixed(0)} · DD -${r.avgDD.toFixed(0)}%`}
            onClick={() => pick(r.name)}
          />
        ))}
      </div>
    </>
  );
}

function renderSymbol(
  data: { results: StrategyResult[]; holdPct: number } | null,
  pick: (n: string) => void,
  nBars: number,
) {
  if (!data)
    return (
      <div className="bt-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="spinner" /> Hesaplanıyor…
      </div>
    );

  const filtered = data.results.filter((r) => r.trades > 0 && nBars / r.trades >= MIN_HOLD);
  const list = filtered.length ? filtered : data.results;
  const rows = list.slice(0, 12);
  const max = Math.max(...rows.map((r) => Math.abs(r.retPct)), Math.abs(data.holdPct), 1);
  const w = list[0];

  return (
    <>
      <p className="bt-intro">
        Bu hissede her strateji geçmişte otomatik uygulanırsa ne kazandırırdı (kısa vadeli / çok işlem yapanlar hariç).
        Karşılaştırma — <b>Al-Tut</b>: <b className={data.holdPct >= 0 ? 'up' : 'down'}>{fmtX(data.holdPct)}</b>
      </p>

      <Winner
        name={w.name}
        big={fmtX(w.retPct)}
        stats={`Al-Tut'a göre ${fmtX(w.retPct - data.holdPct)} · ${w.trades} işlem · Kazanma %${w.winRate.toFixed(0)} · DD -${w.maxDD.toFixed(0)}%`}
        onClick={() => pick(w.name)}
      />

      <div className="bt-list">
        {rows.map((r, i) => (
          <Row
            key={r.name}
            rank={i + 1}
            name={r.name}
            value={r.retPct}
            max={max}
            label={fmtX(r.retPct)}
            sub={`Al-Tut'a ${fmtX(r.retPct - data.holdPct)} · ${r.trades} işlem · Kazanma %${r.winRate.toFixed(0)} · DD -${r.maxDD.toFixed(0)}%`}
            onClick={() => pick(r.name)}
          />
        ))}
      </div>
    </>
  );
}

function Winner({ name, big, stats, onClick }: { name: string; big: string; stats: string; onClick: () => void }) {
  return (
    <div className="bt-winner clickable" onClick={onClick} title={explainStrategy(name)}>
      <div className="bt-winner-l">
        <div className="bt-winner-badge">🏆 En iyi</div>
        <div className="bt-winner-name">{name}</div>
        <div className="bt-winner-stats">{stats}</div>
      </div>
      <div className="bt-winner-big up">{big}</div>
    </div>
  );
}

function Row({
  rank,
  name,
  value,
  max,
  label,
  sub,
  onClick,
}: {
  rank: number;
  name: string;
  value: number;
  max: number;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  const width = Math.max(3, Math.min(100, (Math.abs(value) / max) * 100));
  return (
    <div className="bt-srow clickable" onClick={onClick} title="Grafikte göster">
      <div className="bt-srow-head">
        <span className="bt-rank">{rank}</span>
        <span className="bt-srow-name">{name}</span>
        <span className={'bt-srow-val ' + (value >= 0 ? 'up' : 'down')}>{label}</span>
      </div>
      <div className="bt-barwrap">
        <div className={'bt-bar ' + (value >= 0 ? 'pos' : 'neg')} style={{ width: width + '%' }} />
      </div>
      <div className="bt-srow-sub">{sub}</div>
      <div className="bt-srow-explain">{explainStrategy(name)}</div>
    </div>
  );
}

// Big returns as a multiplier (e.g. 64x), smaller ones as %.
function fmtX(r: number): string {
  if (!isFinite(r)) return '—';
  if (r >= 1000) {
    const m = 1 + r / 100;
    return (m >= 100 ? m.toFixed(0) : m.toFixed(1)) + 'x';
  }
  return (r >= 0 ? '+' : '') + Math.round(r) + '%';
}

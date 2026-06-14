import { useEffect, useState } from 'react';
import { Candles } from '../data/types';
import { optimize, StrategyResult, explainStrategy } from '../indicators/backtest';
import { fetchStrategies, StrategiesFile } from '../data/bistStatic';

interface Props {
  candles: Candles;
  symbol: string;
  onClose: () => void;
  onSelect: (name: string) => void;
  onPickSymbolStrategy: (sym: string, name: string) => void;
}

// Exclude short-term / high-turnover strategies (avg holding < ~5 weeks).
const MIN_HOLD = 25;

export function Backtest({ candles, symbol, onClose, onSelect, onPickSymbolStrategy }: Props) {
  const [data, setData] = useState<{ results: StrategyResult[]; holdPct: number; holdAnn: number } | null>(null);
  const [market, setMarket] = useState<StrategiesFile | null>(null);
  const [marketLoaded, setMarketLoaded] = useState(false);
  const [tab, setTab] = useState<'market' | 'top' | 'symbol'>('market');

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

  const pickCombo = (sym: string, name: string) => {
    onPickSymbolStrategy(sym, name);
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
          <button className={tab === 'top' ? 'active' : ''} onClick={() => setTab('top')}>
            🏅 En İyi 20
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
                <b>📈 Trend takibi (EMA / MACD):</b> Fiyat yükselişe geçince AL, düşüşe dönünce SAT — "yükselen ata bin".
                Trendli piyasada kazandırır, yatay piyasada yıpratır.
              </p>
              <p>
                <b>🔄 Dipten al, tepeden sat (Williams %R):</b> Fiyat aşırı düşünce AL, aşırı yükselince SAT. Dalgalı/yatay
                piyasada iyi, güçlü trendde geç kalır.
              </p>
              <p className="lg-muted">
                Sayılar gün sayısıdır: küçük = hızlı/çok işlem (kısa vadeli), büyük = yavaş/az işlem (uzun vadeli). Her
                stratejinin altında mantığı yazıyor.
              </p>
              <p className="lg-muted">
                <b>Yıllık / gün başına:</b> Sıralama artık toplam getiriye değil, <b>yıllık ortalama (gün başına)
                kâra</b> göre — 20 yılda biriken dev bir toplam, hızlı bir kazançla adil kıyaslansın diye. Böylece çoğu
                stratejinin aslında <b>Al-Tut</b>'u zor geçtiği görülür.
              </p>
            </div>
          </details>

          {tab === 'market'
            ? renderMarket(market, marketLoaded, pick)
            : tab === 'top'
              ? renderTop(market, marketLoaded, pickCombo)
              : renderSymbol(data, pick, candles.length)}
          <div className="bt-hint">
            Çubuk = <b>yıllık getiri</b> (gün başına kâra göre normalize — uzun sürede biriken büyük toplamlar artık
            haksız öne çıkmıyor). Bir stratejiye <b>tıkla</b> → grafikte AL/SAT noktaları işaretlenir.
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

  const hasAnn = market.results.some((r) => r.avgAnn != null);
  const key = (r: StrategiesFile['results'][number]) => (hasAnn ? r.avgAnn ?? -999 : r.avgRet);
  const filtered = market.results.filter((r) => (r.avgHold ?? 999) >= MIN_HOLD);
  const list = (filtered.length ? filtered : market.results).slice().sort((a, b) => key(b) - key(a));
  const rows = list.slice(0, 12);
  const max = Math.max(...rows.map((r) => Math.abs(key(r))), 1);
  const w = list[0];
  const holdAnn = market.holdAnnAvg;

  return (
    <>
      <p className="bt-intro">
        ~{market.nSymbols} BIST hissesinin tümünde geçmiş günlük veriyle test edildi;{' '}
        {hasAnn ? <b>yıllık (gün başına) getiri</b> : <b>ortalama getiri</b>}ye göre sıralı (kısa vadeli / çok işlem
        yapanlar hariç). Karşılaştırma — <b>Al-Tut</b>{' '}
        {hasAnn && holdAnn != null ? (
          <>
            yıllık ort.: <b className="up">{fmtPct(holdAnn)}</b>
          </>
        ) : (
          <>
            ort.: <b className="up">{fmtX(market.holdAvg)}</b>
          </>
        )}
      </p>

      <Winner
        name={w.name}
        big={hasAnn ? fmtPct(w.avgAnn!) : fmtX(w.avgRet)}
        tag={hasAnn ? 'yıllık' : ''}
        stats={
          hasAnn
            ? `gün başına ${perDay(w.avgAnn!)} · toplam ${fmtX(w.avgRet)} · Al-Tut'u %${w.beatPct.toFixed(0)} geçti · Kazanma %${w.avgWin.toFixed(0)}`
            : `Medyan ${fmtX(w.medRet)} · Hisselerin %${w.beatPct.toFixed(0)}'inde Al-Tut'u geçti · Kazanma %${w.avgWin.toFixed(0)}`
        }
        onClick={() => pick(w.name)}
      />

      <div className="bt-list">
        {rows.map((r, i) => (
          <Row
            key={r.name}
            rank={i + 1}
            name={r.name}
            value={hasAnn ? r.avgAnn ?? 0 : r.avgRet}
            max={max}
            label={hasAnn ? fmtPct(r.avgAnn!) : fmtX(r.avgRet)}
            tag={hasAnn ? 'yıl' : ''}
            sub={
              hasAnn
                ? `gün başına ${perDay(r.avgAnn!)} · toplam ${fmtX(r.avgRet)} · Al-Tut %${r.beatPct.toFixed(0)} · DD -${r.avgDD.toFixed(0)}%`
                : `Al-Tut'u geçme %${r.beatPct.toFixed(0)} · Kazanma %${r.avgWin.toFixed(0)} · DD -${r.avgDD.toFixed(0)}%`
            }
            onClick={() => pick(r.name)}
          />
        ))}
      </div>
    </>
  );
}

function renderTop(
  market: StrategiesFile | null,
  loaded: boolean,
  pickCombo: (sym: string, name: string) => void,
) {
  if (!loaded) return <div className="bt-note">Yükleniyor…</div>;
  const top = market?.top ?? [];
  if (top.length === 0)
    return <div className="bt-note">En iyi 20 listesi henüz hazır değil (CI bir sonraki dağıtımda üretecek).</div>;

  return (
    <>
      <p className="bt-intro">
        ~{market?.nSymbols ?? 0} BIST hissesi × tüm stratejiler içinde geçmişte <b>yıllık</b> getirisi en yüksek 20{' '}
        <b>hisse + strateji</b> eşleşmesi (her hisse için en iyi stratejisi; yalnızca{' '}
        <b>en az {market?.topMinYears ?? 10} yıllık</b> geçmişi olan firmalar). Bir satıra <b>tıkla</b> → o hisseyi açar
        ve stratejiyi grafiğe işaretler.
      </p>
      <div className="bt-list">
        {top.map((t, i) => (
          <div
            key={t.sym + t.name}
            className="bt-srow clickable"
            onClick={() => pickCombo(t.sym, t.name)}
            title={`${t.sym} aç + ${t.name} göster`}
          >
            <div className="bt-srow-head">
              <span className="bt-rank">{i + 1}</span>
              <span className="bt-srow-name">
                <b>{t.sym}</b> · {t.name}
              </span>
              <span className="bt-srow-val up">
                {fmtPct(t.ann)}
                <span className="bt-tag">yıl</span>
              </span>
            </div>
            <div className="bt-srow-sub">
              toplam {fmtX(t.ret)} · {t.trades} işlem · Kazanma %{t.win.toFixed(0)} · DD -{t.dd.toFixed(0)}%
            </div>
            <div className="bt-srow-explain">{explainStrategy(t.name)}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function renderSymbol(
  data: { results: StrategyResult[]; holdPct: number; holdAnn: number } | null,
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
  const max = Math.max(...rows.map((r) => Math.abs(r.annPct)), Math.abs(data.holdAnn), 1);
  const w = list[0];

  return (
    <>
      <p className="bt-intro">
        Bu hissede her strateji geçmişte otomatik uygulanırsa ne kazandırırdı — <b>yıllık (gün başına)</b> getiriye göre
        sıralı (kısa vadeli / çok işlem yapanlar hariç). Karşılaştırma — <b>Al-Tut</b> yıllık:{' '}
        <b className={data.holdAnn >= 0 ? 'up' : 'down'}>{fmtPct(data.holdAnn)}</b>
      </p>

      <Winner
        name={w.name}
        big={fmtPct(w.annPct)}
        tag="yıllık"
        stats={`gün başına ${perDay(w.annPct)} · toplam ${fmtX(w.retPct)} · Al-Tut'a ${fmtPct(w.annPct - data.holdAnn)} · ${w.trades} işlem · Kazanma %${w.winRate.toFixed(0)}`}
        onClick={() => pick(w.name)}
      />

      <div className="bt-list">
        {rows.map((r, i) => (
          <Row
            key={r.name}
            rank={i + 1}
            name={r.name}
            value={r.annPct}
            max={max}
            label={fmtPct(r.annPct)}
            tag="yıl"
            sub={`gün başına ${perDay(r.annPct)} · toplam ${fmtX(r.retPct)} · Al-Tut'a ${fmtPct(r.annPct - data.holdAnn)} · ${r.trades} işlem · DD -${r.maxDD.toFixed(0)}%`}
            onClick={() => pick(r.name)}
          />
        ))}
      </div>
    </>
  );
}

function Winner({
  name,
  big,
  tag,
  stats,
  onClick,
}: {
  name: string;
  big: string;
  tag?: string;
  stats: string;
  onClick: () => void;
}) {
  return (
    <div className="bt-winner clickable" onClick={onClick} title={explainStrategy(name)}>
      <div className="bt-winner-l">
        <div className="bt-winner-badge">🏆 En iyi</div>
        <div className="bt-winner-name">{name}</div>
        <div className="bt-winner-stats">{stats}</div>
      </div>
      <div className="bt-winner-big up">
        {big}
        {tag && <span className="bt-tag">{tag}</span>}
      </div>
    </div>
  );
}

function Row({
  rank,
  name,
  value,
  max,
  label,
  tag,
  sub,
  onClick,
}: {
  rank: number;
  name: string;
  value: number;
  max: number;
  label: string;
  tag?: string;
  sub: string;
  onClick: () => void;
}) {
  const width = Math.max(3, Math.min(100, (Math.abs(value) / max) * 100));
  return (
    <div className="bt-srow clickable" onClick={onClick} title="Grafikte göster">
      <div className="bt-srow-head">
        <span className="bt-rank">{rank}</span>
        <span className="bt-srow-name">{name}</span>
        <span className={'bt-srow-val ' + (value >= 0 ? 'up' : 'down')}>
          {label}
          {tag && <span className="bt-tag">{tag}</span>}
        </span>
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

// Annualized return as a plain percent (always sensible-sized, no x).
function fmtPct(r: number): string {
  if (!isFinite(r)) return '—';
  return (r >= 0 ? '+' : '') + (Math.abs(r) < 10 ? r.toFixed(1) : Math.round(r).toString()) + '%';
}

// Daily-compounded equivalent of an annualized return ("gün başına" kâr).
function perDay(ann: number): string {
  if (!isFinite(ann) || ann <= -100) return '—';
  const d = (Math.pow(1 + ann / 100, 1 / 365.25) - 1) * 100;
  return (d >= 0 ? '+' : '') + d.toFixed(3) + '%';
}

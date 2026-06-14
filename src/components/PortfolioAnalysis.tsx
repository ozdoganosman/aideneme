import { useEffect, useState } from 'react';
import { fetchBistStatic, Quotes } from '../data/bistStatic';
import { analyzeHolding, HoldingAnalysis } from '../indicators/analysis';
import { Holding } from './Portfolio';

interface Row {
  sym: string;
  value: number;
  weight: number;
  a: HoldingAnalysis | null;
}

interface Props {
  holdings: Holding[];
  quotes: Quotes;
  onClose: () => void;
  onSelect: (s: string) => void;
}

export function PortfolioAnalysis({ holdings, quotes, onClose, onSelect }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [bench, setBench] = useState<number | null>(null); // XU100 1Y return %

  useEffect(() => {
    let cancel = false;
    const totVal = holdings.reduce((s, h) => s + (quotes[h.symbol]?.c ?? 0) * h.qty, 0);
    Promise.all(
      holdings.map(async (h) => {
        const value = (quotes[h.symbol]?.c ?? 0) * h.qty;
        let a: HoldingAnalysis | null = null;
        try {
          a = analyzeHolding(await fetchBistStatic(h.symbol));
        } catch {
          a = null;
        }
        return { sym: h.symbol, value, weight: totVal ? (value / totVal) * 100 : 0, a };
      }),
    ).then((out) => {
      if (!cancel) setRows(out.sort((x, y) => y.weight - x.weight));
    });
    fetchBistStatic('XU100')
      .then((c) => {
        if (!cancel) setBench(analyzeHolding(c)?.r1y ?? null);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [holdings, quotes]);

  const pick = (s: string) => {
    onSelect(s);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Portföy Analizi · Risk & Teknik</b>
          <button className="row-x" onClick={onClose} title="Kapat">×</button>
        </div>
        <div className="modal-body">
          {!rows ? (
            <div className="bt-note" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="spinner" /> Hisseler analiz ediliyor…
            </div>
          ) : rows.length === 0 ? (
            <div className="bt-note">Portföyde pozisyon yok. Önce sembol · adet · maliyet ekle.</div>
          ) : (
            <>
              {renderConcentration(rows)}
              {renderRisk(rows, bench)}
              {renderTech(rows, pick)}
              <div className="bt-hint">
                ⚠️ Bu analiz geçmiş fiyatlara dayalı, otomatik ve eğitim amaçlıdır — yatırım tavsiyesi değildir.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function renderConcentration(rows: Row[]) {
  const ws = rows.map((r) => r.weight);
  const largest = ws.length ? Math.max(...ws) : 0;
  const top3 = ws.slice().sort((a, b) => b - a).slice(0, 3).reduce((s, w) => s + w, 0);
  const hhi = ws.reduce((s, w) => s + (w / 100) * (w / 100), 0);
  const effN = hhi > 0 ? 1 / hhi : 0;
  let verdict = 'Orta düzeyde dağılım.';
  let cls = '';
  if (largest >= 50) {
    verdict = `Tek hisseye aşırı yoğunlaşmış (${rows[0].sym} %${largest.toFixed(0)}) — yüksek tekil risk.`;
    cls = 'down';
  } else if (largest >= 35) {
    verdict = 'Yoğunlaşmış — bir-iki hisseye fazla bağımlı.';
    cls = 'warn';
  } else if (rows.length >= 6 && largest < 20) {
    verdict = 'İyi dağılmış — risk geniş yayılmış.';
    cls = 'up';
  }
  return (
    <div className="pa-card">
      <div className="pa-card-title">📊 Dağılım & Yoğunlaşma</div>
      <div className="pa-grid">
        <div>
          <span className="lg-muted">Pozisyon</span>
          <b>{rows.length}</b>
        </div>
        <div>
          <span className="lg-muted">En büyük</span>
          <b>
            {rows[0].sym} %{largest.toFixed(0)}
          </b>
        </div>
        <div>
          <span className="lg-muted">İlk 3 ağırlık</span>
          <b>%{top3.toFixed(0)}</b>
        </div>
        <div>
          <span className="lg-muted">Etkin çeşitlilik</span>
          <b>{effN.toFixed(1)} hisse</b>
        </div>
      </div>
      <div className={'pa-verdict ' + cls}>{verdict}</div>
    </div>
  );
}

function renderRisk(rows: Row[], bench: number | null) {
  const withA = rows.filter((r) => r.a);
  const pvol = withA.reduce((s, r) => s + (r.weight / 100) * r.a!.volPct, 0);
  const pr1y = withA.reduce((s, r) => s + (r.weight / 100) * r.a!.r1y, 0);
  let plabel = 'Düşük';
  if (pvol >= 80) plabel = 'Çok yüksek';
  else if (pvol >= 50) plabel = 'Yüksek';
  else if (pvol >= 30) plabel = 'Orta';
  const rel = bench != null ? pr1y - bench : null;
  return (
    <div className="pa-card">
      <div className="pa-card-title">⚠️ Risk & XU100'e görece</div>
      <div className="pa-portrisk">
        Portföy oynaklığı (yaklaşık): <b>~%{pvol.toFixed(0)}/yıl</b> · {plabel}{' '}
        <span className="lg-muted">(korelasyon hariç üst sınır)</span>
      </div>
      {bench != null && (
        <div className="pa-portrisk">
          Portföy 1Y:{' '}
          <b className={pr1y >= 0 ? 'up' : 'down'}>
            {pr1y >= 0 ? '+' : ''}
            {pr1y.toFixed(0)}%
          </b>{' '}
          · XU100: <b>{bench >= 0 ? '+' : ''}{bench.toFixed(0)}%</b> · Görece:{' '}
          <b className={(rel ?? 0) >= 0 ? 'up' : 'down'}>
            {(rel ?? 0) >= 0 ? '+' : ''}
            {(rel ?? 0).toFixed(0)}%
          </b>{' '}
          <span className="lg-muted">({(rel ?? 0) >= 0 ? 'endeksi yendi' : 'endeksin altında'})</span>
        </div>
      )}
      <div className="pa-risk-list">
        {rows.map((r) => (
          <div key={r.sym} className="pa-risk-row">
            <span className="pa-risk-sym">{r.sym}</span>
            <span className="lg-muted">%{r.weight.toFixed(0)}</span>
            {r.a ? (
              <>
                <span className={'pa-risk-badge ' + r.a.riskClass}>{r.a.riskLabel}</span>
                <span className="lg-muted">oyn ~%{r.a.volPct.toFixed(0)}</span>
                <span className="down">Düşüş -{r.a.maxDD.toFixed(0)}%</span>
                <span className={r.a.r1y >= 0 ? 'up' : 'down'}>
                  1Y {r.a.r1y >= 0 ? '+' : ''}
                  {r.a.r1y.toFixed(0)}%
                </span>
                {bench != null && (
                  <span className={r.a.r1y - bench >= 0 ? 'up' : 'down'} title="XU100'e görece 1Y">
                    XU {r.a.r1y - bench >= 0 ? '+' : ''}
                    {(r.a.r1y - bench).toFixed(0)}%
                  </span>
                )}
              </>
            ) : (
              <span className="lg-muted">veri yok</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderTech(rows: Row[], pick: (s: string) => void) {
  return (
    <div className="pa-card">
      <div className="pa-card-title">🧭 Teknik Analiz (sade)</div>
      {rows.map((r) => (
        <div key={r.sym} className="pa-tech" onClick={() => pick(r.sym)} title="Grafikte aç">
          <div className="pa-tech-head">
            <b>{r.sym}</b>
            {r.a && (
              <span className={'pa-lean ' + (r.a.lean === 'Olumlu' ? 'up' : r.a.lean === 'Zayıf' ? 'down' : 'warn')}>
                {r.a.lean}
              </span>
            )}
            {r.a && <span className="lg-muted">{r.a.trend}</span>}
          </div>
          {r.a ? (
            <ul className="pa-bullets">
              {r.a.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          ) : (
            <div className="bt-note">Yeterli geçmiş veri yok.</div>
          )}
        </div>
      ))}
    </div>
  );
}

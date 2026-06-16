import { useMemo, useState } from 'react';
import { Candles } from '../data/types';
import { tradesFor, Trade } from '../indicators/backtest';

interface Props {
  strategy: string | null;
  candles: Candles | null;
  onSelectTrade: (t: Trade) => void;
}

type SortKey = 'entry' | 'ep' | 'exit' | 'xp' | 'ret' | 'dur';

const days = (t: Trade): number => Math.round(((t.exitTime ?? Date.now() / 1000) - t.entryTime) / 86400);

const ACC: Record<SortKey, (t: Trade) => number> = {
  entry: (t) => t.entryTime,
  ep: (t) => t.entryPrice,
  exit: (t) => t.exitTime ?? Number.MAX_SAFE_INTEGER,
  xp: (t) => (t.open ? Number.MAX_SAFE_INTEGER : t.exitPrice),
  ret: (t) => t.retPct,
  dur: (t) => days(t),
};

export function Trades({ strategy, candles, onSelectTrade }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const raw = useMemo(() => (strategy && candles ? tradesFor(strategy, candles) : []), [strategy, candles]);
  // Birikimli (bileşik) getiri: işlemler kronolojik sırayla bileşiklenir.
  const cum = useMemo(() => {
    const out = new Array<number>(raw.length);
    let g = 1;
    for (let i = 0; i < raw.length; i++) {
      g *= 1 + raw[i].retPct / 100;
      out[i] = (g - 1) * 100;
    }
    return out;
  }, [raw]);
  const rows = useMemo(() => {
    const idx = raw.map((t, i) => ({ t, n: i + 1, cum: cum[i] }));
    if (!sort) return idx;
    const get = ACC[sort.key];
    return idx.sort((a, b) => (get(a.t) - get(b.t)) * sort.dir);
  }, [raw, cum, sort]);

  if (!strategy || !candles)
    return (
      <div className="panel-empty">
        Önce bir strateji seç: <b>Strateji Taraması</b>'ndan bir stratejiye tıkla. İşlemler burada tablo olarak listelenir ve
        grafiğe AL/SAT işaretlenir.
      </div>
    );

  if (raw.length === 0)
    return (
      <div className="cb-head">
        <b className="cb-name">{strategy}</b>
        <span className="lg-muted">işlem yok</span>
      </div>
    );

  const n = raw.length;
  const wins = raw.filter((t) => t.retPct >= 0).length;
  const avg = raw.reduce((s, t) => s + t.retPct, 0) / n;
  const best = Math.max(...raw.map((t) => t.retPct));
  const worst = Math.min(...raw.map((t) => t.retPct));
  const totalCum = cum[cum.length - 1] ?? 0;

  // 3-durumlu sıralama: tıkla → azalan → artan → varsayılan (kronolojik)
  const toggle = (key: SortKey) =>
    setSort((s) => (s && s.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }));
  const arrow = (k: SortKey) => (sort?.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');

  return (
    <>
      <div className="cb-head">
        <b className="cb-name" title={strategy}>{strategy}</b>
        <span className="lg-muted">
          {n} işlem · %{Math.round((wins / n) * 100)} kazanç · birikim{' '}
          <span className={totalCum >= 0 ? 'up' : 'down'}>{sg(totalCum)}</span> · ort{' '}
          <span className={avg >= 0 ? 'up' : 'down'}>{sg(avg)}</span> · en iyi <span className="up">{sg(best)}</span> · en kötü{' '}
          <span className="down">{sg(worst)}</span>
        </span>
        <button className="cb-csv" onClick={() => exportCsv(strategy, rows)} title="İşlemleri CSV olarak indir">
          ⤓ CSV
        </button>
      </div>
      <div className="cb-tablewrap">
        <table className="cb-table">
        <thead>
          <tr>
            <th>#</th>
            <th className="cb-sortable" onClick={() => toggle('entry')}>Giriş{arrow('entry')}</th>
            <th className="cb-r cb-sortable" onClick={() => toggle('ep')}>Fiyat{arrow('ep')}</th>
            <th className="cb-sortable" onClick={() => toggle('exit')}>Çıkış{arrow('exit')}</th>
            <th className="cb-r cb-sortable" onClick={() => toggle('xp')}>Fiyat{arrow('xp')}</th>
            <th className="cb-r cb-sortable" onClick={() => toggle('ret')}>Getiri{arrow('ret')}</th>
            <th className="cb-r" title="O işleme kadarki bileşik (birikimli) getiri — kronolojik">Birikim</th>
            <th className="cb-r cb-sortable" onClick={() => toggle('dur')}>Süre{arrow('dur')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ t, n: num, cum: cumv }) => (
            <tr key={num} onClick={() => onSelectTrade(t)} title="Grafikte göster">
              <td className="lg-muted">{num}</td>
              <td>{fmtDate(t.entryTime)}</td>
              <td className="cb-r">{fp(t.entryPrice)}</td>
              <td>{t.open ? <span className="lg-muted">açık</span> : fmtDate(t.exitTime as number)}</td>
              <td className="cb-r">{t.open ? '—' : fp(t.exitPrice)}</td>
              <td className={'cb-r ' + (t.retPct >= 0 ? 'up' : 'down')}>{sg(t.retPct)}</td>
              <td className={'cb-r ' + (cumv >= 0 ? 'up' : 'down')}>{sg(cumv)}</td>
              <td className="cb-r lg-muted">{days(t)}g</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </>
  );
}

function exportCsv(strategy: string, rows: { t: Trade; n: number; cum: number }[]) {
  const head = ['Sıra', 'Giriş Tarihi', 'Giriş Fiyatı', 'Çıkış Tarihi', 'Çıkış Fiyatı', 'Getiri %', 'Birikim %', 'Süre (gün)', 'Durum'];
  const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
  const lines = rows.map(({ t, n, cum }) =>
    [n, iso(t.entryTime), t.entryPrice, t.open ? '' : iso(t.exitTime as number), t.open ? '' : t.exitPrice, t.retPct.toFixed(2), cum.toFixed(2), days(t), t.open ? 'açık' : 'kapalı'].join(';'),
  );
  const bom = String.fromCharCode(0xfeff); // Excel'in UTF-8 algılaması için
  const csv = [head.join(';'), ...lines].join('\n');
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = strategy.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') + '_islemler.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function sg(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}
function fmtDate(t: number): string {
  return new Date(t * 1000).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function fp(v: number): string {
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

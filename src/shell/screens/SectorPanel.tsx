import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, Skeleton, Stat, trPct, trNum } from '../../ui';
import { Icon } from '../../ui/icons';
import { sectorPeers, type PeerRow, type SectorMap } from '../../core/screen/sectors';
import { dataClient } from '../../data-client/client';
import { sectorsClient } from '../../data-client/sectors';
import type { Market } from '../../data-client/markets';

interface Props {
  market: Market;
  symbol: string;
  onSelect: (symbol: string) => void;
}

const fmtValue = (v: number): string => {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) return `${trNum(v / 1e9, 1)} mlr`;
  if (v >= 1e6) return `${trNum(v / 1e6, 1)} mn`;
  if (v >= 1e3) return `${trNum(v / 1e3, 1)} b`;
  return trNum(v, 0);
};

const fmtPct = (v: number, digits = 2): string => trPct(v, digits, true);

/**
 * Sektör bağlamı — "bu hisse bugün %2 düştü" eksik bir cümledir; sektörü %3
 * düştüyse hisse aslında iyi performans göstermiştir.
 *
 * Paket (tüm sembollerin son barları, ~1 MB) yalnızca bu sekme AÇILDIĞINDA
 * iniyor. Sembol Masası'nın geri kalanı tek sembolle çalışıyor ve zayıf
 * makinede boşuna megabayt indirmemek için bu ayrım bilinçli (bkz.
 * docs/plan/performans.md).
 */
export function SectorPanel({ market, symbol, onSelect }: Props) {
  const [map, setMap] = useState<SectorMap | null>(null);
  const [rows, setRows] = useState<PeerRow[] | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  // Sembolün sektörü; haritada yoksa undefined (panel o durumda akran aramaz).
  const sector = map?.of[symbol];
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMap(null);
    setRows(null);
    setStatus('idle');
    sectorsClient.map(market).then((result) => {
      if (!cancelled) setMap(result);
    });
    return () => {
      cancelled = true;
    };
  }, [market]);

  useEffect(() => {
    if (status !== 'loading') return;
    let cancelled = false;

    (async () => {
      try {
        const bundle = await dataClient.bundle(market);
        if (cancelled) return;
        const out: PeerRow[] = [];
        // YALNIZCA aynı sektördeki semboller için seri kuruluyor. Paketin
        // tamamını Candles'a çevirmek (200 sembol × 5 tipli dizi) ana iş
        // parçacığında ölçülebilir bir blok yaratıyordu; oysa akran listesi
        // için 10–25 sembol yetiyor.
        const wanted = bundle.names.filter((name) => map!.of[name] === sector);
        for (const name of wanted) {
          const candles = bundle.seriesOf(name);
          if (!candles || candles.length < 2) continue;
          const n = candles.length;
          const close = candles.close[n - 1];
          const prev = candles.close[n - 2];
          out.push({
            symbol: name,
            value: close * candles.volume[n - 1],
            changePct: prev > 0 ? (close / prev - 1) * 100 : NaN,
          });
        }
        if (cancelled) return;
        setRows(out);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // map/sector efektin girdisi: sektör bilinmeden hangi serilerin gerektiği
    // bilinemez (zaten panel o durumda yükleme düğmesi göstermiyor).
  }, [status, market, map, sector]);

  const peers = useMemo(() => (rows ? sectorPeers(rows, map, symbol) : null), [rows, map, symbol]);

  if (!map) {
    return (
      <EmptyState
        icon={<Icon name="alert" size={28} />}
        title="Sektör sınıflandırması yok"
        description="Bu piyasa için sektör dosyası üretilmemiş; akran karşılaştırması yapılamıyor."
      />
    );
  }

  if (!sector) {
    return (
      <EmptyState
        icon={<Icon name="alert" size={28} />}
        title={`${symbol} sınıflandırılmamış`}
        description="Kaynakta bu sembolün sektörü yok. Rastgele bir grup göstermek yerine boş bırakıldı."
      />
    );
  }

  return (
    <section className="desk__sector" aria-label="Sektör bağlamı">
      <header>
        <Badge>{sector}</Badge>
        <span className="desk__muted">{map.source} sınıflandırması</span>
      </header>

      {status === 'idle' ? (
        <div className="desk__sector-cta">
          <p>
            Akranları karşılaştırmak için tüm sembollerin son barları gerekiyor (tek paket, yaklaşık
            1 MB). Sembol Masası'nın geri kalanı bu paketi indirmiyor.
          </p>
          <Button variant="primary" onClick={() => setStatus('loading')}>
            Akranları yükle
          </Button>
        </div>
      ) : null}

      {status === 'loading' ? <Skeleton count={4} height="28px" /> : null}

      {status === 'error' ? (
        <EmptyState
          tone="error"
          icon={<Icon name="alert" size={28} />}
          title="Akranlar yüklenemedi"
          description={error ?? ''}
        />
      ) : null}

      {status === 'ready' && peers ? (
        <>
          <div className="desk__sector-stats">
            <Stat
              label="Sektör içindeki sıra"
              value={`${peers.rank} / ${peers.total}`}
              hint="işlem değerine göre"
            />
            <Stat
              label="Sektör değişimi"
              value={fmtPct(peers.weightedChangePct)}
              hint="işlem değeriyle ağırlıklı"
            />
            <Stat
              label="Bu sembol"
              value={fmtPct(peers.peers.find((p) => p.symbol === symbol)?.changePct ?? NaN)}
              hint="son bar"
            />
          </div>

          <table className="desk__sector-table">
            <caption className="visually-hidden">Sektördeki semboller</caption>
            <thead>
              <tr>
                <th scope="col">Sembol</th>
                <th scope="col" className="num">
                  İşlem değeri
                </th>
                <th scope="col" className="num">
                  Değişim
                </th>
              </tr>
            </thead>
            <tbody>
              {peers.peers.map((peer) => (
                <tr key={peer.symbol} className={peer.symbol === symbol ? 'is-current' : undefined}>
                  <th scope="row">
                    <Button size="sm" variant="ghost" onClick={() => onSelect(peer.symbol)}>
                      {peer.symbol}
                    </Button>
                  </th>
                  <td className="num">{fmtValue(peer.value)}</td>
                  <td
                    className="num"
                    style={{ color: peer.changePct >= 0 ? 'var(--up)' : 'var(--down)' }}
                  >
                    {fmtPct(peer.changePct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {status === 'ready' && !peers ? (
        <p className="desk__muted">Bu sektörde pakette veri bulunan başka sembol yok.</p>
      ) : null}
    </section>
  );
}

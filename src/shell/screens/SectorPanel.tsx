import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, Select, Skeleton, Stat, trPct, trNum } from '../../ui';
import { Icon } from '../../ui/icons';
import {
  compositeSeries,
  sectorPeers,
  type PeerRow,
  type SectorMap,
} from '../../core/screen/sectors';
import { LineChart } from '../chart/LineChart';
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

/** Bar sayısı → dönem adı. Nabız ekranıyla aynı sözlük. */
const DONEM_ADI: Record<number, string> = {
  5: '1 hafta',
  21: '1 ay',
  63: '3 ay',
  250: '1 yıl',
};

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
  /**
   * Karşılaştırma penceresi (bar). Nabız ekranıyla AYNI sözlük: son bar,
   * 1 hafta, 1 ay, 3 ay. Tek barlık karşılaştırma "bugün" der; "bu hisse
   * sektörüne göre nasıl gidiyor" sorusu pencere ister.
   */
  const [donem, setDonem] = useState<number>(21);
  /** Ham kapanışlar — pencere değişince yeniden indirme olmasın diye tutuluyor. */
  const [kapanislar, setKapanislar] = useState<{
    hepsi: Float64Array[];
    kendi: Float64Array | null;
    zaman: Float64Array | null;
    bySembol: Map<string, Float64Array>;
  } | null>(null);
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
        const kapanislar: Float64Array[] = [];
        const seriBySembol = new Map<string, Float64Array>();
        let zamanlar: Float64Array | null = null;
        let kendi: Float64Array | null = null;
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
          kapanislar.push(candles.close);
          seriBySembol.set(name, candles.close);
          if (name === symbol) {
            kendi = candles.close;
            zamanlar = candles.time;
          }
        }
        if (cancelled) return;
        setRows(out);
        setKapanislar({ hepsi: kapanislar, kendi, zaman: zamanlar, bySembol: seriBySembol });
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
    // `symbol` de girdi: karşılaştırma serisi bu sembolün kapanışlarını
    // ayırıyor; sembol değişince yeniden kurulmalı.
  }, [status, market, map, sector, symbol]);

  const peers = useMemo(() => (rows ? sectorPeers(rows, map, symbol) : null), [rows, map, symbol]);

  /**
   * Karşılaştırma serileri: sembol ve sektör bileşiği, ikisi de pencerenin
   * başında %0. Ortak taban olmadan iki seri yan yana okunamaz.
   */
  const karsilastirma = useMemo(() => {
    if (!kapanislar?.kendi || !kapanislar.zaman) return null;
    const bars = Math.min(donem, kapanislar.kendi.length);
    if (bars < 2) return null;
    const from = kapanislar.kendi.length - bars;
    const taban = kapanislar.kendi[from];
    if (!(taban > 0)) return null;

    const sembolSeri: number[] = [];
    const zaman: number[] = [];
    for (let i = from; i < kapanislar.kendi.length; i++) {
      sembolSeri.push((kapanislar.kendi[i] / taban - 1) * 100);
      zaman.push(kapanislar.zaman[i]);
    }
    const sektorSeri = compositeSeries(kapanislar.hepsi, bars);
    if (sektorSeri.length !== sembolSeri.length) return null;
    return { zaman, sembol: sembolSeri, sektor: sektorSeri };
  }, [kapanislar, donem]);

  /** Akran başına pencere getirisi (%). Geçmişi kısa olan sembolde boş. */
  const donemGetirisi = useMemo(() => {
    const out = new Map<string, number>();
    if (!kapanislar) return out;
    for (const [ad, seri] of kapanislar.bySembol) {
      const n = seri.length;
      const bars = Math.min(donem, n);
      if (bars < 2) continue;
      const taban = seri[n - bars];
      if (!(taban > 0)) continue;
      out.set(ad, (seri[n - 1] / taban - 1) * 100);
    }
    return out;
  }, [kapanislar, donem]);

  /**
   * Göreli güç: sembolün pencere getirisi − sektörün pencere getirisi (puan).
   * Ekranın asıl cevabı bu: "düştü" ile "sektöründen kötü gitti" aynı şey değil.
   */
  const goreliGuc = useMemo(() => {
    if (!karsilastirma) return null;
    const a = karsilastirma.sembol[karsilastirma.sembol.length - 1];
    const b = karsilastirma.sektor[karsilastirma.sektor.length - 1];
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
  }, [karsilastirma]);

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
        {status === 'ready' ? (
          <Select
            label="Dönem"
            value={String(donem)}
            onChange={(v) => setDonem(Number(v))}
            options={[
              { value: '5', label: '1 hafta' },
              { value: '21', label: '1 ay' },
              { value: '63', label: '3 ay' },
              { value: '250', label: '1 yıl' },
            ]}
          />
        ) : null}
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
            {/*
              ASIL CEVAP. "Bu hisse %2 düştü" eksik bir cümle: sektörü %3
              düştüyse hisse aslında iyi gitmiştir. Fark PUAN olarak veriliyor
              — iki yüzdenin farkı bir yüzde değil, puandır.
            */}
            <Stat
              label="Sektöre göre"
              value={goreliGuc === null ? '—' : `${trPct(goreliGuc, 1, true)} puan`}
              hint={`${DONEM_ADI[donem] ?? `${donem} bar`} · hisse − sektör`}
            />
          </div>

          {karsilastirma ? (
            <div className="desk__sector-chart">
              <span className="fin__serie-label">
                {symbol} ve {sector} (eşit ağırlıklı) · {DONEM_ADI[donem] ?? `${donem} bar`}
              </span>
              <LineChart
                series={[
                  {
                    label: symbol,
                    color: 'var(--accent)',
                    time: karsilastirma.zaman,
                    values: karsilastirma.sembol,
                  },
                  {
                    // KISA etiket: uzun sektör adı grafiğin sağ kenarında
                    // kırpılıyordu ("Demir Çeli"). Hangi sektör olduğu
                    // grafiğin başlığında zaten yazıyor.
                    label: 'Sektör ort.',
                    color: 'var(--text-muted)',
                    time: karsilastirma.zaman,
                    values: karsilastirma.sektor,
                    dashed: true,
                  },
                ]}
                height={200}
                unit="pct"
                zeroLine
                ariaLabel={`${symbol} ve ${sector} sektör ortalamasının ${DONEM_ADI[donem] ?? ''} getirisi`}
              />
              <p className="desk__muted">
                İkisi de pencerenin başında %0. Sektör serisi EŞİT AĞIRLIKLI ("ortalama hisse ne
                yaptı"): piyasa değeri her sembol için elimizde yok ve işlem değeriyle
                ağırlıklandırmak endeksi tek bir devin hareketine indirgerdi.
              </p>
            </div>
          ) : null}

          <table className="desk__sector-table">
            <caption className="visually-hidden">Sektördeki semboller</caption>
            <thead>
              <tr>
                <th scope="col">Sembol</th>
                <th scope="col" className="num">
                  İşlem değeri
                </th>
                <th scope="col" className="num">
                  Son bar
                </th>
                <th scope="col" className="num">
                  {DONEM_ADI[donem] ?? `${donem} bar`}
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
                  {/* Dönem getirisi: seçilen pencerede bu akran ne yaptı.
                      Geçmişi kısa olan sembolde uydurulmuyor. */}
                  <td
                    className="num"
                    style={{
                      color:
                        (donemGetirisi.get(peer.symbol) ?? 0) >= 0 ? 'var(--up)' : 'var(--down)',
                    }}
                  >
                    {donemGetirisi.has(peer.symbol) ? fmtPct(donemGetirisi.get(peer.symbol)!) : '—'}
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

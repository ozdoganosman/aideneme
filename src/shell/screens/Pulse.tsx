import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Popover, Select, Skeleton, Stat, Toggle, trPct } from '../../ui';
import { flowByCluster, type PulseRow, type PulseSummary } from '../../core/screen/pulse';
import {
  flowBySector,
  sectorCoverage,
  UNCLASSIFIED,
  type SectorMap,
} from '../../core/screen/sectors';
import { encodeScreen, isShareableSector } from '../../core/screen/share';
import { DEFAULT_SCREEN_PARAMS } from '../../core/screen/metrics';
import { sectorsClient } from '../../data-client/sectors';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import { HeatMap } from '../chart/HeatMap';
import { useAnalysis } from '../useAnalysis';
import { DataError } from '../DataError';
import { LoadNote } from '../LoadNote';
import { Prov } from '../Prov';
import type { UrlState } from '../urlState';

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
}

const fmtValue = (v: number): string => {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} mlr`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} mn`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} b`;
  return v.toFixed(0);
};

const fmtPct = (v: number, digits = 1): string => trPct(v, digits, true);

/**
 * "Bu sektöre para giriyor" cümlesinin devamı "hangi hisseye?" sorusudur.
 * Sektör satırından tarayıcıya, o sektör seçili ve KURALSIZ olarak geçiliyor:
 * filtreyi kullanıcı kuracak, biz onun adına bir kural varsaymıyoruz.
 */
const screenLink = (sector: string): string =>
  encodeScreen({
    rules: [],
    params: DEFAULT_SCREEN_PARAMS,
    sectors: [sector],
    sort: { metric: 'chg21', dir: 'desc' },
  });

/** Nabız — "piyasada bugün ne oluyor?" */
export default function Pulse({ state, push }: Props) {
  const market = (MARKETS.includes(state.m as Market) ? state.m : 'bist') as Market;
  const analysis = useAnalysis(market);

  const [pulse, setPulse] = useState<{
    rows: PulseRow[];
    summary: PulseSummary;
    ms: number;
  } | null>(null);
  const [clusters, setClusters] = useState<{
    order: string[];
    clusterOf: Map<string, number>;
    count: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Nabız hesabının kendi hatası (paket indi, worker çöktü). */
  const [pulseError, setPulseError] = useState<string | null>(null);
  const [clusterOrder, setClusterOrder] = useState(true);
  const [sectors, setSectors] = useState<SectorMap | null>(null);
  const [grouping, setGrouping] = useState<'cluster' | 'sector'>('cluster');

  const clientRef = useRef(analysis.client);
  clientRef.current = analysis.client;

  useEffect(() => {
    const client = clientRef.current;
    if (analysis.status !== 'ready' || !client) return;
    let cancelled = false;
    setBusy(true);
    setPulseError(null);

    // Nabız hızlı (tek geçiş), kümeleme yavaş (~0,5 sn) — ikisini ayrı isteyip
    // ısı haritasını nabız gelir gelmez çiziyoruz, sıralama sonra oturuyor.
    client
      .pulse(market)
      .then((result) => {
        if (!cancelled) setPulse(result);
      })
      .catch((err: unknown) => {
        // Yalnızca null'a düşmek iskeleti sonsuza kadar açık bırakıyordu:
        // paket indi ama hesap çöktüyse kullanıcı yüklenmeyi bekliyor sanıyor.
        if (cancelled) return;
        setPulse(null);
        setPulseError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    client
      .correlate(market, { lookback: 120 })
      .then((result) => {
        if (cancelled) return;
        setClusters({
          order: result.order.map((i) => result.symbols[i]),
          clusterOf: new Map(result.symbols.map((s, i) => [s, result.clusterOf[i]])),
          count: result.clusters,
        });
      })
      .catch(() => {
        if (!cancelled) setClusters(null);
      });

    return () => {
      cancelled = true;
    };
  }, [analysis.status, market]);

  useEffect(() => {
    let cancelled = false;
    sectorsClient.map(market).then((map) => {
      if (cancelled) return;
      setSectors(map);
      // Sınıflandırma varsa varsayılan görünüm sektör olur: "endüstriden para
      // akışı" sorusunun doğru cevabı odur. Yoksa kümelerde kalınır.
      setGrouping(map ? 'sector' : 'cluster');
    });
    return () => {
      cancelled = true;
    };
  }, [market]);

  const flows = useMemo(() => {
    if (!pulse || !clusters) return [];
    return flowByCluster(pulse.rows, clusters.clusterOf).slice(0, 8);
  }, [pulse, clusters]);

  const sectorFlows = useMemo(() => {
    if (!pulse || !sectors) return [];
    return flowBySector(pulse.rows, sectors);
  }, [pulse, sectors]);

  const coverage = useMemo(
    () => sectorCoverage(pulse ? pulse.rows.map((r) => r.symbol) : [], sectors),
    [pulse, sectors],
  );

  const bySector = grouping === 'sector' && sectorFlows.length > 0;

  const s = pulse?.summary;

  return (
    <div className="pulse">
      <section className="pulse__bar" aria-label="Piyasa seçimi">
        <Select
          label="Piyasa"
          value={market}
          onChange={(value) => push({ m: value })}
          options={MARKETS.map((m) => ({ value: m, label: MARKET_LABEL[m] }))}
        />
        <Toggle
          label="Kümeleme sırası"
          checked={clusterOrder}
          onChange={setClusterOrder}
          // "Hesaplanıyor" yanlıştı: paket inerken henüz hesaplanacak bir şey
          // yok. Kullanıcıya beklediği şeyin ne olduğunu söylüyoruz.
          description={
            clusters
              ? `${clusters.count} küme`
              : analysis.status === 'loading'
                ? 'veri bekleniyor'
                : 'hesaplanıyor…'
          }
        />
        <div className="pulse__status">
          <LoadNote progress={analysis.progress} />
          {busy ? (
            <Badge tone="warn">Hesaplanıyor…</Badge>
          ) : pulse ? (
            <span className="desk__muted">
              {pulse.rows.length} sembol · worker {pulse.ms.toFixed(0)} ms
            </span>
          ) : null}
        </div>
      </section>

      {analysis.status === 'error' || pulseError ? (
        <DataError
          title={pulseError ? 'Piyasa özeti hesaplanamadı' : 'Piyasa verisi yüklenemedi'}
          detail={pulseError ?? analysis.error}
        />
      ) : !s ? (
        <Skeleton height="96px" />
      ) : (
        <section className="pulse__stats" aria-label="Piyasa özeti">
          <Stat
            label="Genişlik"
            value={fmtPct(s.breadthPct - 50, 1)}
            hint={`${s.advancing} yükselen · ${s.declining} düşen`}
            provenance={
              <Popover
                title="Genişlik"
                trigger={(p) => (
                  <button
                    type="button"
                    className="desk__prov"
                    aria-label="Genişlik: bu sayı nereden geliyor?"
                    {...p}
                  >
                    ?
                  </button>
                )}
              >
                Yükselenlerin yön veren semboller içindeki payı, %50'den sapma olarak. Pozitif =
                yükselenler çoğunlukta. Değişmeyen semboller hesaba girmez.
              </Popover>
            }
          />
          <Stat
            label="Para akışı"
            value={fmtPct(s.flowPct, 1)}
            hint={`${fmtValue(s.totalValue)} toplam işlem değeri`}
            provenance={
              <Popover
                title="Para akışı"
                trigger={(p) => (
                  <button
                    type="button"
                    className="desk__prov"
                    aria-label="Para akışı: bu sayı nereden geliyor?"
                    {...p}
                  >
                    ?
                  </button>
                )}
              >
                (yükselenlerin işlem değeri − düşenlerin işlem değeri) ÷ toplam. İşlem değeri =
                kapanış × hacim. Sayıca çoğunluk ile paranın yönü farklı olabilir; bu ikincisini
                ölçer.
              </Popover>
            }
          />
          <Stat
            label="Medyan değişim"
            value={fmtPct(s.medianChangePct, 2)}
            hint="ortanca sembol"
            provenance={
              <Prov label="Medyan değişim">
                Tüm sembollerin son bar değişimi sıralanıp ORTANCASI alınır. Ortalama değil: tek bir
                uç hareket ortalamayı çeker, medyanı çekmez.
              </Prov>
            }
          />
          <Stat
            label="Yeni zirve / dip"
            value={`${s.newHighs} / ${s.newLows}`}
            hint="son 250 bar içinde"
            provenance={
              <Prov label="Yeni zirve / dip">
                Son barın KAPANIŞI, son 250 barın en yüksek (en düşük) kapanışına eşit ya da ondan
                iyiyse sayılır. Bar içi uçlara değil kapanışa bakılır — gün içi bir dokunuş "yeni
                zirve" saymaz.
              </Prov>
            }
          />
        </section>
      )}

      <section className="pulse__panel" aria-label="Isı haritası">
        <header>
          <h2>Isı haritası</h2>
          <span className="desk__muted">Renk: son bar değişimi · Sıra: davranış kümeleri</span>
        </header>
        {!pulse ? (
          <Skeleton height="320px" />
        ) : (
          <HeatMap
            rows={pulse.rows}
            order={clusterOrder && clusters ? clusters.order : undefined}
            onSelect={(symbol) => push({ v: 'sembol', s: symbol })}
          />
        )}
      </section>

      <section className="pulse__panel" aria-label="Gruplara göre para akışı">
        <header>
          <h2>Para akışı — {bySector ? 'sektörler' : 'davranış grupları'}</h2>
          <span className="desk__muted">
            {bySector ? (
              <>
                {sectors?.source} sınıflandırması · {coverage.known}/{coverage.total} sembol
                eşleşti. Eşleşmeyenler "Sınıflandırılmamış" satırında; paylar toplam işlem değerinin
                tamamı üzerinden.
              </>
            ) : (
              <>
                Resmî sektör sınıflandırması değil: birlikte hareket eden hisselerin kümeleri, en
                çok işlem gören üyesiyle etiketli.
                {sectors ? '' : ' Sektör dosyası bu piyasada yok.'}
              </>
            )}
          </span>
          {sectors ? (
            <Select
              label="Gruplama"
              value={grouping}
              onChange={(value) => setGrouping(value as 'cluster' | 'sector')}
              options={[
                { value: 'sector', label: 'Sektörler' },
                { value: 'cluster', label: 'Davranış grupları' },
              ]}
            />
          ) : null}
        </header>
        {(bySector ? sectorFlows : flows).length === 0 ? (
          <Skeleton count={4} height="20px" />
        ) : (
          <table className="pulse__flows">
            <caption className="visually-hidden">Kümelere göre işlem değeri ve yön</caption>
            <thead>
              <tr>
                <th scope="col">{bySector ? 'Sektör' : 'Grup'}</th>
                <th scope="col" className="num">
                  Hisse
                </th>
                <th scope="col" className="num">
                  İşlem değeri
                </th>
                {bySector ? (
                  <th scope="col" className="num">
                    Pay
                  </th>
                ) : null}
                <th scope="col" className="num">
                  Ağırlıklı değişim
                </th>
                <th scope="col" className="num">
                  Akış
                </th>
                <th scope="col" className="num">
                  Yük./Düş.
                </th>
              </tr>
            </thead>
            <tbody>
              {(bySector
                ? sectorFlows.map((f) => ({ ...f, key: f.sector, target: f.leader }))
                : flows.map((f) => ({ ...f, key: String(f.cluster), target: f.label }))
              ).map((flow) => (
                <tr key={flow.key}>
                  <th scope="row">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={
                        !bySector
                          ? undefined
                          : flow.key === UNCLASSIFIED
                            ? `Sektörü bilinmeyen sembollerin en çok işlem göreni ${flow.target}`
                            : `${flow.key} sektörünün en çok işlem göreni ${flow.target}`
                      }
                      onClick={() => push({ v: 'sembol', s: flow.target })}
                    >
                      {bySector ? flow.key : `${flow.label} grubu`}
                    </Button>
                    {bySector && flow.key !== UNCLASSIFIED && isShareableSector(flow.key) ? (
                      <button
                        type="button"
                        className="pulse__scan"
                        aria-label={`${flow.key} sektörünü tarayıcıda aç`}
                        onClick={() => push({ v: 'tarayici', f: screenLink(flow.key) })}
                      >
                        Tara
                      </button>
                    ) : null}
                  </th>
                  <td className="num">{flow.symbols}</td>
                  <td className="num">{fmtValue(flow.value)}</td>
                  {bySector ? (
                    <td className="num">
                      {'sharePct' in flow ? trPct(flow.sharePct as number, 1) : '—'}
                    </td>
                  ) : null}
                  <td
                    className="num"
                    style={{ color: flow.weightedChangePct >= 0 ? 'var(--up)' : 'var(--down)' }}
                  >
                    {fmtPct(flow.weightedChangePct, 2)}
                  </td>
                  <td className="num">
                    {/* Çubuk SABİT genişlikte bir rayın içinde: eskiden genişliği
                        hücreye göreydi ve %70'i geçince sayı alt satıra kayıyordu,
                        satır yüksekliği değişiyordu. */}
                    <span className="pulse__flowcell">
                      <span className="pulse__flowtrack" aria-hidden="true">
                        <span
                          className="pulse__flowbar"
                          style={{
                            width: `${Math.min(100, Math.abs(flow.flowPct))}%`,
                            background: flow.flowPct >= 0 ? 'var(--up)' : 'var(--down)',
                          }}
                        />
                      </span>
                      <span className="pulse__flowval">{fmtPct(flow.flowPct, 0)}</span>
                    </span>
                  </td>
                  <td className="num">
                    {flow.advancing}/{flow.declining}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

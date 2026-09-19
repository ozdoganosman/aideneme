import { SektorEndeksleri } from './SektorEndeksleri';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Popover, Select, Skeleton, Stat, Toggle, trPct, trCompact } from '../../ui';
import {
  flowByCluster,
  type PulseRow,
  type PulseSummary,
  type WindowRow,
} from '../../core/screen/pulse';
import {
  flowBySector,
  rotationBySector,
  sectorCoverage,
  UNCLASSIFIED,
  type SectorMap,
} from '../../core/screen/sectors';
import { encodeScreen } from '../../core/screen/share';
import { DEFAULT_SCREEN_PARAMS } from '../../core/screen/metrics';
import { sectorsClient } from '../../data-client/sectors';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import { HeatMap } from '../chart/HeatMap';
import { FlowMap } from '../chart/FlowMap';
import { useAnalysis } from '../useAnalysis';
import { DataError } from '../DataError';
import { LoadNote } from '../LoadNote';
import { Announce } from '../Announce';
import { Prov } from '../Prov';
import type { UrlState } from '../urlState';

/** Bar sayısı → insan diliyle dönem adı (metinlerde kullanılıyor). */
const DONEM_ADI: Record<number, string> = {
  5: '1 hafta',
  21: '1 ay',
  63: '3 ay',
};

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
}

const fmtValue = (v: number): string => trCompact(v);

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
    /** Dönem > 1 barken: sembol başına pencere toplamları. */
    windows?: WindowRow[];
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
  // Varsayılan PARA AKIŞI (ağaç haritası). Ekranın kendi sorusu "Piyasada
  // bugün ne oluyor?" ve ona cevap veren şey paranın nerede olduğu; kümeleme
  // sırası daha özel bir analiz görünümü ve isteyenin açacağı bir seçenek.
  const [clusterOrder, setClusterOrder] = useState(false);
  const [sectors, setSectors] = useState<SectorMap | null>(null);
  const [grouping, setGrouping] = useState<'cluster' | 'sector'>('cluster');
  /**
   * Akış PENCERESİ (bar).
   *
   * 1 = son bar, yani "bugün ne oldu". Daha uzun pencerelerde soru değişiyor:
   * "para hangi sektöre KAYIYOR". Bunu pay SEVİYESİ değil pay DEĞİŞİMİ
   * söylüyor — büyük sektörün payı zaten büyüktür, bu bir rotasyon değildir.
   */
  const [donem, setDonem] = useState<number>(1);

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
      // Pencere toplamları YALNIZCA 1 barın üstünde isteniyor: tek barlık
      // nabza bakan kullanıcı 200 sembollük ikinci döngüyü ödemesin.
      .pulse(market, donem > 1 ? { rotationBars: donem } : {})
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

    return () => {
      cancelled = true;
    };
  }, [analysis.status, market, donem]);

  // Kümeleme AYRI efekt: dönem değişince yeniden hesaplanmamalı. Korelasyon
  // ~0,5 sn sürüyor ve dönemle hiç ilgisi yok — aynı efekte bırakmak her
  // dönem değişiminde bu maliyeti boşuna ödetirdi.
  useEffect(() => {
    const client = clientRef.current;
    if (analysis.status !== 'ready' || !client) return;
    let cancelled = false;
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

  /** Dönem > 1 barken: pay değişimiyle sektör rotasyonu. */
  const rotasyon = useMemo(() => {
    if (!pulse?.windows || !sectors) return [];
    return rotationBySector(pulse.windows, sectors);
  }, [pulse, sectors]);

  const coverage = useMemo(
    () => sectorCoverage(pulse ? pulse.rows.map((r) => r.symbol) : [], sectors),
    [pulse, sectors],
  );

  const bySector = grouping === 'sector' && sectorFlows.length > 0;
  /** Pencere görünümü: pay DEĞİŞİMİ (rotasyon) gösterilir. */
  const rotasyonGorunumu = bySector && donem > 1 && rotasyon.length > 0;
  /** Payı en çok artan sektör — ekranın tek cümlelik cevabı. */
  const enCokGiren = useMemo(() => {
    const aday = rotasyon
      .filter((r) => r.sector !== UNCLASSIFIED && Number.isFinite(r.shareShiftPp))
      .sort((a, b) => b.shareShiftPp - a.shareShiftPp)[0];
    return aday && aday.shareShiftPp > 0 ? aday : null;
  }, [rotasyon]);

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
        {/*
          İki yerleşim İKİ AYRI SORUYA cevap veriyor, biri ötekinin yerine
          geçmiyor:
            - Para akışı (ağaç haritası): alan işlem değeri → para nerede?
            - Kümeleme sırası (ızgara): yan yana olanlar birlikte hareket
              ediyor → hangi grup taşıyor?
          Ağaç haritası kutuları büyüklüğe göre sıraladığı için kümeleme
          sırasını koruyamıyor; anahtarı sessizce işlevsiz bırakmak yerine
          yerleşimi seçtiriyoruz.
        */}
        <Toggle
          label="Kümeleme sırası"
          checked={clusterOrder}
          onChange={setClusterOrder}
          // "Hesaplanıyor" yanlıştı: paket inerken henüz hesaplanacak bir şey
          // yok. Kullanıcıya beklediği şeyin ne olduğunu söylüyoruz.
          description={
            clusterOrder
              ? clusters
                ? `${clusters.count} küme · eşit kutu`
                : analysis.status === 'loading'
                  ? 'veri bekleniyor'
                  : 'hesaplanıyor…'
              : 'kapalı: kutu alanı işlem değeri'
          }
        />
        <div className="pulse__status">
          <Announce
            message={
              !busy && pulse && s
                ? `Piyasa nabzı hazır: ${pulse.rows.length} sembol, ${s.advancing} yükselen, ${s.declining} düşen.`
                : ''
            }
          />
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
          <span className="desk__muted">
            Renk: son bar değişimi ·{' '}
            {clusterOrder ? 'Sıra: davranış kümeleri' : 'Alan: işlem değeri'}
          </span>
        </header>
        {!pulse ? (
          <Skeleton height="320px" />
        ) : (
          <HeatMap
            rows={pulse.rows}
            order={clusterOrder && clusters ? clusters.order : undefined}
            layout={clusterOrder ? 'grid' : 'treemap'}
            onSelect={(symbol) => push({ v: 'sembol', s: symbol })}
          />
        )}
      </section>

      <section className="pulse__panel" aria-label="Gruplara göre para akışı">
        <header>
          <h2>
            {rotasyonGorunumu ? 'Sektör rotasyonu' : 'Para akışı'} —{' '}
            {bySector ? 'sektörler' : 'davranış grupları'}
          </h2>
          <span className="desk__muted">
            {bySector ? (
              <>
                {sectors?.source} sınıflandırması · {coverage.known}/{coverage.total} sembol
                eşleşti. Eşleşmeyenler "Sınıflandırılmamış" satırında; paylar toplam işlem değerinin
                tamamı üzerinden.
                {rotasyonGorunumu ? (
                  <>
                    {' '}
                    Pay değişimi, son {DONEM_ADI[donem] ?? `${donem} bar`} ile ondan ÖNCEKİ eşit
                    pencerenin karşılaştırmasıdır — seviye değil, yer değiştiren para.
                  </>
                ) : null}
              </>
            ) : (
              <>
                Resmî sektör sınıflandırması değil: birlikte hareket eden hisselerin kümeleri, en
                çok işlem gören üyesiyle etiketli.
                {sectors ? '' : ' Sektör dosyası bu piyasada yok.'}
              </>
            )}
          </span>
          {/*
            DÖNEM. "Bugün ne oldu" ile "para nereye kayıyor" iki ayrı soru;
            ikincisi pencere ister. Dönem 1 barın üstündeyken tablo pay
            DEĞİŞİMİNİ gösteriyor.
          */}
          {bySector ? (
            <Select
              label="Dönem"
              value={String(donem)}
              onChange={(v) => setDonem(Number(v))}
              options={[
                { value: '1', label: 'Son bar' },
                { value: '5', label: '1 hafta' },
                { value: '21', label: '1 ay' },
                { value: '63', label: '3 ay' },
              ]}
            />
          ) : null}
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
          <>
            {/*
              Önce ŞEKİL, sonra ayrıntı. "Hangi endüstride para var ve yönü
              ne?" iki boyutlu bir soru (büyüklük × yön) ve on satırlık bir
              liste onu tek boyuta indiriyordu. Tablo kaldırılmadı: kesin
              sayılar, "Tara" eylemi ve sıralama orada duruyor.
            */}
            {rotasyonGorunumu ? (
              <>
                {/*
                  Tek cümlelik cevap. On satırlık bir tabloda "para nereye
                  kaydı" sorusunun cevabı kaybolabiliyor; en çok pay kazanan
                  sektör üstte yazıyor.
                */}
                <p className="pulse__rotasyon">
                  {enCokGiren ? (
                    <>
                      Son {DONEM_ADI[donem] ?? `${donem} bar`} içinde para en çok{' '}
                      <b>{enCokGiren.sector}</b> sektörüne kaydı: işlem değeri payı{' '}
                      <b>{trPct(enCokGiren.shareShiftPp, 1, true)} puan</b> arttı (
                      {trPct(enCokGiren.prevSharePct, 1)} → {trPct(enCokGiren.sharePct, 1)}).
                    </>
                  ) : (
                    <>
                      Son {DONEM_ADI[donem] ?? `${donem} bar`} içinde payı artan bir sektör yok;
                      dağılım bir önceki dönemle aynı kalmış.
                    </>
                  )}
                </p>
                <FlowMap
                  label={`Sektör rotasyon haritası — kutu alanı ${DONEM_ADI[donem] ?? ''} işlem değeri, rengi dönem getirisi`}
                  items={rotasyon.map((f) => ({
                    key: f.sector,
                    value: f.value,
                    changePct: f.returnPct,
                    onSelect: () => push({ v: 'sembol', s: f.leader }),
                  }))}
                />
                <table className="pulse__flows">
                  <caption className="visually-hidden">
                    Sektörlere göre dönem işlem değeri, pay değişimi ve getiri
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Sektör</th>
                      <th scope="col" className="num">
                        Hisse
                      </th>
                      <th scope="col" className="num">
                        İşlem değeri
                      </th>
                      <th scope="col" className="num">
                        Pay
                      </th>
                      <th scope="col" className="num">
                        Pay değişimi
                      </th>
                      <th scope="col" className="num">
                        Dönem getirisi
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...rotasyon]
                      .sort((a, b) => {
                        // Sınıflandırılmamış en sonda; gerisi PAY DEĞİŞİMİNE
                        // göre — ekranın sorusu "nereye kaydı".
                        if (a.sector === UNCLASSIFIED) return 1;
                        if (b.sector === UNCLASSIFIED) return -1;
                        return b.shareShiftPp - a.shareShiftPp;
                      })
                      .map((f) => (
                        <tr key={f.sector}>
                          <th scope="row">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={
                                f.sector === UNCLASSIFIED
                                  ? `Sektörü bilinmeyen sembollerin en çok işlem göreni ${f.leader}`
                                  : `${f.sector} sektörünün en çok işlem göreni ${f.leader}`
                              }
                              onClick={() => push({ v: 'sembol', s: f.leader })}
                            >
                              {f.sector}
                            </Button>
                            {f.sector !== UNCLASSIFIED ? (
                              <button
                                type="button"
                                className="pulse__scan"
                                aria-label={`${f.sector} sektörünü tarayıcıda aç`}
                                onClick={() => push({ v: 'tarayici', f: screenLink(f.sector) })}
                              >
                                Tara
                              </button>
                            ) : null}
                          </th>
                          <td className="num">{f.symbols}</td>
                          <td className="num">{fmtValue(f.value)}</td>
                          <td className="num">{trPct(f.sharePct, 1)}</td>
                          <td
                            className="num"
                            style={{
                              color: f.shareShiftPp >= 0 ? 'var(--up)' : 'var(--down)',
                            }}
                          >
                            {Number.isFinite(f.shareShiftPp)
                              ? `${trPct(f.shareShiftPp, 1, true)} puan`
                              : '—'}
                          </td>
                          <td
                            className="num"
                            style={{ color: f.returnPct >= 0 ? 'var(--up)' : 'var(--down)' }}
                          >
                            {fmtPct(f.returnPct, 2)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            ) : (
              <>
                <FlowMap
                  label={`${bySector ? 'Sektör' : 'Grup'} para akışı haritası — kutu alanı işlem değeri, rengi ağırlıklı değişim`}
                  items={(bySector
                    ? sectorFlows.map((f) => ({ key: f.sector, target: f.leader, ...f }))
                    : flows.map((f) => ({ key: `${f.label} grubu`, target: f.label, ...f }))
                  ).map((f) => ({
                    key: f.key,
                    value: f.value,
                    changePct: f.weightedChangePct,
                    onSelect: () => push({ v: 'sembol', s: f.target }),
                  }))}
                />
                <table className="pulse__flows">
                  {/*
                    Başlık hücresi zaten "Sektör"/"Grup" diye değişiyordu ama
                    `caption` değişmiyordu: sektör görünümünde ekran okuyucu
                    tabloyu "Kümelere göre" diye duyuruyordu. İki farklı soru
                    ve gören kullanıcı farkı sütun başlığından anlıyor;
                    duyanın tek ipucu bu satır.
                  */}
                  <caption className="visually-hidden">
                    {bySector
                      ? 'Sektörlere göre işlem değeri ve yön'
                      : 'Davranış gruplarına göre işlem değeri ve yön'}
                  </caption>
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
                          {bySector && flow.key !== UNCLASSIFIED ? (
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
                          style={{
                            color: flow.weightedChangePct >= 0 ? 'var(--up)' : 'var(--down)',
                          }}
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
              </>
            )}
          </>
        )}
      </section>

      {/*
        SEKTÖR ENDEKSLERİ — yukarıdaki "para akışı" panelinden AYRI.

        Üstteki panel sınıflandırma dosyası varsa sektör akışını, yoksa davranış
        kümelerini gösteriyor. Bu panel üçüncü bir kaynak: BIST'in kendi alt
        sektör endeksleri. Sınıflandırma dosyasına İHTİYAÇ DUYMUYOR, yani
        kaynak erişilemezken de "hangi sektör kazandırdı" sorusu cevaplanıyor.
        Ayrı panel, çünkü ölçtüğü şey farklı: getiri, akış değil.
      */}
      <SektorEndeksleri
        market={market}
        client={analysis.status === 'ready' ? analysis.client : null}
        onSelect={(symbol) => push({ v: 'sembol', s: symbol })}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Combobox, EmptyState, NumberField, Select, Skeleton, Stat } from '../../ui';
import { Icon } from '../../ui/icons';
import type { ModelCard } from '../../core/ml/model';
import { dataClient } from '../../data-client/client';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import { useAnalysis } from '../useAnalysis';
import { DataError } from '../DataError';
import { Prov } from '../Prov';
import type { UrlState } from '../urlState';

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
}

const pct = (v: number, digits = 1): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—';
const num = (v: number, digits = 3): string => (Number.isFinite(v) ? v.toFixed(digits) : '—');
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const day = (d: number) =>
  Number.isFinite(d) ? new Date(d * 86400_000).toISOString().slice(0, 10) : '—';

const VERDICT_TONE: Record<ModelCard['verdict'], 'up' | 'warn' | 'down'> = {
  kullanılabilir: 'up',
  zayıf: 'warn',
  kullanma: 'down',
};

/**
 * Model — "bu tahmin gerçekten bilgi taşıyor mu?"
 *
 * Ekranın sözleşmesi tek cümlede: **model kartı olmadan olasılık gösterilmez.**
 * Kart "kullanma" diyorsa tahmin hiç hesaplanmaz; kullanıcı sayıyı görmeden
 * önce neyin ölçüldüğünü, neye karşı ölçüldüğünü ve nerede kırıldığını okur.
 */
export default function ModelScreen({ state, push }: Props) {
  const market = (MARKETS.includes(state.m as Market) ? state.m : 'bist') as Market;
  const analysis = useAnalysis(market, { bundle: false });
  const symbol = state.s || analysis.symbols[0] || '';

  const [horizon, setHorizon] = useState(10);
  const [mult, setMult] = useState(1.5);
  const [scope, setScope] = useState<'symbol' | 'pool'>('symbol');
  const [poolCount, setPoolCount] = useState(15);
  const [plan, setPlan] = useState<{ symbols: string[]; bytes: number } | null>(null);
  const [pool, setPool] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [poolInfo, setPoolInfo] = useState<{
    used: string[];
    skipped: { symbol: string; reason: string }[];
  } | null>(null);
  const [result, setResult] = useState<{
    card: ModelCard;
    latest: { day: number; probability: number } | null;
    ms: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef(analysis.client);
  clientRef.current = analysis.client;

  // Havuz kapsamı: ne indirileceği ÖNCE hesaplanır, eğitim kullanıcı
  // başlatınca koşar (derin taramayla aynı sözleşme).
  useEffect(() => {
    const client = clientRef.current;
    if (scope !== 'pool' || !client || analysis.status !== 'ready') return;
    let cancelled = false;
    setResult(null);
    setPoolInfo(null);
    setError(null);

    (async () => {
      try {
        const manifest = await dataClient.manifest(market);
        if (cancelled) return;
        const symbols = Object.keys(manifest.symbols)
          .sort((a, b) => (manifest.symbols[b]?.n ?? 0) - (manifest.symbols[a]?.n ?? 0))
          .slice(0, poolCount);
        const bytes = symbols.reduce((sum, s) => sum + (manifest.symbols[s]?.b ?? 0), 0);
        setPlan({ symbols, bytes });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scope, market, poolCount, analysis.status]);

  useEffect(() => {
    const client = clientRef.current;
    if (scope !== 'symbol' || !symbol || !client || analysis.status !== 'ready') return;
    let cancelled = false;
    setBusy(true);
    setError(null);

    (async () => {
      try {
        const { candles } = await dataClient.series(market, symbol);
        const outcome = await client.model(candles, {
          symbol,
          barriers: { horizon, upMult: mult, downMult: mult, volLength: 20 },
          folds: 5,
          embargoDays: Math.ceil(horizon * 1.4),
        });
        if (!cancelled) setResult(outcome);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [market, symbol, scope, analysis.status, horizon, mult]);

  /** Havuz eğitimi: seriler indirilir, sonra tek worker isteğinde eğitilir. */
  async function runPool() {
    const client = clientRef.current;
    if (!client || !plan) return;
    setResult(null);
    setError(null);
    setPool({ done: 0, total: plan.symbols.length });

    try {
      const series: {
        symbol: string;
        candles: Awaited<ReturnType<typeof dataClient.series>>['candles'];
      }[] = [];
      for (const next of plan.symbols) {
        const { candles } = await dataClient.series(market, next);
        series.push({ symbol: next, candles });
        setPool({ done: series.length, total: plan.symbols.length });
      }
      const outcome = await client.pooledModel(series, {
        barriers: { horizon, upMult: mult, downMult: mult, volLength: 20 },
        folds: 5,
        embargoDays: Math.ceil(horizon * 1.4),
      });
      setResult({ card: outcome.card, latest: null, ms: outcome.ms });
      setPoolInfo({ used: outcome.used, skipped: outcome.skipped });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPool(null);
    }
  }

  const card = result?.card ?? null;

  if (error) {
    return (
      <EmptyState
        tone="error"
        icon={<Icon name="alert" size={28} />}
        title="Model kurulamadı"
        description={error}
      />
    );
  }

  return (
    <div className="model">
      <section className="model__controls" aria-label="Model ayarları">
        <Select
          label="Piyasa"
          value={market}
          onChange={(value) => push({ m: value, s: '' })}
          options={MARKETS.map((m) => ({ value: m, label: MARKET_LABEL[m] }))}
        />
        <Select
          label="Kapsam"
          value={scope}
          onChange={(value) => {
            setScope(value as 'symbol' | 'pool');
            setResult(null);
            setPlan(null);
          }}
          options={[
            { value: 'symbol', label: 'Tek sembol' },
            { value: 'pool', label: 'Havuz (kesitsel)' },
          ]}
        />
        {scope === 'pool' ? (
          <NumberField
            label="Sembol sayısı"
            value={poolCount}
            min={3}
            max={60}
            step={1}
            onChange={setPoolCount}
            hint="en uzun geçmişe sahip semboller"
          />
        ) : null}
        {scope === 'symbol' ? (
          <Combobox
            label="Sembol"
            value={symbol}
            onChange={(value) => push({ s: value })}
            options={analysis.symbols.map((s) => ({ value: s, label: s }))}
            placeholder={symbol || 'Sembol ara…'}
          />
        ) : null}
        <NumberField
          label="Ufuk (bar)"
          value={horizon}
          onChange={setHorizon}
          min={3}
          max={60}
          step={1}
        />
        <NumberField
          label="Bariyer × oynaklık"
          value={mult}
          onChange={setMult}
          min={0.5}
          max={4}
          step={0.5}
        />
        <span className="desk__muted">
          Etiket: üçlü bariyer · Doğrulama: purged 5-fold + {Math.ceil(horizon * 1.4)} takvim günü
          embargo
        </span>
      </section>

      {scope === 'pool' ? (
        <section className="rank__deep" aria-label="Havuz eğitimi">
          {pool ? (
            <>
              <p>
                {pool.done} / {pool.total} sembol indirildi
                {pool.done === pool.total ? ' · eğitim koşuyor…' : ''}
              </p>
              <progress value={pool.done} max={pool.total} />
            </>
          ) : plan ? (
            <>
              <p>
                {plan.symbols.length} sembol · <strong>{mb(plan.bytes)}</strong> indirilecek. Havuz
                örnek sayısını artırır ama semboller bağımsız olmadığı için bağımsız bilgiyi aynı
                oranda artırmaz.
              </p>
              <Button variant="primary" onClick={runPool}>
                Havuzu eğit
              </Button>
            </>
          ) : (
            <p className="desk__muted">İndirme boyutu hesaplanıyor…</p>
          )}
        </section>
      ) : null}

      {analysis.status === 'error' ? (
        <DataError title="Model verisi yüklenemedi" detail={analysis.error} />
      ) : busy || !card ? (
        // Havuzda kullanıcı eğitimi başlatana kadar iskelet göstermenin anlamı
        // yok: bekleyen bir iş yok, karar kullanıcıda.
        scope === 'pool' && !pool ? null : (
          <Skeleton count={5} height="64px" />
        )
      ) : (
        <>
          <section className="model__verdict" aria-label="Hüküm">
            <Badge tone={VERDICT_TONE[card.verdict]}>Hüküm: {card.verdict}</Badge>
            <p className="model__lead">
              {card.verdict === 'kullanma'
                ? 'Bu model taban oranını yenemiyor. Tahmin üretilmedi — gösterilecek bir olasılık yok.'
                : card.verdict === 'zayıf'
                  ? 'Ayrım var ama zayıf. Olasılık tek başına karar dayanağı değil; getiri ayrımına ve kalibrasyona bakın.'
                  : 'Ayrım ve kalibrasyon taban modeli yeniyor. Yine de tek sembol, tek dönem ölçümüdür.'}
            </p>
            {card.verdict !== 'kullanma' && result?.latest ? (
              <div className="model__latest">
                <Stat
                  label={`${symbol} · ${day(result.latest.day)} sonrası ${card.barriers.horizon} bar`}
                  value={pct(result.latest.probability, 0)}
                  hint={`üst bariyere (+${card.barriers.upMult}σ) önce değme olasılığı`}
                />
              </div>
            ) : null}
          </section>

          <section className="model__grid" aria-label="Ölçümler">
            <Stat
              label="AUC (ayrım)"
              value={num(card.metrics.auc)}
              hint={`taban ${card.baseline.auc.toFixed(2)} · 0.5 = yazı tura`}
              provenance={
                <Prov label="AUC (ayrım)">
                  Rastgele bir POZİTİF örneğe, rastgele bir negatiften daha yüksek olasılık verme
                  oranı (Mann–Whitney U). 0,5 yazı tura demek; eşitlikler yarım sayılır. KATMANLAR
                  DIŞI tahminlerle hesaplanır — modelin görmediği veride.
                </Prov>
              }
            />
            <Stat
              label="Brier"
              value={num(card.metrics.brier)}
              hint={`taban ${num(card.baseline.brier)} · küçük iyi`}
              provenance={
                <Prov label="Brier">
                  (olasılık − gerçek)² ortalaması. Hem ayrımı hem KALİBRASYONU cezalandırır: doğru
                  sıralayan ama abartan bir model burada kaybeder. Küçük iyi.
                </Prov>
              }
            />
            <Stat
              label="Brier becerisi"
              value={num(card.brierSkill)}
              hint="≤ 0 ise taban oran daha iyi"
              provenance={
                <Prov label="Brier becerisi">
                  1 − (model Brier ÷ taban Brier). Taban = her zaman eğitim kümesinin pozitif
                  oranını söyleyen model. Sıfırın altıysa model taban orandan KÖTÜ — hüküm
                  "kullanma" olur.
                </Prov>
              }
            />
            <Stat
              label="Kalibrasyon hatası"
              value={pct(card.metrics.ece)}
              hint="ortalama |söylenen − olan|"
              provenance={
                <Prov label="Kalibrasyon hatası">
                  Beklenen kalibrasyon hatası (ECE): olasılıklar kovalara bölünür, her kovada
                  |söylenen − olan| farkı kovanın örnek sayısıyla ağırlıklanır. Aşağıdaki
                  kalibrasyon tablosunun tek sayıya indirilmiş hali.
                </Prov>
              }
            />
            <Stat
              label="Doğruluk"
              value={pct(card.metrics.accuracy, 0)}
              hint={`taban ${pct(card.baseline.accuracy, 0)} · dengesiz sınıfta yanıltıcı`}
              provenance={
                <Prov label="Doğruluk">
                  Olasılık 0,5 üstündeyse "olur" sayılıp gerçekle karşılaştırılır. DENGESİZ sınıfta
                  yanıltıcıdır: %80'i pozitif olan veride hep "olur" demek %80 doğruluk verir ve
                  hiçbir şey öğrenmemiştir. Taban satırı bu yüzden yanında duruyor.
                </Prov>
              }
            />
            <Stat
              label="Örnek"
              value={String(card.samples)}
              hint={`pozitif %${(card.positiveRate * 100).toFixed(0)} · ${card.folds} katman`}
              provenance={
                <Prov label="Örnek">
                  Üçlü bariyer etiketlemesinden çıkan, tüm özellikleri tam olan bar sayısı.
                  Katmanlara takvim gününe göre bölünür; test penceresiyle örtüşen eğitim örnekleri
                  atılır (purge) ve arada embargo bırakılır.
                </Prov>
              }
            />
          </section>

          <section className="model__panel" aria-label="Kalibrasyon">
            <header className="model__header">
              <h3>Kalibrasyon</h3>
              <span className="desk__muted">
                Model %70 diyorsa gerçekten 100 vakanın ~70'i olmalı. İki çubuk aynı boyda değilse
                olasılık olduğu gibi okunamaz.
              </span>
            </header>
            <table className="model__table">
              <thead>
                <tr>
                  <th scope="col">Olasılık kovası</th>
                  <th scope="col" className="num">
                    Vaka
                  </th>
                  <th scope="col" className="num">
                    Söylenen
                  </th>
                  <th scope="col" className="num">
                    Gerçekleşen
                  </th>
                  <th scope="col">Söylenen ▮ / olan ▮</th>
                </tr>
              </thead>
              <tbody>
                {card.calibration.map((bin) => (
                  <tr key={bin.from}>
                    <th scope="row">
                      %{(bin.from * 100).toFixed(0)} – %{(bin.to * 100).toFixed(0)}
                    </th>
                    <td className="num">{bin.count}</td>
                    <td className="num">{bin.count > 0 ? pct(bin.predicted, 0) : '—'}</td>
                    <td className="num">{bin.count > 0 ? pct(bin.observed, 0) : '—'}</td>
                    <td>
                      {/* İki çubuk: söylenen ve olan. Eşit uzunlukta değilse
                          olasılık olduğu gibi okunamaz — sayıya bakmadan görülür. */}
                      {bin.count > 0 ? (
                        <span className="model__bars" aria-hidden="true">
                          <span
                            className="model__bar model__bar--said"
                            style={{ width: `${Math.round(bin.predicted * 100)}%` }}
                          />
                          <span
                            className="model__bar model__bar--was"
                            style={{ width: `${Math.round(bin.observed * 100)}%` }}
                          />
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="model__panel" aria-label="Getiri ayrımı">
            <header className="model__header">
              <h3>Getiri ayrımı</h3>
              <span className="desk__muted">
                Olasılık ≥ %{(card.edge.threshold * 100).toFixed(0)} olan barlarda ortalama getiri,
                tüm barların ortalamasıyla karşılaştırılır. Maliyet dahil değildir.
              </span>
            </header>
            <div className="model__grid">
              <Stat
                label="Sinyal"
                value={String(card.edge.signals)}
                hint="eşiği geçen bar"
                provenance={
                  <Prov label="Sinyal">
                    Katmanlar dışı olasılığı eşiği geçen bar sayısı. Bir İŞLEM sayısı değil: art
                    arda gelen barlar ayrı ayrı sayılır, aynı hareketi birkaç kez gösterebilir.
                  </Prov>
                }
              />
              <Stat
                label="Sinyal ortalaması"
                value={
                  Number.isFinite(card.edge.meanRetPct)
                    ? `${card.edge.meanRetPct.toFixed(2)}%`
                    : '—'
                }
                hint="etiket penceresi getirisi"
                provenance={
                  <Prov label="Sinyal ortalaması">
                    Sinyal barlarında, etiket ufku kadar ileriye bakan getirinin ortalaması. MALİYET
                    DAHİL DEĞİL ve kesişen pencereler bağımsız değil — bir strateji sonucu olarak
                    okunamaz.
                  </Prov>
                }
              />
              <Stat
                label="Tüm barlar"
                value={
                  Number.isFinite(card.edge.allMeanRetPct)
                    ? `${card.edge.allMeanRetPct.toFixed(2)}%`
                    : '—'
                }
                hint="karşılaştırma tabanı"
                provenance={
                  <Prov label="Tüm barlar">
                    Aynı hesabın SİNYAL FİLTRESİ OLMADAN hali: bütün barların ortalama ufuk
                    getirisi. Sinyal ortalaması bunun belirgin üstünde değilse model bir şey
                    eklemiyor demektir.
                  </Prov>
                }
              />
            </div>
          </section>

          <section className="model__panel" aria-label="Özellikler">
            <header className="model__header">
              <h3>Özellikler</h3>
              <span className="desk__muted">
                Katsayılar standartlaştırılmış ölçekte, katmanların ortalaması. İşareti katmanlar
                arasında değişen bir özellik güvenilir değildir.
              </span>
            </header>
            <table className="model__table">
              <thead>
                <tr>
                  <th scope="col">Özellik</th>
                  <th scope="col">Ne soruyor</th>
                  <th scope="col" className="num">
                    Katsayı
                  </th>
                  <th scope="col">Kararlı mı</th>
                </tr>
              </thead>
              <tbody>
                {card.features.map((feature) => (
                  <tr key={feature.key}>
                    <th scope="row">{feature.label}</th>
                    <td className="desk__muted">{feature.detail}</td>
                    <td className="num">{num(feature.weight)}</td>
                    <td>{feature.stable ? 'evet' : 'hayır'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="model__panel" aria-label="Model kartı">
            <header className="model__header">
              <h3>Model kartı</h3>
              <span className="desk__muted">
                {day(card.firstDay)} – {day(card.lastDay)} · sızıntı temizliğinde {card.purged}{' '}
                örnek atıldı · {result?.ms ?? 0} ms
              </span>
            </header>
            <ul className="model__list">
              {card.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
              {poolInfo && poolInfo.skipped.length > 0 ? (
                <li>
                  Havuza alınmayanlar:{' '}
                  {poolInfo.skipped.map((s) => `${s.symbol} (${s.reason})`).join(', ')}
                </li>
              ) : null}
            </ul>
            <p className="desk__muted">
              Yöntem: üçlü bariyer etiketleme (ufuk {card.barriers.horizon} bar, bariyerler ±
              {card.barriers.upMult}σ), L2 cezalı lojistik regresyon, purged {card.folds}-fold +{' '}
              {card.embargoDays} bar embargo, Platt kalibrasyonu yalnızca eğitim katmanından
              öğrenildi. Tüm ölçümler katman dışı tahminlerden.
            </p>
            <Button onClick={() => push({ v: 'laboratuvar', s: symbol })}>
              Bu sembolü laboratuvarda kural tabanlı test et
            </Button>
          </section>
        </>
      )}
    </div>
  );
}

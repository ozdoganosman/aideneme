import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Combobox, EmptyState, NumberField, Select, Skeleton, Stat } from '../../ui';
import { Icon } from '../../ui/icons';
import type { ModelCard } from '../../core/ml/model';
import { dataClient } from '../../data-client/client';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import { useAnalysis } from '../useAnalysis';
import type { UrlState } from '../urlState';

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
}

const pct = (v: number, digits = 1): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—';
const num = (v: number, digits = 3): string => (Number.isFinite(v) ? v.toFixed(digits) : '—');
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
  const [result, setResult] = useState<{
    card: ModelCard;
    latest: { day: number; probability: number } | null;
    ms: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef(analysis.client);
  clientRef.current = analysis.client;

  useEffect(() => {
    const client = clientRef.current;
    if (!symbol || !client || analysis.status !== 'ready') return;
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
          embargoBars: horizon,
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
  }, [market, symbol, analysis.status, horizon, mult]);

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
        <Combobox
          label="Sembol"
          value={symbol}
          onChange={(value) => push({ s: value })}
          options={analysis.symbols.map((s) => ({ value: s, label: s }))}
          placeholder={symbol || 'Sembol ara…'}
        />
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
          Etiket: üçlü bariyer · Doğrulama: purged 5-fold + {horizon} bar embargo
        </span>
      </section>

      {busy || !card ? (
        <Skeleton count={5} height="64px" />
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
            />
            <Stat
              label="Brier"
              value={num(card.metrics.brier)}
              hint={`taban ${num(card.baseline.brier)} · küçük iyi`}
            />
            <Stat
              label="Brier becerisi"
              value={num(card.brierSkill)}
              hint="≤ 0 ise taban oran daha iyi"
            />
            <Stat
              label="Kalibrasyon hatası"
              value={pct(card.metrics.ece)}
              hint="ortalama |söylenen − olan|"
            />
            <Stat
              label="Doğruluk"
              value={pct(card.metrics.accuracy, 0)}
              hint={`taban ${pct(card.baseline.accuracy, 0)} · dengesiz sınıfta yanıltıcı`}
            />
            <Stat
              label="Örnek"
              value={String(card.samples)}
              hint={`pozitif %${(card.positiveRate * 100).toFixed(0)} · ${card.folds} katman`}
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
              <Stat label="Sinyal" value={String(card.edge.signals)} hint="eşiği geçen bar" />
              <Stat
                label="Sinyal ortalaması"
                value={
                  Number.isFinite(card.edge.meanRetPct)
                    ? `${card.edge.meanRetPct.toFixed(2)}%`
                    : '—'
                }
                hint="etiket penceresi getirisi"
              />
              <Stat
                label="Tüm barlar"
                value={
                  Number.isFinite(card.edge.allMeanRetPct)
                    ? `${card.edge.allMeanRetPct.toFixed(2)}%`
                    : '—'
                }
                hint="karşılaştırma tabanı"
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
            </ul>
            <p className="desk__muted">
              Yöntem: üçlü bariyer etiketleme (ufuk {card.barriers.horizon} bar, bariyerler ±
              {card.barriers.upMult}σ), L2 cezalı lojistik regresyon, purged {card.folds}-fold +{' '}
              {card.embargoBars} bar embargo, Platt kalibrasyonu yalnızca eğitim katmanından
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  NumberField,
  Popover,
  Select,
  Skeleton,
  VirtualTable,
  type Column,
} from '../../ui';
import { Icon } from '../../ui/icons';
import {
  DEFAULT_SCREEN_PARAMS,
  METRIC_DEFS,
  applyScreen,
  type MetricDef,
  type Operator,
  type Rule,
  type ScreenParams,
  type ScreenRow,
} from '../../core/screen/metrics';
import { FUNDAMENTAL_METRIC_DEFS, withFundamentals } from '../../core/screen/fundamentalMetrics';
import { sectorNames, withSectors, type SectorMap } from '../../core/screen/sectors';
import {
  decodeScreen,
  encodeScreen,
  exportScreens,
  importScreens,
  type SavedScreen,
} from '../../core/screen/share';
import { sectorsClient } from '../../data-client/sectors';
import type { FundamentalsSnapshot } from '../../core/fundamentals/types';
import { fundamentalsClient } from '../../data-client/fundamentals';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import { useAnalysis } from '../useAnalysis';
import { CopyLink } from '../CopyLink';
import type { UrlState } from '../urlState';

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
  /** Filtre değişiminde geçmişi kirletmemek için (her tuşa basış bir girdi olmasın). */
  replace?: (patch: UrlState) => void;
}

const OP_LABEL: Record<Operator, string> = {
  gt: '>',
  lt: '<',
  between: 'arası',
};

const DEFAULT_RULES: Rule[] = [
  { metric: 'rsi', op: 'between', a: 40, b: 70 },
  { metric: 'chg21', op: 'gt', a: 0 },
];

const SAVED_KEY = 'screener.saved';

/** Teknik + temel metrikler tek listede: filtre motoru ikisini ayırt etmiyor. */
const ALL_METRIC_DEFS: MetricDef[] = [...METRIC_DEFS, ...FUNDAMENTAL_METRIC_DEFS];
const METRIC_BY_ID = new Map(ALL_METRIC_DEFS.map((d) => [d.id, d]));

function loadSaved(): SavedScreen[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedScreen[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fmtValue(id: string, v: number): string {
  if (!Number.isFinite(v)) return '—';
  const def = METRIC_BY_ID.get(id);
  if (def?.unit === 'pct') return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
  if (def?.unit === 'ratio') return `${v.toFixed(2)}×`;
  if (def?.unit === 'price')
    return v.toLocaleString('tr-TR', { maximumFractionDigits: def.decimals ?? 2 });
  return v.toFixed(1);
}

/** Tarayıcı — kural tabanlı filtre, parametreler canlı, hesap worker havuzunda. */
export default function ScreenerScreen({ state, push, replace }: Props) {
  const market = (MARKETS.includes(state.m as Market) ? state.m : 'bist') as Market;
  const analysis = useAnalysis(market);

  // Bağlantıdan gelen filtre (varsa) ilk durumu belirler; ürün ilkesi #4.
  const shared = useMemo(() => {
    const known = new Set(ALL_METRIC_DEFS.map((d) => d.id));
    return decodeScreen(state.f ?? '', known);
    // Yalnızca ilk okumada: sonraki URL yazımları kendi yaptığımız yazımlar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [params, setParams] = useState<ScreenParams>(shared.state?.params ?? DEFAULT_SCREEN_PARAMS);
  const [rules, setRules] = useState<Rule[]>(shared.state?.rules ?? DEFAULT_RULES);
  const [rows, setRows] = useState<ScreenRow[]>([]);
  const [timing, setTiming] = useState<{ ms: number; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({
    key: shared.state?.sort.metric ?? 'chg21',
    dir: shared.state?.sort.dir ?? 'desc',
  });
  const [saved, setSaved] = useState<SavedScreen[]>(loadSaved);
  const [snapshot, setSnapshot] = useState<FundamentalsSnapshot | null>(null);
  const [snapshotChecked, setSnapshotChecked] = useState(false);
  const [transfer, setTransfer] = useState<'closed' | 'export' | 'import'>('closed');
  const [transferText, setTransferText] = useState('');
  const [transferNote, setTransferNote] = useState<string[]>([]);
  const [sectors, setSectors] = useState<SectorMap | null>(null);
  const [pickedSectors, setPickedSectors] = useState<string[]>(shared.state?.sectors ?? []);

  // Temel veri (finansal tablo anlık görüntüsü) — yoksa ekran teknik metriklerle
  // çalışmaya devam eder, boş sayı uydurmaz.
  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setSnapshotChecked(false);
    fundamentalsClient
      .snapshot(market)
      .then((result) => {
        if (cancelled) return;
        setSnapshot(result);
        setSnapshotChecked(true);
      })
      .catch(() => {
        if (!cancelled) setSnapshotChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [market]);

  // Sektör sınıflandırması — yoksa sektör filtresi hiç görünmez.
  const firstSectorLoad = useRef(true);
  useEffect(() => {
    let cancelled = false;
    setSectors(null);
    // Piyasa değişince seçim anlamını yitirir (sektör listeleri farklı), ama
    // İLK yüklemede bağlantıdan gelen seçim korunur.
    if (!firstSectorLoad.current) setPickedSectors([]);
    firstSectorLoad.current = false;
    sectorsClient.map(market).then((map) => {
      if (!cancelled) setSectors(map);
    });
    return () => {
      cancelled = true;
    };
  }, [market]);

  // İstemci REFERANSI efekt bağımlılığı değil: kimliği beklenmedik biçimde
  // değişirse (ör. hook yeniden yazılırsa) tarama döngüye girerdi.
  const clientRef = useRef(analysis.client);
  clientRef.current = analysis.client;

  // Parametre değişince yeniden tara. Metrikler worker'da hesaplanır; filtre
  // ve sıralama ana iş parçacığında (ucuz) — böylece kural değiştirmek anında.
  useEffect(() => {
    const client = clientRef.current;
    if (analysis.status !== 'ready' || !client) return;
    let cancelled = false;
    setBusy(true);
    client
      .screen(market, params)
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTiming({ ms: result.ms, count: result.rows.length });
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysis.status, market, params]);

  // Filtre değişince URL'i güncelle — replace ile, çünkü her tuşa basış bir
  // geçmiş girdisi olsaydı geri tuşu kullanılamaz hale gelirdi.
  const encoded = useMemo(
    () =>
      encodeScreen({
        rules,
        params,
        sectors: pickedSectors,
        sort: { metric: sort.key, dir: sort.dir },
      }),
    [rules, params, pickedSectors, sort],
  );
  useEffect(() => {
    if (!replace || encoded === state.f) return;
    replace({ f: encoded });
    // state.f bağımlılık değil: kendi yazdığımızı geri okuyup döngü kurmayalım.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoded, replace]);

  /** Teknik satırlara temel metrikleri ekle (fiyat teknik satırdan gelir). */
  const enriched = useMemo(() => {
    const withFin = snapshot ? withFundamentals(rows, { snapshot }) : rows;
    return withSectors(withFin, sectors);
  }, [rows, snapshot, sectors]);

  const filtered = useMemo(
    () =>
      applyScreen(enriched, {
        rules,
        sort: { metric: sort.key, dir: sort.dir },
        minBars: 30,
        sectors: pickedSectors,
      }),
    [enriched, rules, sort, pickedSectors],
  );

  const columns: Column<ScreenRow>[] = useMemo(() => {
    const technical = ['last', 'chg1', 'chg21', 'rsi', 'adx', 'volRatio', 'fromHigh'];
    // Temel veri varsa çarpanlar da sütun olarak gelir.
    const fundamental = snapshot ? ['pe', 'pb', 'roe', 'netMargin'] : [];
    const shown: string[] = [...technical, ...fundamental];
    return [
      {
        key: 'symbol',
        header: 'Sembol',
        width: '110px',
        render: (r) => r.symbol,
        sortValue: (r) => r.symbol,
      },
      // Sektör sütunu yalnızca sınıflandırma varsa; bilinmeyen "—" olarak
      // görünür, boş hücre "sektörsüz" izlenimi vermesin.
      ...(sectors
        ? [
            {
              key: 'sector',
              header: 'Sektör',
              width: '150px',
              render: (r: ScreenRow) => r.sector ?? '—',
              sortValue: (r: ScreenRow) => r.sector ?? 'zzz',
            } as Column<ScreenRow>,
          ]
        : []),
      ...shown.map<Column<ScreenRow>>((id) => ({
        key: id,
        header: METRIC_BY_ID.get(id)?.label ?? id,
        numeric: true,
        render: (r) => fmtValue(id, r.values[id]),
        sortValue: (r) => r.values[id],
      })),
    ];
  }, [snapshot, sectors]);

  const updateRule = useCallback((index: number, patch: Partial<Rule>) => {
    setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }, []);

  function applyImport() {
    const known = new Set(ALL_METRIC_DEFS.map((d) => d.id));
    const { screens, dropped } = importScreens(transferText, known);
    if (screens.length > 0) {
      // Aynı adlı kayıt ÜZERİNE YAZILMAZ: kullanıcının mevcut kitaplığını
      // sessizce değiştirmek yerine gelen kayıtlar ekleniyor.
      const existing = new Set(saved.map((s) => s.name));
      const merged = [
        ...saved,
        ...screens.map((s) => ({
          ...s,
          name: existing.has(s.name) ? `${s.name} (içe aktarılan)` : s.name,
        })),
      ];
      setSaved(merged);
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(merged));
      } catch {
        /* depolama yoksa kayıt atlanır */
      }
    }
    setTransferNote([
      screens.length > 0 ? `${screens.length} tarama eklendi.` : 'Hiçbir tarama alınamadı.',
      ...dropped,
    ]);
  }

  function saveCurrent() {
    const name = `Tarama ${saved.length + 1}`;
    const next = [...saved, { name, rules, params, sectors: pickedSectors }];
    setSaved(next);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* depolama yoksa kayıt atlanır, tarama çalışmaya devam eder */
    }
  }

  if (analysis.status === 'error') {
    return (
      <EmptyState
        tone="error"
        icon={<Icon name="alert" size={28} />}
        title="Tarama verisi yüklenemedi"
        description={
          <>
            {analysis.error} — paket <code>scripts/pack_data.py</code> ile CI'da üretiliyor.
          </>
        }
      />
    );
  }

  return (
    <div className="screener">
      <section className="screener__panel" aria-label="Tarama kuralları">
        <div className="screener__row">
          <Select
            label="Piyasa"
            value={market}
            onChange={(value) => push({ m: value })}
            options={MARKETS.map((m) => ({ value: m, label: MARKET_LABEL[m] }))}
          />
          <NumberField
            label="RSI uzunluk"
            value={params.rsiLength}
            min={2}
            max={100}
            onChange={(v) => setParams((p) => ({ ...p, rsiLength: v }))}
          />
          <NumberField
            label="ADX uzunluk"
            value={params.adxLength}
            min={2}
            max={100}
            onChange={(v) => setParams((p) => ({ ...p, adxLength: v }))}
          />
          <NumberField
            label="EMA hızlı"
            value={params.emaFast}
            min={2}
            max={200}
            onChange={(v) => setParams((p) => ({ ...p, emaFast: v }))}
          />
          <NumberField
            label="EMA yavaş"
            value={params.emaSlow}
            min={3}
            max={250}
            onChange={(v) => setParams((p) => ({ ...p, emaSlow: v }))}
          />
        </div>

        {shared.dropped.length > 0 ? (
          <p className="lab__warn" role="status">
            Bağlantıdaki filtrenin bir kısmı uygulanamadı: {shared.dropped.join(', ')}. Görünen
            sonuçlar paylaşılan taramadan farklı olabilir.
          </p>
        ) : null}

        {sectors ? (
          <fieldset className="screener__sectors">
            <legend>
              Sektör{' '}
              <span className="desk__muted">
                {pickedSectors.length === 0
                  ? 'hepsi'
                  : `${pickedSectors.length} seçili · sektörü bilinmeyen semboller elenir`}
              </span>
            </legend>
            <div className="screener__chips">
              {sectorNames(sectors).map((name) => {
                const on = pickedSectors.includes(name);
                return (
                  <label key={name} className={`screener__chip${on ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setPickedSectors((prev) =>
                          prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name],
                        )
                      }
                    />
                    {name}
                  </label>
                );
              })}
              {pickedSectors.length > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => setPickedSectors([])}>
                  Temizle
                </Button>
              ) : null}
            </div>
          </fieldset>
        ) : null}

        <div className="screener__rules">
          {rules.map((rule, i) => (
            <div className="screener__rule" key={`${rule.metric}-${i}`}>
              <Select
                label="Metrik"
                value={rule.metric}
                onChange={(value) => updateRule(i, { metric: value })}
                options={ALL_METRIC_DEFS.map((d) => ({ value: d.id, label: d.label }))}
              />
              <Select
                label="Koşul"
                value={rule.op}
                onChange={(value) => updateRule(i, { op: value as Operator })}
                options={(['gt', 'lt', 'between'] as Operator[]).map((op) => ({
                  value: op,
                  label: OP_LABEL[op],
                }))}
              />
              <NumberField
                label="Değer"
                value={rule.a}
                step={0.5}
                onChange={(v) => updateRule(i, { a: v })}
              />
              {rule.op === 'between' ? (
                <NumberField
                  label="Üst"
                  value={rule.b ?? rule.a}
                  step={0.5}
                  onChange={(v) => updateRule(i, { b: v })}
                />
              ) : null}
              <Popover
                title={METRIC_BY_ID.get(rule.metric)?.label}
                trigger={(p) => (
                  <button
                    type="button"
                    className="desk__prov screener__prov"
                    aria-label={`${METRIC_BY_ID.get(rule.metric)?.label ?? rule.metric}: bu metrik nasıl hesaplanıyor?`}
                    {...p}
                  >
                    ?
                  </button>
                )}
              >
                {METRIC_BY_ID.get(rule.metric)?.formula(params)}
              </Popover>
              <IconButton
                label={`${i + 1}. kuralı kaldır (${METRIC_BY_ID.get(rule.metric)?.label ?? rule.metric})`}
                onClick={() => setRules((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <Icon name="close" size={14} />
              </IconButton>
            </div>
          ))}

          <div className="screener__actions">
            <Button
              size="sm"
              onClick={() => setRules((prev) => [...prev, { metric: 'adx', op: 'gt', a: 20 }])}
            >
              + Kural
            </Button>
            <Button size="sm" onClick={() => setRules(DEFAULT_RULES)}>
              Sıfırla
            </Button>
            <Button size="sm" onClick={saveCurrent}>
              Taramayı kaydet
            </Button>
            <CopyLink label="Filtreyi paylaş" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setTransferText(exportScreens(saved));
                setTransferNote([]);
                setTransfer('export');
              }}
              disabled={saved.length === 0}
            >
              Koleksiyonu dışa aktar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setTransferText('');
                setTransferNote([]);
                setTransfer('import');
              }}
            >
              Koleksiyonu içe aktar
            </Button>
            <Button
              size="sm"
              onClick={() =>
                push({
                  v: 'stratejiler',
                  // Sembol listesi URL'e sığsın diye ilk 60 ile sınırlı; sıra
                  // tablonun sırasıdır (kullanıcının gördüğü sıra).
                  sy: filtered
                    .slice(0, 60)
                    .map((r) => r.symbol)
                    .join(','),
                })
              }
              disabled={filtered.length === 0}
            >
              Stratejilerde test et ({Math.min(filtered.length, 60)})
            </Button>
            {saved.map((s) => (
              <Button
                key={s.name}
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRules(s.rules);
                  // Eski kayıtlarda parametre alanları eksik olabilir; varsayılanla
                  // birleştiriliyor ki yarım bir nesne ekrana sızmasın.
                  setParams({ ...DEFAULT_SCREEN_PARAMS, ...s.params });
                  // Eski kayıtlarda sektör alanı yok: o zaman filtre temizlenir,
                  // kaydedilmemiş bir seçim geri yüklenmiş gibi görünmesin.
                  setPickedSectors(s.sectors ?? []);
                }}
              >
                {s.name}
              </Button>
            ))}
          </div>
        </div>
      </section>

      <div className="screener__status">
        {analysis.status === 'loading' ? (
          <Skeleton width="220px" height="16px" />
        ) : (
          <>
            <Badge tone={busy ? 'warn' : 'up'}>
              {busy ? 'Hesaplanıyor…' : `${filtered.length} / ${rows.length} sembol`}
            </Badge>
            {timing ? (
              <span className="desk__muted">
                {timing.count} sembol × {analysis.bars} bar · worker {timing.ms.toFixed(0)} ms ·{' '}
                {analysis.client?.size ?? 1} iş parçacığı
              </span>
            ) : null}
            {snapshot ? (
              <Badge tone="accent" title={snapshot.note}>
                Temel veri: {Object.keys(snapshot.symbols).length} sembol
              </Badge>
            ) : snapshotChecked ? (
              <span className="desk__muted">
                Temel veri yok — çarpan filtreleri için <code>scripts/build_fundamentals.py</code>{' '}
                CI'da çalışmalı.
              </span>
            ) : null}
          </>
        )}
      </div>

      <Dialog
        open={transfer !== 'closed'}
        onClose={() => setTransfer('closed')}
        title={transfer === 'export' ? 'Koleksiyonu dışa aktar' : 'Koleksiyonu içe aktar'}
        description={
          transfer === 'export'
            ? 'Metni kopyalayıp başka bir cihazda içe aktarın. Kayıtlar yalnızca tarayıcıda saklanır; sunucuya gönderilmez.'
            : 'Dışa aktarılmış metni yapıştırın. Tanınmayan metrik ya da bozuk kayıt sessizce alınmaz; gerekçesi yazılır.'
        }
        footer={
          transfer === 'import' ? (
            <Button variant="primary" onClick={applyImport}>
              İçe aktar
            </Button>
          ) : null
        }
      >
        <label className="ui-field__label" htmlFor="screener-transfer">
          Koleksiyon metni
        </label>
        <textarea
          id="screener-transfer"
          className="ui-input screener__transfer"
          rows={10}
          value={transferText}
          readOnly={transfer === 'export'}
          onChange={(e) => setTransferText(e.target.value)}
        />
        {transferNote.length > 0 ? (
          <ul className="screener__transfer-note" role="status">
            {transferNote.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </Dialog>

      {analysis.status === 'loading' ? (
        <Skeleton height="320px" />
      ) : (
        <div className="screener__results">
          <VirtualTable
            rows={filtered}
            columns={columns}
            rowKey={(r) => r.symbol}
            label="Tarama sonuçları"
            sort={sort}
            onSortChange={setSort}
            height="100%"
            onRowClick={(r) => push({ v: 'sembol', s: r.symbol })}
            empty={
              <EmptyState
                title="Kriterlere uyan sembol yok"
                description="Kuralları gevşetmeyi veya parametreleri değiştirmeyi dene."
                action={
                  <Button size="sm" onClick={() => setRules([])}>
                    Kuralları temizle
                  </Button>
                }
              />
            }
          />
        </div>
      )}
    </div>
  );
}

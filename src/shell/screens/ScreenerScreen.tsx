import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trDay } from '../../core/format/date';
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
  trPct,
  trNum,
  trCompact,
} from '../../ui';
import { Icon } from '../../ui/icons';
import {
  DEFAULT_SCREEN_PARAMS,
  METRIC_DEFS,
  applyScreen,
  olculemeyen,
  metricsWithoutData,
  type MetricDef,
  type Operator,
  type Rule,
  type ScreenParams,
  type ScreenRow,
} from '../../core/screen/metrics';
import { FUNDAMENTAL_METRIC_DEFS, withFundamentals } from '../../core/screen/fundamentalMetrics';
import type { Financials } from '../../core/fundamentals/types';
import { sectorNames, withSectors, type SectorMap } from '../../core/screen/sectors';
import {
  decodeScreen,
  encodeScreen,
  exportScreens,
  importScreens,
  type SavedScreen,
} from '../../core/screen/share';
import {
  diffScreen,
  readSnapshots,
  snapshotKey,
  type ScreenDiff,
  type ScreenSnapshot,
} from '../../core/screen/watch';
import { sectorsClient } from '../../data-client/sectors';
import { dataClient } from '../../data-client/client';
import type { FundamentalsSnapshot } from '../../core/fundamentals/types';
import { fundamentalsClient } from '../../data-client/fundamentals';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import { useAnalysis } from '../useAnalysis';
import { LoadNote } from '../LoadNote';
import { Announce } from '../Announce';
import { DataError } from '../DataError';
import { CopyLink } from '../CopyLink';
import { Sparkline } from '../../ui/Sparkline';
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
const SNAPSHOT_KEY = 'screener.snapshots.v1';

/** Teknik + temel metrikler tek listede: filtre motoru ikisini ayırt etmiyor. */
const ALL_METRIC_DEFS: MetricDef[] = [...METRIC_DEFS, ...FUNDAMENTAL_METRIC_DEFS];

/**
 * Dönem DİZİSİ isteyen metrikler.
 *
 * Anlık görüntü yalnızca son TTM değerlerini taşıyor; büyüme ve karne ise
 * geçen yılın aynı dönemini ve önceki yıl sonu bilançosunu ister. Tarama
 * ekranı bu diziyi hiç yüklemiyordu: aşağıdaki altı metrik HER eşikte sıfır
 * sonuç veriyordu — filtre ekranda duruyor, verisi hiç gelmiyordu. (Aynı
 * sınıftan bir kusur "Cari oran"da bir kez daha görülmüştü.)
 *
 * Tam tablo dosyası 3,1 MB; bu yüzden ancak bu metriklerden biri kural ya da
 * sıralama olarak KULLANILDIĞINDA indiriliyor.
 */
const TABLO_ISTEYEN = new Set([
  'quality',
  'karneKarlilik',
  'karneBuyume',
  'karneBorc',
  'revenueGrowth',
  'netIncomeGrowth',
]);
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

function loadSnapshots(): Record<string, ScreenSnapshot> {
  try {
    return readSnapshots(localStorage.getItem(SNAPSHOT_KEY));
  } catch {
    return {};
  }
}

const fmtDay = trDay;

/**
 * Sütun başlığı; penceresi araç çubuğunda görünmeyen metrikte pencereyi de
 * yazar ("Zirveden (250 bar)"). Aynı adı taşıyan ama başka bir pencereye
 * bakan Sembol Masası metriğiyle karışmasın diye.
 */
function headerFor(id: string, params: ScreenParams): string {
  const def = METRIC_BY_ID.get(id);
  if (!def) return id;
  return def.windowLabel ? `${def.label} (${def.windowLabel(params)})` : def.label;
}

function fmtValue(id: string, v: number): string {
  if (!Number.isFinite(v)) return '—';
  const def = METRIC_BY_ID.get(id);
  if (def?.unit === 'pct') return trPct(v, 2, true);
  if (def?.unit === 'ratio') return `${trNum(v, 2)}×`;
  if (def?.unit === 'price') return trNum(v, def.decimals ?? 2);
  if (def?.unit === 'money') return trCompact(v);
  return trNum(v, 1);
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
  /** Tarama hesabının kendi hatası (paket indi ama worker çöktü). */
  const [screenError, setScreenError] = useState<string | null>(null);
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
  const [snaps, setSnaps] = useState<Record<string, ScreenSnapshot>>(loadSnapshots);
  /** Ekranda açık olan kayıtlı taramanın adı — fark yalnızca onun için sorulur. */
  const [activeSaved, setActiveSaved] = useState<string | null>(null);
  /** Veri paketinin kimliği: fark ancak paket DEĞİŞTİYSE anlamlı. */
  const [dataId, setDataId] = useState<{ id: string; generated: number } | null>(null);
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

  /**
   * Tam tablolar — YALNIZCA gerektiğinde.
   *
   * Kullanılmayan bir metrik için 3,1 MB indirmek, ekranın tamamının ilk
   * yük bütçesinden büyük olurdu. Kural ya da sıralama bu metriklerden birine
   * dokunduğu anda iniyor ve tarayıcıda önbelleğe giriyor.
   */
  const tabloGerekli = useMemo(
    () => rules.some((r) => TABLO_ISTEYEN.has(r.metric)) || TABLO_ISTEYEN.has(sort.key),
    [rules, sort.key],
  );
  const [tablolar, setTablolar] = useState<Map<string, Financials> | null>(null);
  const [tabloDurumu, setTabloDurumu] = useState<'yok' | 'yukleniyor' | 'hazir' | 'hata'>('yok');

  useEffect(() => {
    setTablolar(null);
    setTabloDurumu('yok');
  }, [market]);

  useEffect(() => {
    if (!tabloGerekli || tablolar) return;
    let cancelled = false;
    setTabloDurumu('yukleniyor');
    fundamentalsClient
      .allFinancials(market)
      .then((m) => {
        if (cancelled) return;
        setTablolar(m);
        // `null` da bir cevaptır: dosya yayımlanmamış. Sessizce "sonuç yok"
        // demek yerine ekran bunu söylüyor.
        setTabloDurumu(m ? 'hazir' : 'hata');
      })
      .catch(() => {
        if (!cancelled) setTabloDurumu('hata');
      });
    return () => {
      cancelled = true;
    };
  }, [tabloGerekli, tablolar, market]);

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

  // Paket kimliği manifest'ten: baytlar değişmediyse "yeni sonuç" yoktur.
  useEffect(() => {
    let cancelled = false;
    setDataId(null);
    dataClient
      .manifest(market)
      .then((m) => {
        if (cancelled) return;
        setDataId({ id: m.bundle?.hash ?? String(m.generated), generated: m.generated });
      })
      .catch(() => {
        /* manifest okunamazsa fark gösterilmez; uydurulmaz */
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
    setScreenError(null);
    client
      .screen(market, params)
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTiming({ ms: result.ms, count: result.rows.length });
      })
      .catch((err: unknown) => {
        // Boş satır listesi ekranda "kriterlere uyan sembol yok" diye
        // görünüyordu: hesap ÇÖKTÜĞÜNDE kullanıcı filtresini gevşetmeye
        // çalışırdı. Hata artık hata olarak görünüyor.
        if (cancelled) return;
        setRows([]);
        setScreenError(err instanceof Error ? err.message : String(err));
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
    const withFin = snapshot
      ? withFundamentals(rows, {
          snapshot,
          financialsOf: tablolar ? (symbol) => tablolar.get(symbol) : undefined,
        })
      : rows;
    return withSectors(withFin, sectors);
  }, [rows, snapshot, sectors, tablolar]);

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

  /**
   * Kurallara UYMADIĞI için değil, ÖLÇÜLEMEDİĞİ için elenenler.
   *
   * "582 sembolden 10 tanesi ölçütlere uyuyor" cümlesi 572 sembolün sınandığını
   * ima ediyor. Oysa NaN hiçbir kuralı geçmiyor: ölçüsü olmayan sembol de
   * "uymadı" kovasına düşüyor. Gerçek veride ölçüldü — 582 hissenin yalnızca
   * 293'ünün F/K'sı var (zarar edende F/K tanımsız, 23 sembolde tablo hiç
   * yok). Yani bir F/K kuralı evrenin yarısını sessizce eliyordu.
   */
  const olculemedi = useMemo(() => olculemeyen(enriched, rules), [enriched, rules]);

  // Veri boşluğu mu, kullanıcının eşiği mi? İkisi aynı ekranla anlatılıyordu.
  // Ölçüldü: yayındaki 559 sembolün TAMAMINDA `currentAssets` ve
  // `operatingCashFlow` boş — yani "Cari oran" filtresi hangi eşikle kurulursa
  // kurulsun sıfır sonuç veriyor ve arayüz "kuralları gevşet" diyor.
  // Gevşetmek işe yaramayacak; söylenmesi gereken şey veri olmadığı.
  const dataless = useMemo(
    () => metricsWithoutData(enriched, rules).map((id) => METRIC_BY_ID.get(id)?.label ?? id),
    [enriched, rules],
  );

  /** Sonuç hazır mı — hazır olmadan anlık görüntü alınmaz, fark gösterilmez. */
  const settled = analysis.status === 'ready' && !busy && timing !== null;

  /**
   * Her KAYITLI taramanın bugünkü sonucu ve işaretli halinden farkı.
   *
   * Fark, ekranda düzenlenen kurallara değil KAYDIN TANIMINA bakar: "Tarama
   * 1'e bugün ne girdi" sorusunun cevabı, kullanıcının o sırada ekranda ne
   * denediğinden bağımsız olmalı. Hesap ucuz (filtre ana iş parçacığında,
   * birkaç yüz satır) ve yalnızca sonuç oturduğunda yapılıyor.
   */
  const savedDiffs = useMemo(() => {
    const out: Record<string, { diff: ScreenDiff; shot: ScreenSnapshot }> = {};
    if (!dataId || !settled) return out;
    for (const item of saved) {
      const itemParams = { ...DEFAULT_SCREEN_PARAMS, ...item.params };
      const itemSectors = item.sectors ?? [];
      // KİMLİK sıralamayı içermez: sıralama hangi sembolün eşleştiğini
      // değiştirmez, yalnızca satır sırasını.
      const shot: ScreenSnapshot = {
        name: item.name,
        market,
        code: encodeScreen({
          rules: item.rules,
          params: itemParams,
          sectors: itemSectors,
          sort: { metric: 'chg21', dir: 'desc' },
        }),
        data: dataId.id,
        generated: dataId.generated,
        symbols: applyScreen(enriched, {
          rules: item.rules,
          sort: { metric: 'chg21', dir: 'desc' },
          minBars: 30,
          sectors: itemSectors,
        })
          .map((r) => r.symbol)
          .sort((a, b) => a.localeCompare(b, 'tr')),
      };
      out[item.name] = {
        shot,
        diff: diffScreen(snaps[snapshotKey(market, item.name)] ?? null, shot),
      };
    }
    return out;
  }, [saved, enriched, snaps, dataId, settled, market]);

  const diff = activeSaved ? (savedDiffs[activeSaved]?.diff ?? null) : null;

  function markSnapshot(name: string) {
    const entry = savedDiffs[name];
    if (!entry) return;
    const next = { ...snaps, [snapshotKey(market, name)]: entry.shot };
    setSnaps(next);
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));
    } catch {
      /* depolama yoksa fark takibi çalışmaz, tarama çalışmaya devam eder */
    }
  }

  const columns: Column<ScreenRow>[] = useMemo(() => {
    // İşlem değeri varsayılan sütun: likidite, sonucun UYGULANABİLİR olup
    // olmadığını söyleyen tek sayı. Hacim oranı bunun yerine geçmiyor —
    // o göreli, bu mutlak.
    const technical = ['last', 'turnover', 'chg1', 'chg21', 'rsi', 'adx', 'volRatio', 'fromHigh'];
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
      // Sembolün hemen yanında şekil. 14 sütun sayıya bakıp "bu hisse nasıl
      // hareket ediyor" sorusunu cevaplamak için tek tek tıklamak
      // gerekiyordu; sayı kesindir ama şekil BİR BAKIŞTA okunur.
      // Sıralama değeri dönem değişimi: sütun tıklanabilir olmalı, yoksa
      // "en çok yükselen şekli" bulmanın yolu yok.
      {
        key: 'spark',
        header: '1 yıl',
        width: '104px',
        render: (r: ScreenRow) => (
          <Sparkline points={r.spark} label={`${r.symbol} 1 yıllık seyir`} />
        ),
        sortValue: (r: ScreenRow) =>
          r.spark && r.spark.length > 1 ? r.spark[r.spark.length - 1] / r.spark[0] - 1 : NaN,
      } as Column<ScreenRow>,
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
        header: headerFor(id, params),
        numeric: true,
        render: (r) => fmtValue(id, r.values[id]),
        sortValue: (r) => r.values[id],
      })),
    ];
  }, [snapshot, sectors, params]);

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
    // Kaydın açılışı, bir sonraki ziyarette "ne değişti" sorusunun başlangıç
    // noktasıdır: şimdiki sonuç anlık görüntü olarak saklanıyor.
    setActiveSaved(name);
    if (dataId && settled) {
      const shot: ScreenSnapshot = {
        name,
        market,
        code: encodeScreen({
          rules,
          params,
          sectors: pickedSectors,
          sort: { metric: 'chg21', dir: 'desc' },
        }),
        data: dataId.id,
        generated: dataId.generated,
        symbols: filtered.map((r) => r.symbol).sort((a, b) => a.localeCompare(b, 'tr')),
      };
      const merged = { ...snaps, [snapshotKey(market, name)]: shot };
      setSnaps(merged);
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(merged));
      } catch {
        /* depolama yoksa fark takibi çalışmaz */
      }
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
            {saved.map((s) => {
              const d = savedDiffs[s.name]?.diff;
              const moved = d?.status === 'degisti' ? d.entered.length + d.exited.length : 0;
              return (
                <Button
                  key={s.name}
                  size="sm"
                  variant="ghost"
                  aria-label={
                    moved > 0
                      ? `${s.name}: ${d!.entered.length} giren, ${d!.exited.length} çıkan`
                      : undefined
                  }
                  onClick={() => {
                    setRules(s.rules);
                    // Eski kayıtlarda parametre alanları eksik olabilir; varsayılanla
                    // birleştiriliyor ki yarım bir nesne ekrana sızmasın.
                    setParams({ ...DEFAULT_SCREEN_PARAMS, ...s.params });
                    // Eski kayıtlarda sektör alanı yok: o zaman filtre temizlenir,
                    // kaydedilmemiş bir seçim geri yüklenmiş gibi görünmesin.
                    setPickedSectors(s.sectors ?? []);
                    setActiveSaved(s.name);
                  }}
                >
                  {s.name}
                  {moved > 0 ? (
                    <>
                      {' '}
                      <Badge tone={d!.entered.length >= d!.exited.length ? 'up' : 'down'}>
                        +{d!.entered.length} / −{d!.exited.length}
                      </Badge>
                    </>
                  ) : null}
                </Button>
              );
            })}
          </div>
        </div>
      </section>

      {diff && activeSaved ? (
        <div className="screener__watch" role="status" aria-label="Kayıtlı tarama farkı">
          <b>{activeSaved}</b>
          {diff.status === 'ilk-bakis' ? (
            <span className="desk__muted">
              karşılaştırılacak önceki sonuç yok — şimdiki durumu işaretlersen bir sonraki veride ne
              değiştiğini gösteririz.
            </span>
          ) : null}
          {diff.status === 'ayni-veri' ? (
            <span className="desk__muted">
              veri paketi {fmtDay(diff.since!)} tarihinden beri değişmedi — yeni sonuç yok.
            </span>
          ) : null}
          {diff.status === 'kural-degisti' ? (
            <span className="desk__muted">
              kurallar işaretlenen halinden farklı; çıkan fark piyasadan değil bu değişiklikten
              gelirdi.
            </span>
          ) : null}
          {diff.status === 'degisti' ? (
            <>
              <span className="desk__muted">{fmtDay(diff.since!)} işaretinden bu yana</span>
              <Badge tone="up">{diff.entered.length} giren</Badge>
              <Badge tone="down">{diff.exited.length} çıkan</Badge>
              <span className="desk__muted">{diff.stayed} kalan</span>
              {diff.entered.length + diff.exited.length > 0 ? (
                <ul>
                  {diff.entered.map((symbol) => (
                    <li key={`in-${symbol}`}>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${symbol} taramaya girdi, sembol masasında aç`}
                        onClick={() => push({ v: 'sembol', s: symbol })}
                      >
                        +{symbol}
                      </Button>
                    </li>
                  ))}
                  {diff.exited.map((symbol) => (
                    <li key={`out-${symbol}`}>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${symbol} taramadan çıktı, sembol masasında aç`}
                        onClick={() => push({ v: 'sembol', s: symbol })}
                      >
                        −{symbol}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="desk__muted">liste aynı kaldı.</span>
              )}
            </>
          ) : null}
          {diff.entered.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => push({ v: 'stratejiler', sy: diff.entered.slice(0, 60).join(',') })}
            >
              Girenleri stratejilerde test et ({Math.min(diff.entered.length, 60)})
            </Button>
          ) : null}
          {diff.status !== 'ayni-veri' ? (
            <Button size="sm" variant="secondary" onClick={() => markSnapshot(activeSaved)}>
              {diff.status === 'degisti' ? 'Yeni durumu işaretle' : 'Şimdiki durumu işaretle'}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="screener__status">
        <Announce
          message={
            settled
              ? `Tarama tamamlandı: ${rows.length} sembolden ${filtered.length} tanesi ölçütlere uyuyor.`
              : ''
          }
        />
        <LoadNote progress={analysis.progress} />
        {analysis.status === 'loading' ? (
          <Skeleton width="220px" height="16px" />
        ) : (
          <>
            <Badge tone={busy ? 'warn' : 'up'}>
              {busy ? 'Hesaplanıyor…' : `${filtered.length} / ${rows.length} sembol`}
            </Badge>
            {!busy && olculemedi.count > 0 ? (
              <span className="screener__olculemedi desk__muted">
                {olculemedi.count} sembol ölçülemedi (
                {olculemedi.byMetric
                  .map(
                    (m) => `${METRIC_BY_ID.get(m.metric)?.label ?? m.metric}: ${trNum(m.count, 0)}`,
                  )
                  .join(', ')}
                ) — kuralı geçemedikleri için değil, o ölçü onlarda olmadığı için elendiler.
              </span>
            ) : null}
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

      {screenError ? (
        <DataError title="Tarama hesaplanamadı" detail={screenError} />
      ) : analysis.status === 'loading' ? (
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
              // Sektör seçiliyken harita henüz inmediyse sonuç ZORUNLU olarak
              // boştur; "kriterlere uyan yok" demek yanıltıcı olurdu.
              pickedSectors.length > 0 && !sectors ? (
                <EmptyState
                  title="Sektör sınıflandırması yükleniyor"
                  description="Seçili sektör filtresi, sınıflandırma dosyası indikten sonra uygulanacak."
                />
              ) : /*
                   Tablo dosyası inmediyse sebep BU: "kaynak bu kalemi
                   yayımlamıyor" demek yanlış olurdu (yayımlıyor, dosya
                   gelmedi) ve kullanıcıyı kuralı kaldırmaya iterdi. Bu
                   yüzden veri-yok mesajının ÖNÜNE geçiyor.
                 */
              tabloGerekli && tabloDurumu !== 'hazir' ? (
                <EmptyState
                  title={
                    tabloDurumu === 'yukleniyor'
                      ? 'Finansal tablolar yükleniyor'
                      : 'Finansal tablolar yüklenemedi'
                  }
                  description={
                    tabloDurumu === 'yukleniyor'
                      ? 'Büyüme ve karne ölçütleri tüm sembollerin dönem tablolarını ister; dosya iniyor. Sonuçlar birkaç saniye içinde gelecek.'
                      : "Büyüme ve karne ölçütleri hesaplanamıyor: tablo dosyası (fundamentals/hepsi.json) yayımlanmamış olabilir. Kaynak CI'da scripts/build_fundamentals.py ile üretiliyor. Bu kuralları kaldırırsanız teknik ölçütler çalışmaya devam eder."
                  }
                  action={
                    <Button size="sm" onClick={() => setRules([])}>
                      Kuralları temizle
                    </Button>
                  }
                />
              ) : dataless.length > 0 ? (
                <EmptyState
                  title={`Veri yok: ${dataless.join(', ')}`}
                  description={`Bu ${
                    dataless.length > 1 ? 'metriklerin' : 'metriğin'
                  } hiçbir sembolde değeri yok, bu yüzden eşik ne olursa olsun sonuç boş kalır. Kaynak bu kalemi yayımlamıyor — kuralı gevşetmek işe yaramaz, kaldırmak gerekir.`}
                  action={
                    <Button size="sm" onClick={() => setRules([])}>
                      Kuralları temizle
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="Kriterlere uyan sembol yok"
                  description="Kuralları gevşetmeyi veya parametreleri değiştirmeyi dene."
                  action={
                    <Button size="sm" onClick={() => setRules([])}>
                      Kuralları temizle
                    </Button>
                  }
                />
              )
            }
          />
        </div>
      )}
    </div>
  );
}

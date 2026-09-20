import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { DEFAULT_PARAMS, type IndBundle, type IndicatorParams } from '../../core/indicators/calc';
import { useChartColors } from '../chart/useThemeColors';
import { useAnalysis } from '../useAnalysis';
import { DataError } from '../DataError';
import { Announce } from '../Announce';
import {
  Button,
  Combobox,
  EmptyState,
  Popover,
  Select,
  Skeleton,
  Stat,
  Tabs,
  Toggle,
  trPct,
  trNum,
} from '../../ui';
import { Icon } from '../../ui/icons';
import type { HealthReport } from '../../core/data/health';
import { DAY_SECONDS } from '../../core/data/pack';
import type { TF } from '../../core/data/resample';
import type { Candles } from '../../core/data/types';
import type { Metric } from '../../core/stats/summary';
import { dataClient } from '../../data-client/client';
import { MARKETS, MARKET_LABEL, type Market } from '../../data-client/markets';
import type { UrlState } from '../urlState';
import { tercihOku, tercihYaz } from '../tercih';
import { IndikatorPaneli, yeniOrnekId, type IndikatorOrnegi } from '../chart/IndikatorPaneli';
import { INDIKATOR_ILE, parametreSinirla } from '../../core/indicators/kayit';
import type { CikisTanimi } from '../../core/indicators/kayit';
import {
  kullaniciGostergeleriOku,
  kullaniciMi,
  type KullaniciGostergesi,
} from '../chart/kullaniciGosterge';
import { gostergeCalistirUzak } from '../chart/gostergeIstemci';

/*
  Görünüm deposu BİLEŞEN AĞACININ DIŞINDA.

  Masa başka bir ekrana geçince söküldüğü için ref'te tutulan görünüm de
  gidiyordu (ölçüldü: Nabız/Tarayıcı/Portföy'e gidip dönünce 45 barlık
  görünüm 119 bara düşüyordu). Depo küçük bir modülde: grafik chunk'ını
  çekmiyor, uygulama içi her gezinmede yaşıyor.
*/
import { grafikGorunumDeposu } from '../chart/gorunumDeposu';

/** Grafik ayrı chunk'ta: lightweight-charts ilk yük bütçesine girmesin. */
const LazyPriceChart = lazy(() =>
  import('../chart/PriceChart').then((m) => ({ default: m.PriceChart })),
);

/** Finansal panel de ayrı chunk: grafiğe gelen kullanıcı bunu indirmesin. */
const LazyFinancials = lazy(() =>
  import('./FinancialsPanel').then((m) => ({ default: m.FinancialsPanel })),
);

/** Sektör paneli de ayrı chunk; paketi yalnızca o sekme isterse indirir. */
const LazySector = lazy(() => import('./SectorPanel').then((m) => ({ default: m.SectorPanel })));

/** Radar da ayrı chunk: açılmadıkça ne kodu ne de piyasa paketi iniyor. */
const LazyRadar = lazy(() => import('./Radar').then((m) => ({ default: m.Radar })));

/**
 * Grafik ekranının kalıcı tercihleri.
 *
 * Kullanıcı isteği: "son pozisyonumuz grafikte ve indikatör tercihlerimiz
 * kayıtlı kalsın". Piyasa/sembol/periyot URL'de de duruyor (paylaşılabilirlik
 * için) — burada saklanan, ADRES ÇIPLAKKEN nereden devam edileceği. URL bir
 * sembol taşıyorsa o kazanır; paylaşılan bir bağlantı başka birinin son
 * baktığı hisseye açılmamalı.
 */
const MASA_ANAHTARI = 'masa.v1';
const RADAR_ANAHTARI = 'radar.genislik.v1';

interface MasaTercihi {
  m?: string;
  s?: string;
  tf?: string;
  enabled?: Record<string, boolean>;
  panels?: Record<string, boolean>;
  indParams?: IndicatorParams;
  showVolume?: boolean;
  radar?: boolean;
  /** Kayıt defterinden eklenen gösterge örnekleri. */
  indikatorler?: IndikatorOrnegi[];
}

/**
 * ESKİ DURUMU TAŞI.
 *
 * Sabit sistemde iki fiyat EMA'sı anahtarla açılıp kapanıyor, iki panel de
 * ayrı anahtarla geliyordu; parametreler ortak bir yapıdaydı. Kayıtlı bir
 * kullanıcı için bunlar KAYIT DEFTERİ örneklerine çevriliyor — açık olan açık,
 * kapalı olan kapalı, parametreler neyse o.
 *
 * Kaydı olmayan kullanıcı da aynı yoldan geçiyor: varsayılanlar eski
 * varsayılanlarla birebir aynı (EMA 50 açık, EMA 200 kapalı, paneller kapalı).
 */
function eskidenTasi(kayit: MasaTercihi): IndikatorOrnegi[] {
  const p = { ...DEFAULT_PARAMS, ...(kayit.indParams ?? {}) };
  const acik = kayit.enabled ?? { ema50: true, ema200: false };
  const panel = kayit.panels ?? { wr: false, macd: false };
  const yap = (
    id: string,
    parametreler: Record<string, number>,
    gorunur: boolean,
  ): IndikatorOrnegi => ({ ornekId: yeniOrnekId(), id, parametreler, gorunur });

  return [
    yap('ema', { uzunluk: 50 }, !!acik.ema50),
    yap('ema', { uzunluk: 200 }, !!acik.ema200),
    yap('wr', { uzunluk: p.wr, emaYavas: p.wrEmaA, emaHizli: p.wrEmaB }, !!panel.wr),
    yap(
      'macdNizami',
      { hizli: p.macdFast, yavas: p.macdSlow, sinyal: p.macdSig, vwma: p.macdVwma },
      !!panel.macd,
    ),
  ];
}

const RADAR_MIN = 220;
const RADAR_MAX = 560;

const VIEW_TABS = [
  { id: 'grafik', label: 'Grafik' },
  { id: 'finansal', label: 'Finansallar' },
  { id: 'sektor', label: 'Sektör' },
];

const TF_ITEMS = [
  { id: 'D', label: 'Günlük' },
  { id: 'W', label: 'Haftalık' },
  { id: 'M', label: 'Aylık' },
];

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; candles: Candles; symbol: string; fromCache: boolean; generated: number }
  | { status: 'error'; message: string; missingData: boolean };

interface Props {
  state: UrlState;
  push: (patch: UrlState) => void;
}

function fmt(metric: Metric): string {
  const v = metric.value;
  if (!Number.isFinite(v)) return '—';
  switch (metric.unit) {
    case 'pct':
      return trPct(v, 2, !!metric.signed);
    case 'price':
      return trNum(v, v < 10 ? 4 : 2);
    case 'years':
      return `${trNum(v, 1)} yıl`;
    case 'volume':
      return v.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
    default:
      return trNum(v, 2);
  }
}

/** Sembol Masası — "bu hisse ne durumda?" sorusunun tek ekranlık cevabı. */
export default function SymbolDesk({ state, push }: Props) {
  const market = (MARKETS.includes(state.m as Market) ? state.m : 'bist') as Market;
  const tf = (['D', 'W', 'M'].includes(state.tf) ? state.tf : 'D') as TF;

  // Paket indirilmez: bu ekran tek sembolle çalışır, worker havuzu yeter.
  const analysis = useAnalysis(market, { bundle: false });
  const [symbols, setSymbols] = useState<string[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [tab, setTab] = useState('grafik');
  const [chartReady, setChartReady] = useState(false);
  const kayit = useRef<MasaTercihi>(tercihOku<MasaTercihi>(MASA_ANAHTARI, {}));
  const [showVolume, setShowVolume] = useState(() => kayit.current.showVolume ?? true);
  /**
   * KAYIT DEFTERİNDEN eklenen göstergeler.
   *
   * Eski sabit sistemin durumu (`enabled`, `panels`, `indParams`) hâlâ
   * okunuyor ve kaydı olmayan kullanıcı için buradan TAŞINIYOR: ekranda ne
   * görüyorsa o kalıyor. Yeniden yapılandırma kullanıcının kurduğu düzeni
   * sessizce silmemeli.
   */
  const [indikatorler, setIndikatorler] = useState<IndikatorOrnegi[]>(() => {
    const kayitli = kayit.current.indikatorler;
    if (kayitli?.length) return kayitli;
    return eskidenTasi(kayit.current);
  });
  const [kullaniciGostergeleri, setKullaniciGostergeleri] =
    useState<KullaniciGostergesi[]>(kullaniciGostergeleriOku);
  /**
   * Kullanıcı göstergelerinin SONUÇLARI.
   *
   * Barındırılan göstergeler analiz worker'ında hesaplanıp `analysisResult`
   * ile geliyor; kullanıcınınki YALITILMIŞ worker'da koşuyor ve ayrı
   * tutuluyor. Aynı torbaya koymak, kullanıcı kodunun sonucunu uygulamanın
   * kendi hesabıyla karıştırmak olurdu.
   */
  const [kullaniciDegerleri, setKullaniciDegerleri] = useState<
    Record<string, { ciktilar: CikisTanimi[]; degerler: Float64Array[] }>
  >({});
  const [kullaniciHatalari, setKullaniciHatalari] = useState<Record<string, string>>({});
  const [radarAcik, setRadarAcik] = useState(() => kayit.current.radar ?? false);
  const [radarGenislik, setRadarGenislik] = useState(() =>
    // VARSAYILAN 300 DEĞİL 420. 300 px'te radar tablosunun görünen alanı 272
    // px kalıyordu ve varsayılan sütunlar 520 px yer istiyordu: kullanıcı
    // fiyatı görmek için bile yatay kaydırmak zorundaydı (ölçüldü). 420 px'te
    // sembol + fiyat + 1 gün + hacim oranı + eylem sığıyor; sektör sütunu
    // ayırıcı genişletilince kendiliğinden geliyor.
    Math.min(RADAR_MAX, Math.max(RADAR_MIN, tercihOku<number>(RADAR_ANAHTARI, 420))),
  );
  const requestId = useRef(0);
  const surukleme = useRef<{ x: number; w: number } | null>(null);

  const radarAyarla = (px: number) => {
    const kirpik = Math.min(RADAR_MAX, Math.max(RADAR_MIN, Math.round(px)));
    setRadarGenislik(kirpik);
    tercihYaz(RADAR_ANAHTARI, kirpik);
  };

  // Grafik kütüphanesi zayıf makinede ~230 ms CPU istiyor (profille ölçüldü).
  // Mount'u boş zamana bırakınca metrikler ve sağlık paneli önce boyanıyor;
  // kullanıcı sayfayı "donmuş" görmüyor.
  useEffect(() => {
    const idle = (
      window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    ).requestIdleCallback;
    if (idle) {
      const id = idle(() => setChartReady(true), { timeout: 600 });
      return () =>
        (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(
          id,
        );
    }
    const id = setTimeout(() => setChartReady(true), 60);
    return () => clearTimeout(id);
  }, []);

  // Manifest → sembol listesi. Piyasa değişince yeniden.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setSymbols([]);
    dataClient
      .manifest(market, controller.signal)
      .then((manifest) => {
        if (cancelled) return;
        setSymbols(Object.keys(manifest.symbols).sort());
      })
      .catch(() => {
        if (!cancelled) setSymbols([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [market]);

  const symbol = state.s || symbols[0] || '';

  /**
   * ÇIPLAK adreste son bakılan yere dön.
   *
   * Yalnızca URL hiçbir sembol taşımıyorken ve YALNIZCA bir kez: adres
   * paylaşıldığında o adres kazanmalı, kullanıcının kendi geçmişi başkasının
   * bağlantısını ezmemeli. `replace` kullanılıyor — geri tuşu boş bir
   * adrese dönmek zorunda kalmasın.
   */
  const geriYuklendi = useRef(false);
  useEffect(() => {
    if (geriYuklendi.current) return;
    geriYuklendi.current = true;
    const son = kayit.current;
    if (state.s || !son.s) return;
    push({ m: son.m ?? market, s: son.s, tf: son.tf ?? tf });
    // Tek seferlik: bağımlılıklar bilerek dar tutuldu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tercihler değiştikçe kaydediliyor. Sembol/piyasa/periyot da burada:
  // adres çıplakken buradan devam edilecek.
  useEffect(() => {
    if (!symbol) return;
    /*
      Eski alanlar (`enabled`, `panels`, `indParams`) ARTIK YAZILMIYOR ama
      okunan kayıtta durmaya devam edebilir: `eskidenTasi` onları bir kez
      göstergelere çeviriyor. Yazmayı sürdürmek iki ayrı gerçek kaynak
      üretirdi.
    */
    kayit.current = {
      m: market,
      s: symbol,
      tf,
      showVolume,
      radar: radarAcik,
      indikatorler,
    };
    tercihYaz(MASA_ANAHTARI, kayit.current);
  }, [market, symbol, tf, showVolume, radarAcik, indikatorler]);

  // Seri yükleme.
  useEffect(() => {
    if (!symbol) return;
    const id = ++requestId.current;
    const controller = new AbortController();
    setLoad({ status: 'loading' });

    (async () => {
      try {
        const manifest = await dataClient.manifest(market, controller.signal);
        const result = await dataClient.series(market, symbol, controller.signal);
        if (id !== requestId.current) return;
        setLoad({
          status: 'ready',
          candles: result.candles,
          symbol,
          fromCache: result.fromCache,
          generated: manifest.generated,
        });
      } catch (err) {
        if (id !== requestId.current || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setLoad({
          status: 'error',
          message,
          missingData: /manifest|HTTP 404/i.test(message),
        });
      }
    })();

    return () => controller.abort();
  }, [market, symbol]);

  const daily = load.status === 'ready' ? load.candles : null;

  /**
   * Periyot dönüşümü, indikatörler, özet metrikler ve veri sağlığı WORKER'da.
   * Ana iş parçacığında yapıldıklarında zayıf makinede (6× CPU yavaşlatma)
   * tek parça ~150 ms blok ölçülmüştü; artık ana thread yalnızca çiziyor.
   */
  const [analysisResult, setAnalysisResult] = useState<{
    candles: Candles;
    metrics: Metric[];
    health: HealthReport;
    overlayValues: Float64Array[];
    /** Panel açıksa: Williams %R ve NizamiCedid MACD serileri. */
    indicators?: IndBundle;
    /** Kayıt defteri göstergeleri: örnek kimliği → çıktı dizileri. */
    indikatorDegerleri?: Record<string, Float64Array[]>;
    /**
     * Sonucun HANGİ piyasa ve periyot için hesaplandığı.
     *
     * Grafiğin "sığdır mı, koru mu" kararı buna bakmalı — canlı `tf`/`market`
     * değişkenlerine değil. Ölçüldü: periyot değişince worker sonucu gelene
     * kadar bir süre GÜNLÜK mumlar HAFTALIK anahtarla çiziliyor; anahtar
     * veriden önce değiştiği için önce günlük veri sığdırılıyor, sonra gerçek
     * haftalık veri "aynı anahtar" sayılıp o yanlış görünüme oturtuluyordu
     * (haftalıkta 120 bar beklenirken 25 bar görünüyordu).
     */
    tf: string;
    market: string;
  } | null>(null);
  /** Analiz (worker) hatası — seri indi ama hesap yapılamadı. */
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  /**
   * Worker'a gidecek gösterge listesi — YALNIZCA görünür olanlar.
   *
   * Kimlik, istek nesnesinin KENDİSİ değil içeriği üzerinden kuruluyor
   * (JSON): her render'da yeni bir dizi üretmek sembol isteğini sonsuz
   * yeniden tetiklerdi.
   */
  const istenenIndikatorler = useMemo(() => {
    const liste = indikatorler
      .filter((o) => o.gorunur && INDIKATOR_ILE.has(o.id))
      .map((o) => ({
        ornekId: o.ornekId,
        id: o.id,
        parametreler: parametreSinirla(INDIKATOR_ILE.get(o.id)!, o.parametreler),
      }));
    return liste;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(indikatorler.filter((o) => o.gorunur))]);

  /**
   * KULLANICI göstergelerini yalıtılmış worker'da hesapla.
   *
   * Ayrı efekt: analiz worker'ının isteğiyle aynı yere koymak, kullanıcı
   * kodunu uygulamanın kendi hesabının yoluna sokmak olurdu. Örnekler TEK TEK
   * koşuyor — biri çökerse ya da sonsuz döngüye girerse ötekiler etkilenmesin
   * (her çağrı kendi worker'ını kurup kapatıyor, bkz. gostergeIstemci).
   */
  const gorunurKullanici = useMemo(
    () => indikatorler.filter((o) => o.gorunur && kullaniciMi(o.id)),
    [indikatorler],
  );
  const kullaniciImza = JSON.stringify(
    gorunurKullanici.map((o) => [o.ornekId, o.id, o.parametreler]),
  );

  useEffect(() => {
    const mumlar = analysisResult?.candles;
    if (!mumlar || gorunurKullanici.length === 0) {
      setKullaniciDegerleri({});
      setKullaniciHatalari({});
      return;
    }
    let iptal = false;
    (async () => {
      const sonuclar: Record<string, { ciktilar: CikisTanimi[]; degerler: Float64Array[] }> = {};
      const hatalar: Record<string, string> = {};
      for (const o of gorunurKullanici) {
        const g = kullaniciGostergeleri.find((x) => x.id === o.id);
        if (!g) {
          hatalar[o.ornekId] = 'Bu gösterge silinmiş.';
          continue;
        }
        const r = await gostergeCalistirUzak(g.kaynak, mumlar, o.parametreler);
        if (iptal) return;
        if (r.tamam)
          sonuclar[o.ornekId] = { ciktilar: r.deger.ciktilar, degerler: r.deger.degerler };
        else hatalar[o.ornekId] = r.hata;
      }
      if (iptal) return;
      setKullaniciDegerleri(sonuclar);
      setKullaniciHatalari(hatalar);
    })();
    return () => {
      iptal = true;
    };
    // İmza: örnek kimliği + parametreler. Dizi kimliği her render'da değişir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisResult?.candles, kullaniciImza, kullaniciGostergeleri]);

  const clientRef = useRef(analysis.client);
  clientRef.current = analysis.client;

  useEffect(() => {
    const client = clientRef.current;
    if (!daily || !client) return;
    let cancelled = false;
    setAnalysisError(null);
    client
      .symbol(daily, {
        tf,
        // Eski sabit fiyat örtüleri ARTIK YOK: EMA'lar da kayıt defterinden
        // geliyor ve `indikatorler` üzerinden hesaplanıyor.
        overlays: [],
        // Hiçbir panel açık değilse indikatör hesaplanmıyor.
        // Sabit alan ARTIK GÖNDERİLMİYOR: paneller kayıt defterine taşındı.
        // Görünmeyen gösterge hesaplanmıyor — kapalı panelin 3650 barlık
        // hesabı boşa işti ve o kural korunuyor.
        indikatorler: istenenIndikatorler,
        todayDay: Math.floor(Date.now() / 1000 / DAY_SECONDS),
        realReturn: market === 'bist',
      })
      .then((result) => {
        if (!cancelled) setAnalysisResult({ ...result, tf, market });
      })
      .catch((err: unknown) => {
        // Sessizce null'a düşmek ekranı BOŞ bırakıyordu: grafik yok, metrik
        // yok, hata da yok. Kullanıcı neyin eksik olduğunu göremiyordu.
        if (cancelled) return;
        setAnalysisResult(null);
        setAnalysisError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // `istenenIndikatorler` kimliği parametrelere bağlı (useMemo): ayar
    // değişince yeniden hesaplanıyor, görünürlük değişince de.
  }, [daily, tf, market, istenenIndikatorler]);

  const candles = analysisResult?.candles ?? null;
  const metrics = analysisResult?.metrics ?? [];

  const chartColors = useChartColors();

  /**
   * Gösterge örnekleri → grafik serileri.
   *
   * Panel numarası burada dağıtılıyor: fiyat üstündekiler 0, "ayrı panel"
   * isteyen HER ÖRNEK kendi panelini alıyor. Aynı göstergeyi iki farklı
   * parametreyle eklemek bu yüzden iki ayrı panel veriyor — TradingView'daki
   * davranış da bu.
   *
   * Değeri gelmemiş örnek BOŞ dizi ile çiziliyor, atlanmıyor: seri listesi
   * ile çıktı listesi aynı sırada kalmalı (grafik serileri kuruluşta
   * eşleniyor).
   */
  const overlays = useMemo(() => {
    const bos = new Float64Array(0);
    const degerler = analysisResult?.indikatorDegerleri ?? {};
    const out: {
      key: string;
      label: string;
      color: string;
      values: Float64Array;
      visible: boolean;
      pane?: number;
      kind?: 'line' | 'hist';
      momentumColor?: boolean;
      baseline?: number;
    }[] = [];
    let sonrakiPanel = 1;
    /*
      GİZLİ gösterge panel numarası AYIRMIYOR.

      İlk yazımda numara görünürlükten bağımsız dağıtılıyordu: iki gösterge
      kapalıyken üçüncüsü panel 3'ü istiyor, grafik de 1 ve 2'yi BOŞ açıyordu.
      Ekran görüntüsünde yakalandı — RSI eklenmişti ama görünmüyordu, çünkü
      kendi paneli iki boş panelin altına sıkışmıştı.

      Gizli örneğe erişilemez bir numara veriliyor; grafik zaten yalnızca
      görünür panelleri kuruyor (bkz. PriceChart'taki `gorulenPane`), yani
      bu numara hiçbir zaman panele dönüşmüyor. Görünür yapılınca memo
      yeniden hesaplanıp sıradaki gerçek yuvayı alıyor.
    */
    const ERISILMEZ_PANEL = 1000;
    let gizliSayac = 0;

    for (const o of indikatorler) {
      /*
        İki kaynak, TEK çizim yolu: barındırılan gösterge tanımdan, kullanıcı
        göstergesi yalıtılmış worker'ın döndürdüğü çıktı tanımlarından. Çizim
        ikisini ayırt etmiyor — ayırt etseydi kullanıcının göstergesi ikinci
        sınıf olurdu.
      */
      const yerli = INDIKATOR_ILE.get(o.id);
      const kul = kullaniciMi(o.id) ? kullaniciGostergeleri.find((g) => g.id === o.id) : undefined;
      if (!yerli && !kul) continue;
      const kullaniciCikti = kullaniciDegerleri[o.ornekId];
      const fiyatPaneli = yerli ? yerli.panel === 'fiyat' : kul!.panel === 'fiyat';
      const panel = fiyatPaneli ? 0 : o.gorunur ? sonrakiPanel++ : ERISILMEZ_PANEL + gizliSayac++;
      const ciktilar = yerli
        ? yerli.ciktilar(parametreSinirla(yerli, o.parametreler))
        : (kullaniciCikti?.ciktilar ?? []);
      const seriler = yerli ? degerler[o.ornekId] : kullaniciCikti?.degerler;
      ciktilar.forEach((c, i) => {
        out.push({
          key: `${o.ornekId}:${c.ad}`,
          label: c.etiket,
          color: chartColors[c.token],
          values: seriler?.[i] ?? bos,
          visible: o.gorunur,
          pane: panel,
          kind: c.tur === 'sutun' ? 'hist' : 'line',
          momentumColor: c.yonRengi,
          baseline: c.taban,
        });
      });
    }
    return out;
  }, [analysisResult, indikatorler, chartColors, kullaniciDegerleri, kullaniciGostergeleri]);

  return (
    <div className="desk">
      <Announce
        message={
          analysisResult && !analysisError
            ? `${symbol} hazır: ${analysisResult.candles.length} bar.`
            : ''
        }
      />
      <div className="desk__bar">
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
          options={symbols.map((s) => ({ value: s, label: s }))}
          placeholder={symbol || 'Sembol ara…'}
          emptyText={symbols.length ? 'Eşleşme yok' : 'Sembol listesi yüklenemedi'}
        />
        <div className="desk__tf">
          <Tabs label="Görünüm" items={VIEW_TABS} value={tab} onChange={setTab} />
        </div>
        {tab === 'grafik' ? (
          <div className="desk__tf">
            <Tabs label="Periyot" items={TF_ITEMS} value={tf} onChange={(id) => push({ tf: id })} />
          </div>
        ) : null}
        {/*
          EMA anahtarları buradan KALKTI: göstergeler artık kayıt defterinden
          ekleniyor ve aşağıdaki panelde yönetiliyor. Hacim ve radar burada
          kaldı — ikisi de gösterge değil, ekranın kendi düğmeleri.
        */}
        <div className="desk__toggles" hidden={tab !== 'grafik'}>
          <Toggle label="Hacim" checked={showVolume} onChange={setShowVolume} />
          {/* Radar piyasa paketini indiriyor; kapalıyken o bedel ödenmiyor. */}
          <Toggle label="Radar" checked={radarAcik} onChange={setRadarAcik} />
        </div>
      </div>

      {/*
        İNDİKATÖR YÖNETİMİ ayrı bir satırda: arama, eklenenler ve her örneğin
        kendi ayar kutusu. Eskiden burada iki sabit panelin anahtarları ve
        dört sayı kutusu vardı; artık liste kayıt defterinden geliyor.
      */}
      {tab === 'grafik' ? (
        <IndikatorPaneli
          ornekler={indikatorler}
          onDegis={setIndikatorler}
          kullanici={kullaniciGostergeleri}
          onKullaniciDegis={setKullaniciGostergeleri}
          mumlar={candles}
          hatalar={kullaniciHatalari}
        />
      ) : null}

      {load.status !== 'error' && (analysisError || analysis.status === 'error') ? (
        <DataError title="Analiz çalıştırılamadı" detail={analysisError ?? analysis.error} />
      ) : null}

      {load.status === 'error' ? (
        <EmptyState
          tone="error"
          icon={<Icon name="alert" size={28} />}
          title={load.missingData ? 'Bu piyasa için paketlenmiş veri yok' : 'Veri yüklenemedi'}
          description={
            load.missingData ? (
              <>
                Veri CI'da üretiliyor (<code>scripts/pack_data.py</code>); yerel geliştirmede
                <code> public/data/&lt;piyasa&gt;/pack/</code> boş olabilir. Ayrıntı:{' '}
                <code>docs/plan/veri-formati.md</code>.
              </>
            ) : (
              load.message
            )
          }
          action={
            <Button onClick={() => push({ s: symbol })} variant="secondary">
              Yeniden dene
            </Button>
          }
        />
      ) : null}

      {load.status === 'loading' || load.status === 'idle' ? (
        <div className="desk__loading">
          <Skeleton height="320px" />
          <Skeleton count={2} height="64px" />
        </div>
      ) : null}

      {load.status === 'ready' && candles && tab === 'finansal' ? (
        <Suspense fallback={<Skeleton count={4} height="60px" />}>
          <LazyFinancials
            market={market}
            symbol={symbol}
            price={candles.close[candles.length - 1]}
            candles={candles}
          />
        </Suspense>
      ) : null}

      {tab === 'sektor' ? (
        <Suspense fallback={<Skeleton count={4} height="40px" />}>
          <LazySector
            market={market}
            symbol={symbol}
            client={analysis.status === 'ready' ? analysis.client : null}
            onSelect={(next) => push({ s: next })}
          />
        </Suspense>
      ) : null}

      {/*
        Grafik sekmesi SÖKÜLMÜYOR, gizleniyor.

        Kullanıcı isteği "hem finansallara hem grafiklere kolayca erişip"
        diyordu; sekme değişiminde grafiği yok edip yeniden kurmak zayıf
        makinede pahalı. Ölçüldü (6× yavaşlatma, gerçek BIST verisi):
        finansallardan grafiğe dönüş 540 ms ve içinde 233 ms'lik bir donma;
        gizlemeyle 334 ms ve 149 ms. Gizliyken hiç uzun görev üretmiyor ve
        düzende yer kaplamıyor (0×0), yani bedeli yok.
      */}
      {load.status === 'ready' && candles ? (
        <div className="desk__grafikalan" hidden={tab !== 'grafik'}>
          <div className="desk__alan">
            <section className="desk__chart" aria-label={`${symbol} fiyat grafiği`}>
              {chartReady ? (
                <ChartPanel
                  candles={candles}
                  overlays={overlays}
                  showVolume={showVolume}
                  /*
                    Sembol anahtarda DEĞİL: hisse değişince görünüm korunmalı.
                    Periyot ya da piyasa değişince sığdırmak DOĞRU — bar
                    uzunluğu değişince eski aralık başka bir zamana denk gelir.

                    Anahtar canlı `tf`/`market`ten DEĞİL, çizilen verinin
                    kendisinden türüyor; yoksa anahtar veriden bir adım önce
                    değişiyor (bkz. analysisResult.tf).

                    Tek başına yetmiyordu: yükleme sırasında grafik tamamen
                    sökülüyor (aşağıdaki `load.status === 'ready'` koşulu), yani
                    grafik nesnesi de denetleyici de yok ediliyor. Görünüm bu
                    yüzden bileşenin dışında, `grafikGorunum` ref'inde taşınıyor.
                  */
                  fitKey={`${analysisResult?.market}:${analysisResult?.tf}`}
                  gorunumRef={grafikGorunumDeposu}
                />
              ) : (
                <Skeleton height="320px" />
              )}
            </section>

            {radarAcik ? (
              <>
                {/* Ayırıcı: sürüklemeyle genişlik. Klavyeyle de çalışıyor —
                    yalnızca fareyle ayarlanabilen bir bölme erişilemez olurdu. */}
                {/* Ayarlanan şey bir DEĞER (piksel genişliği), o yüzden
                    `slider`: ekran okuyucu "Radar genişliği, 300" diye
                    okuyup ok tuşlarıyla değiştirilebileceğini söylüyor.
                    Odaklanabilir `separator` da ARIA'nın bölücü kalıbı ama
                    düz bir `div`e tabIndex vermek odak davranışını elle
                    yazmayı gerektiriyordu. */}
                <button
                  type="button"
                  className="desk__ayirici"
                  role="slider"
                  aria-label="Radar genişliği"
                  aria-valuenow={radarGenislik}
                  aria-valuemin={RADAR_MIN}
                  aria-valuemax={RADAR_MAX}
                  aria-valuetext={`${radarGenislik} piksel`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    surukleme.current = { x: e.clientX, w: radarGenislik };
                  }}
                  onPointerMove={(e) => {
                    const d = surukleme.current;
                    if (!d) return;
                    // Sola sürükleme radarı BÜYÜTÜR: radar sağda.
                    radarAyarla(d.w + (d.x - e.clientX));
                  }}
                  onPointerUp={() => {
                    surukleme.current = null;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') radarAyarla(radarGenislik + 24);
                    else if (e.key === 'ArrowRight') radarAyarla(radarGenislik - 24);
                    else return;
                    e.preventDefault();
                  }}
                />
                <div className="desk__radar" style={{ width: radarGenislik }}>
                  <Suspense fallback={<Skeleton count={3} height="40px" />}>
                    <LazyRadar
                      market={market}
                      symbol={symbol}
                      // Havuz paylaşılıyor: radar açıldığında paketi bu
                      // havuza yüklüyor ve taramayı worker'da yapıyor.
                      client={analysis.client}
                      onSelect={(next) => push({ s: next })}
                      onClose={() => setRadarAcik(false)}
                    />
                  </Suspense>
                </div>
              </>
            ) : null}
          </div>

          <section className="desk__metrics" aria-label="Özet metrikler">
            {metrics.map((metric) => (
              <Stat
                key={metric.key}
                label={metric.label}
                value={fmt(metric)}
                hint={`${metric.bars} bar`}
                provenance={
                  <Popover
                    title={metric.label}
                    align="start"
                    trigger={(p) => (
                      <button
                        type="button"
                        className="desk__prov"
                        {...p}
                        aria-label={`${metric.label}: bu sayı nereden geliyor?`}
                      >
                        ?
                      </button>
                    )}
                  >
                    <dl className="desk__provlist">
                      <dt>Formül</dt>
                      <dd>{metric.formula}</dd>
                      <dt>Pencere</dt>
                      <dd>
                        {metric.window} · {metric.bars} bar
                      </dd>
                      <dt>Kaynak</dt>
                      <dd>
                        {MARKET_LABEL[market]} günlük OHLCV,{' '}
                        {TF_ITEMS.find((t) => t.id === tf)?.label} periyoda indirgenmiş
                      </dd>
                    </dl>
                  </Popover>
                }
              />
            ))}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ChartPanel(props: ComponentProps<typeof LazyPriceChart>) {
  return (
    <Suspense fallback={<Skeleton height="320px" />}>
      <LazyPriceChart {...props} />
    </Suspense>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Combobox,
  IconButton,
  Popover,
  Select,
  VirtualTable,
  sortRows,
  trCompact,
  trNum,
  trPct,
  type Column,
} from '../../ui';
import { Icon } from '../../ui/icons';
import { dataClient } from '../../data-client/client';
import { fundamentalsClient } from '../../data-client/fundamentals';
import { sectorsClient } from '../../data-client/sectors';
import {
  DEFAULT_SCREEN_PARAMS,
  METRIC_DEFS,
  applyScreen,
  olculemeyen,
  type MetricDef,
  type Rule,
  type ScreenRow,
} from '../../core/screen/metrics';
import { FUNDAMENTAL_METRIC_DEFS, withFundamentals } from '../../core/screen/fundamentalMetrics';
import { sectorNames, UNCLASSIFIED, withSectors, type SectorMap } from '../../core/screen/sectors';
import type { Financials, FundamentalsSnapshot } from '../../core/fundamentals/types';
import type { Market } from '../../data-client/markets';
import type { AnalysisClient } from '../../workers/analysisClient';
import { tercihOku, tercihYaz } from '../tercih';

interface Props {
  market: Market;
  /** Şu an bakılan sembol — satırı vurgulanır. */
  symbol: string;
  /**
   * Sembol Masası'nın worker havuzu.
   *
   * Ölçüt hesabı (200–655 sembol × 250 bar) WORKER'da yapılıyor. Ana iş
   * parçacığında yapıldığında ölçüldü: radar açılışı zayıf makinede 897 →
   * 1.181 ms'ye çıkıyordu. Havuz zaten kurulu; radar açıldığında pakete de
   * yükleniyor — kapalıyken bu bedel ödenmiyor.
   */
  client: AnalysisClient | null;
  onSelect: (symbol: string) => void;
  onClose: () => void;
}

const LISTE_ANAHTARI = 'radar.liste.v1';
const KAPSAM_ANAHTARI = 'radar.kapsam.v1';
const SIRA_ANAHTARI = 'radar.sira.v1';
const FILTRE_ANAHTARI = 'radar.filtre.v2';
const SUTUN_ANAHTARI = 'radar.sutun.v1';
const SEKTOR_ANAHTARI = 'radar.sektor.v1';

/**
 * Varsayılan sütunlar.
 *
 * DÖRT tane, sekiz değil: 300 px'lik bir panelde sekiz sütun yatay kaydırma
 * demek ve ilk bakışta okunan şey en soldaki üç sütun oluyor. Kullanıcı
 * istediğini sütun seçiciden ekliyor; ayrıca FİLTRELENEN ölçüt kendiliğinden
 * sütun olarak geliyor.
 */
const VARSAYILAN_SUTUNLAR = ['last', 'chg1', 'volRatio'];

type Listeler = Partial<Record<Market, string[]>>;
type Kapsam = 'liste' | 'piyasa';

/** Ölçüt → {en az, en çok}. Boş alan sınır KOYMUYOR. */
type Araliklar = Record<string, { min?: number; max?: number }>;

/**
 * Ölçüt sözlüğü TARAMA EKRANIYLA aynı.
 *
 * Radarın kendi kısa listesi (yedi ölçüt) yetersizdi ve daha kötüsü, aynı
 * soruyu iki ekranda iki farklı kelimeyle soruyordu. Artık tek kaynak:
 * `METRIC_DEFS` + `FUNDAMENTAL_METRIC_DEFS`, yani 30 ölçüt, aynı formüller,
 * aynı birimler.
 */
const TUM_OLCUTLER: MetricDef[] = [...METRIC_DEFS, ...FUNDAMENTAL_METRIC_DEFS];
const OLCUT_BY_ID = new Map(TUM_OLCUTLER.map((d) => [d.id, d]));

/** Panelde gruplanmış gösterim — 30 ölçütlük düz liste okunmuyor. */
const GRUPLAR: { ad: string; idler: string[] }[] = [
  {
    ad: 'Fiyat ve hacim',
    idler: ['last', 'chg1', 'chg5', 'chg21', 'chg63', 'volRatio', 'turnover', 'atrPct', 'fromHigh'],
  },
  { ad: 'Teknik', idler: ['rsi', 'adx', 'emaFastGap', 'emaSlowGap'] },
  { ad: 'Değerleme', idler: ['marketCap', 'pe', 'pb', 'ps', 'pePercentile'] },
  {
    ad: 'Kârlılık ve büyüme',
    idler: ['roe', 'roePercentile', 'netMargin', 'grossMargin', 'revenueGrowth', 'netIncomeGrowth'],
  },
  {
    ad: 'Borç ve karne',
    idler: ['debtToEquity', 'currentRatio', 'quality', 'karneKarlilik', 'karneBuyume', 'karneBorc'],
  },
];

/**
 * Dönem DİZİSİ isteyen ölçütler — tam tablo dosyası olmadan hesaplanamaz.
 * (Tarama ekranındaki listeyle aynı; oradaki gerekçe de aynı.)
 */
const TABLO_ISTEYEN = new Set([
  'quality',
  'karneKarlilik',
  'karneBuyume',
  'karneBorc',
  'revenueGrowth',
  'netIncomeGrowth',
]);

/**
 * Hazır filtreler.
 *
 * Neden var: ölçüt listesini tarayıp eşik uydurmak, aradığını zaten bilen bir
 * kullanıcının işi. Radar "bugün ne oluyor" diye bakılan bir yüzey; bir tıkla
 * kurulan üç dört soru onu kullanılır yapıyor.
 */
const HAZIRLAR: { ad: string; aciklama: string; araliklar: Araliklar }[] = [
  {
    ad: 'Hacim patlaması',
    aciklama: 'Bugünkü hacmi son 20 barın ortalamasının iki katını geçenler',
    araliklar: { volRatio: { min: 2 } },
  },
  {
    ad: 'Yükselen trend',
    aciklama: 'Fiyat hızlı EMA üstünde ve trend gücü (ADX) 25 üzeri',
    araliklar: { emaFastGap: { min: 0 }, adx: { min: 25 } },
  },
  {
    ad: 'Zirveye yakın',
    aciklama: '250 barlık zirveden en çok %5 uzakta',
    araliklar: { fromHigh: { min: -5 } },
  },
  {
    ad: 'Ucuz ve kârlı',
    aciklama: 'F/K 10 altı ve özkaynak kârlılığı %15 üzeri',
    araliklar: { pe: { max: 10 }, roe: { min: 15 } },
  },
  {
    ad: 'Karne: sağlam',
    aciklama: 'Kârlılık ve borçluluk başlıklarının ikisi de %60 üzeri',
    araliklar: { karneKarlilik: { min: 60 }, karneBorc: { min: 60 } },
  },
];

/** Aralıkları tarama motorunun kural biçimine çevirir. */
export function araliklarKurallara(araliklar: Araliklar): Rule[] {
  const out: Rule[] = [];
  for (const [metric, { min, max }] of Object.entries(araliklar)) {
    const altVar = Number.isFinite(min as number);
    const ustVar = Number.isFinite(max as number);
    if (altVar && ustVar) out.push({ metric, op: 'between', a: min as number, b: max as number });
    else if (altVar) out.push({ metric, op: 'gt', a: min as number });
    else if (ustVar) out.push({ metric, op: 'lt', a: max as number });
  }
  return out;
}

function fmtOlcut(id: string, v: number): string {
  if (!Number.isFinite(v)) return '—';
  const def = OLCUT_BY_ID.get(id);
  if (def?.unit === 'pct') return trPct(v, 2, true);
  if (def?.unit === 'ratio') return `${trNum(v, 2)}×`;
  if (def?.unit === 'price') {
    /*
      BÜYÜK FİYATTA KURUŞ GÖSTERİLMİYOR ve bu bir kısaltma değil, KIRPILMAYI
      ÖNLEME. Sabit iki basamakla "4.125.000,00" on iki hane ediyor ve 88
      px'lik sütuna sığmıyor: gerçek veride ISKUR "4.125.00…" diye kırpılmış
      görünüyordu. Kırpılmış sayı okunamaz, yani yanlış sayıdır — bu kural
      tabloda zaten yazılı, burada uygulanmamıştı.

      Binin üstünde kuruş bilgi taşımıyor; anlamlı basamak korunuyor.
    */
    const ondalik = Math.abs(v) >= 1000 ? 0 : (def.decimals ?? 2);
    return trNum(v, ondalik);
  }
  if (def?.unit === 'money') return trCompact(v);
  return trNum(v, 1);
}

/**
 * Ölçütün birimi — filtre satırında adın yanına yazılıyor.
 *
 * "1 gün · en az · en çok" satırı neyin sayısını istediğini söylemiyordu:
 * yüzde mi, kat mı, lira mı? Kullanıcı tahmin etmek zorunda kalıyordu.
 */
function birimEki(def: MetricDef): string {
  const birim =
    def.unit === 'pct'
      ? '%'
      : def.unit === 'ratio'
        ? '×'
        : def.unit === 'money' || def.unit === 'price'
          ? 'TL'
          : '';
  // Etiket birimi ZATEN taşıyorsa tekrarlanmıyor: "ATR %" satırı ilk
  // denememde "ATR % %" diye çıktı.
  if (!birim || def.label.includes(birim)) return '';
  return birim;
}

/** Çip metni: "F/K ≤ 10" ya da "Değ % 2 – 5". */
function cipMetni(id: string, sinir: { min?: number; max?: number }): string {
  const ad = OLCUT_BY_ID.get(id)?.label ?? id;
  const alt = Number.isFinite(sinir.min as number);
  const ust = Number.isFinite(sinir.max as number);
  if (alt && ust) return `${ad} ${trNum(sinir.min!, 2)} – ${trNum(sinir.max!, 2)}`;
  if (alt) return `${ad} ≥ ${trNum(sinir.min!, 2)}`;
  return `${ad} ≤ ${trNum(sinir.max!, 2)}`;
}

/**
 * Radar — grafiğin yanında duran hisse takipçisi.
 *
 * Neden paket (bundle) ile: tek istek tüm sembollerin son barlarını getiriyor.
 * Sembol başına ayrı seri indirmek yüz sembolde yüz istek demekti. Paket
 * YALNIZCA radar açıldığında iniyor — Sembol Masası'nın kendi yükü bilerek
 * hafif tutuldu, radarı açmayan kullanıcı bu bedeli ödemiyor.
 */
export function Radar({ market, symbol, client, onSelect, onClose }: Props) {
  /** Worker'dan gelen ham ölçüt satırları (tüm piyasa). */
  const [ham, setHam] = useState<ScreenRow[] | null>(null);
  const [isimler, setIsimler] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<FundamentalsSnapshot | null>(null);
  const [sektorler, setSektorler] = useState<SectorMap | null>(null);
  const [tablolar, setTablolar] = useState<Map<string, Financials> | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [listeler, setListeler] = useState<Listeler>(() => tercihOku<Listeler>(LISTE_ANAHTARI, {}));
  /**
   * İlk açılışta radar BOŞ gelmemeli.
   *
   * Ölçüldü: kayıtlı tercihi olmayan bir kullanıcıda kapsam "İzleme listem",
   * liste de boş olduğu için tablo 0 satırla açılıyordu — tarayıcıyı ilk kez
   * açan kişi hiçbir hisse görmüyor, ne yapacağını bir paragraf metinden
   * çıkarması gerekiyordu. Kayıtlı tercih VARSA ona dokunulmuyor; yoksa ve
   * listede sembol yoksa tüm piyasayla açılıyor.
   */
  const [kapsam, setKapsam] = useState<Kapsam>(() => {
    const kayitli = tercihOku<Kapsam | null>(KAPSAM_ANAHTARI, null);
    if (kayitli === 'piyasa' || kayitli === 'liste') return kayitli;
    return (tercihOku<Listeler>(LISTE_ANAHTARI, {})[market] ?? []).length > 0 ? 'liste' : 'piyasa';
  });
  const [sira, setSira] = useState<{ key: string; dir: 'asc' | 'desc' }>(() =>
    tercihOku(SIRA_ANAHTARI, { key: 'chg1', dir: 'desc' as const }),
  );
  const [araliklar, setAraliklar] = useState<Araliklar>(() =>
    tercihOku<Araliklar>(FILTRE_ANAHTARI, {}),
  );
  const [ara, setAra] = useState('');
  const [olcutArama, setOlcutArama] = useState('');
  const [sutunlar, setSutunlar] = useState<string[]>(() =>
    tercihOku<string[]>(SUTUN_ANAHTARI, VARSAYILAN_SUTUNLAR),
  );
  /**
   * Seçili sektörler. Aralık filtrelerinden AYRI tutuluyor çünkü sektör
   * sayısal değil: "en az / en çok" ile ifade edilemez, `applyScreen`
   * kurallarına da girmez.
   */
  const [sektorSecim, setSektorSecim] = useState<string[]>(() =>
    tercihOku<string[]>(SEKTOR_ANAHTARI, []),
  );

  const liste = useMemo(() => listeler[market] ?? [], [listeler, market]);

  useEffect(() => {
    if (!client) return;
    let iptal = false;
    setHata(null);
    setHam(null);
    (async () => {
      try {
        // Paket indirme ve önbellek VERİ İSTEMCİSİNDE: kabuk kendi fetch'ini
        // yazsaydı aynı paket her açılışta yeniden inerdi.
        const { buffer } = await dataClient.bundleBuffer(market);
        if (iptal) return;
        const bilgi = await client.load(market, buffer);
        if (iptal) return;
        setIsimler(bilgi.symbols);
        const sonuc = await client.screen(market, DEFAULT_SCREEN_PARAMS);
        if (!iptal) setHam(sonuc.rows);
      } catch (err) {
        // Sessizce boş kalmak "listeniz boş" gibi okunurdu; sebep yazılıyor.
        if (!iptal) setHata(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      iptal = true;
    };
  }, [client, market]);

  // Çarpanlar ve sınıflandırma AYRI yükleniyor: gelmezlerse fiyat sütunları
  // çalışmaya devam eder, ilgili ölçütler "—" kalır.
  useEffect(() => {
    let iptal = false;
    setSnapshot(null);
    setSektorler(null);
    setTablolar(null);
    fundamentalsClient
      .snapshot(market)
      .then((s) => {
        if (!iptal) setSnapshot(s);
      })
      .catch(() => {});
    sectorsClient
      .map(market)
      .then((m) => {
        if (!iptal) setSektorler(m);
      })
      .catch(() => {});
    return () => {
      iptal = true;
    };
  }, [market]);

  /**
   * Tam tablolar YALNIZCA gerektiğinde (3,1 MB). Kullanılmayan bir ölçüt için
   * indirmek, radarın tamamından büyük bir bedel olurdu.
   */
  const tabloGerekli = useMemo(
    () => Object.keys(araliklar).some((id) => TABLO_ISTEYEN.has(id)),
    [araliklar],
  );
  useEffect(() => {
    if (!tabloGerekli || tablolar) return;
    let iptal = false;
    fundamentalsClient
      .allFinancials(market)
      .then((m) => {
        if (!iptal) setTablolar(m);
      })
      .catch(() => {});
    return () => {
      iptal = true;
    };
  }, [tabloGerekli, tablolar, market]);

  const listeYaz = (yeni: string[]) => {
    const sonraki = { ...listeler, [market]: yeni };
    setListeler(sonraki);
    tercihYaz(LISTE_ANAHTARI, sonraki);
  };

  const ekle = (s: string) => {
    if (!s || liste.includes(s)) return;
    listeYaz([...liste, s]);
  };

  /** Kapsam değişimi tek yerde: açılır liste ve boş durum düğmesi aynı yolu kullanır. */
  const kapsamYaz = (yeni: Kapsam) => {
    setKapsam(yeni);
    tercihYaz(KAPSAM_ANAHTARI, yeni);
  };

  const kapsamSemboller = useMemo(
    () => (kapsam === 'piyasa' ? null : new Set(liste)),
    [kapsam, liste],
  );

  /**
   * Satırlar tarama ekranıyla AYNI hesapla kuruluyor (`metricsFor`), böylece
   * iki ekran aynı sembol için aynı sayıyı veriyor. Daha önce radar kendi
   * küçük hesabını yapıyordu ve "1 gün" değişimi iki yerde farklı çıkabilirdi.
   */
  const satirlar: ScreenRow[] = useMemo(() => {
    if (!ham) return [];
    const kapsamli = kapsamSemboller ? ham.filter((r) => kapsamSemboller.has(r.symbol)) : ham;
    const temelli = snapshot
      ? withFundamentals(kapsamli, {
          snapshot,
          financialsOf: tablolar ? (sembol) => tablolar.get(sembol) : undefined,
        })
      : kapsamli;
    return withSectors(temelli, sektorler);
  }, [ham, kapsamSemboller, snapshot, sektorler, tablolar]);

  const kurallar = useMemo(() => araliklarKurallara(araliklar), [araliklar]);

  /**
   * Kurallara UYMADIĞI için değil, ÖLÇÜLEMEDİĞİ için elenenler.
   *
   * Tarayıcıdaki ile aynı kusur, aynı motor: "35 / 582" sayacı 547 sembolün
   * sınandığını ima ediyor, oysa NaN hiçbir kuralı geçmiyor. Gerçek veride
   * ölçüldü — 582 hissenin 293'ünün F/K'sı var. Radar dar bir panel, bu
   * yüzden cümle kısa; kırılım başlık (title) olarak veriliyor.
   */
  const olculemedi = useMemo(() => olculemeyen(satirlar, kurallar), [satirlar, kurallar]);

  const suzulmus = useMemo(() => {
    const q = ara.trim().toLocaleUpperCase('tr');
    const metinli = q
      ? satirlar.filter((r) => r.symbol.toLocaleUpperCase('tr').includes(q))
      : satirlar;
    // Sektör süzgeci sayısal kuralların DIŞINDA uygulanıyor. Seçim varken
    // sektörü BİLİNMEYEN sembol de eleniyor: "sektörü bilinmiyor" ile
    // "seçtiğin sektörde" aynı şey değil ve ikincisi iddia edilemez.
    const sektorlu =
      sektorSecim.length > 0
        ? metinli.filter((r) => (r.sector ? sektorSecim.includes(r.sector) : false))
        : metinli;
    // Süzme motoru tarama ekranıyla aynı: NaN hiçbir kuralı geçmez, yani
    // değeri olmayan sembol "eşiği geçti" sayılmaz.
    return applyScreen(sektorlu, { rules: kurallar });
  }, [satirlar, ara, kurallar, sektorSecim]);

  /*
    PANEL GENİŞLİĞİ ÖLÇÜLÜYOR, SÜTUNLAR ONA GÖRE SEÇİLİYOR.

    Radar bir raf ve genişliği düzene göre değişiyor. Sütunlar sabit
    genişlikteydi, toplamları rafın iki katını aşıyordu: ölçüldü — görünen
    alan 272 px, sütun toplamı 520 px (filtresiz), 712 px (iki filtreyle).
    Yani tablonun yarısından fazlası her zaman yatay kaydırmanın arkasındaydı
    ve kullanıcı fiyatı görmek için bile kaydırmak zorundaydı.

    Artık sığan seçiliyor. Öncelik: sembol → FİLTRELENEN ölçütler → kullanıcının
    seçtiği sütunlar → sektör. Gizlenen sütun SESSİZCE düşürülmüyor, sayısı
    yazılıyor; kullanıcının seçimini habersiz iptal etmek de bir kullanıcı
    düşmanlığıdır.
  */
  const [tabloGenislik, setTabloGenislik] = useState(0);
  const gozlemciRef = useRef<ResizeObserver | null>(null);
  /*
    GERİ ÇAĞIRMALI REF, `useEffect` değil. İlk yazışım `useEffect(..., [])`
    idi ve HİÇ ÇALIŞMADI: tablo veri gelene kadar render edilmiyor, yani
    efekt kurulduğunda `ref.current` boştu ve bir daha denenmiyordu. Ölçüm
    0 kalınca sütun bütçesi de sonsuz kalıyor, düzeltme sessizce devre dışı
    oluyordu (ölçüldü: içerik yine 712 px).

    Geri çağırmalı ref düğüm BAĞLANDIĞI anda çalışıyor, sökülünce de
    gözlemciyi bırakıyor.
  */
  const tabloRef = (el: HTMLDivElement | null) => {
    gozlemciRef.current?.disconnect();
    gozlemciRef.current = null;
    if (!el) return;
    setTabloGenislik(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTabloGenislik(el.clientWidth));
    ro.observe(el);
    gozlemciRef.current = ro;
  };

  const sutunSecimi = useMemo((): { cols: Column<ScreenRow>[]; gizli: number } => {
    const sayisal = (id: string, genislik: string): Column<ScreenRow> => ({
      key: id,
      header: OLCUT_BY_ID.get(id)?.label ?? id,
      numeric: true,
      width: genislik,
      sortValue: (r) => (Number.isFinite(r.values[id]) ? r.values[id] : Number.NEGATIVE_INFINITY),
      render: (r) => {
        const v = r.values[id];
        const isaretli = OLCUT_BY_ID.get(id)?.signed;
        return isaretli && Number.isFinite(v) ? (
          <span className={v >= 0 ? 'is-up' : 'is-down'}>{fmtOlcut(id, v)}</span>
        ) : (
          fmtOlcut(id, v)
        );
      },
    });

    /*
      SIRA ÖNEM SIRASI: sembol → FİLTRELENEN ölçütler → seçili sütunlar.

      "Filtrelenen ölçüt sütun olarak da gelsin" kuralı zaten vardı ama sütun
      listenin SONUNA ekleniyordu ve orası görünmüyor: panel bir raf, ölçüldü
      — kaydırma alanı 272 px, sütunların toplamı 520 px, yani 248 px yatay
      kaydırmanın arkasında. Kullanıcı "EMA hızlı fark ≥ 0" filtresini kurup
      tam o sütunu göremiyordu. Cevabı ekrana koymanın anlamı, GÖRÜNEN yere
      koymaktır.
    */
    const filtreli = Object.keys(araliklar).filter((id) => OLCUT_BY_ID.has(id));
    const secili = sutunlar.filter((id) => OLCUT_BY_ID.has(id) && !filtreli.includes(id));

    // Sembol + eylem her zaman duruyor; kalan bütçe sütunlara dağıtılıyor.
    // Genişlik henüz ölçülmediyse (ilk kare) sınır uygulanmıyor.
    let butce = tabloGenislik > 0 ? tabloGenislik - 76 - 36 : Number.POSITIVE_INFINITY;
    const sigar = (px: number): boolean => {
      if (butce - px < 0) return false;
      butce -= px;
      return true;
    };

    const cols: Column<ScreenRow>[] = [
      {
        key: 'symbol',
        header: 'Sembol',
        width: '76px',
        sortValue: (r) => r.symbol,
        render: (r) => (
          <span className={r.symbol === symbol ? 'radar__ad is-aktif' : 'radar__ad'}>
            {r.symbol}
          </span>
        ),
      },
    ];

    // Filtrelenen ölçüt ATLANMIYOR: satırın neden kaldığını anlatan sütun,
    // yer dar diye gizlenirse filtre yine anlaşılmaz olur.
    let gizli = 0;
    for (const id of filtreli) {
      sigar(84);
      cols.push(sayisal(id, '84px'));
    }
    for (const id of secili) {
      if (sigar(84)) cols.push(sayisal(id, '84px'));
      else gizli++;
    }

    if (sektorler && sigar(120)) {
      cols.push({
        key: 'sector',
        header: 'Sektör',
        width: '120px',
        sortValue: (r) => r.sector ?? '',
        // Uzun sektör adı dar rafta sığmıyor; tam adı `title` ile kurtarılıyor.
        render: (r) => <span title={r.sector ?? UNCLASSIFIED}>{r.sector ?? UNCLASSIFIED}</span>,
      });
    }

    cols.push({
      key: 'eylem',
      header: '',
      width: '36px',
      render: (r) =>
        liste.includes(r.symbol) ? (
          <IconButton
            label={`${r.symbol} radardan çıkar`}
            size="sm"
            onClick={() => listeYaz(liste.filter((x) => x !== r.symbol))}
          >
            <Icon name="close" size={14} />
          </IconButton>
        ) : (
          <IconButton label={`${r.symbol} radara ekle`} size="sm" onClick={() => ekle(r.symbol)}>
            <Icon name="plus" size={14} />
          </IconButton>
        ),
    });
    return { cols, gizli };
    // `liste`, `symbol`, sınıflandırma, sütunlar, etkin filtreler ve PANEL
    // GENİŞLİĞİ dışındaki her şey sabit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liste, symbol, sektorler, araliklar, sutunlar, tabloGenislik]);

  const columns = sutunSecimi.cols;
  const gizliSutun = sutunSecimi.gizli;

  const sirali = useMemo(() => sortRows(suzulmus, columns, sira), [suzulmus, columns, sira]);

  const araliklarYaz = (yeni: Araliklar) => {
    // Boş kalan ölçütler kayda girmiyor: "sınırı olmayan filtre" diye bir şey
    // yok ve çip olarak görünseydi kullanıcıyı yanıltırdı.
    const temiz: Araliklar = {};
    for (const [id, s] of Object.entries(yeni)) {
      const min = Number.isFinite(s.min as number) ? s.min : undefined;
      const max = Number.isFinite(s.max as number) ? s.max : undefined;
      if (min !== undefined || max !== undefined) temiz[id] = { min, max };
    }
    setAraliklar(temiz);
    tercihYaz(FILTRE_ANAHTARI, temiz);
  };

  const sektorYaz = (yeni: string[]) => {
    setSektorSecim(yeni);
    tercihYaz(SEKTOR_ANAHTARI, yeni);
  };

  /** Panelde seçilebilecek sektörler; sınıflandırma yoksa boş. */
  const sektorAdlari = useMemo(() => sectorNames(sektorler), [sektorler]);

  const secenekler = useMemo(
    () => isimler.filter((n) => !liste.includes(n)).map((n) => ({ value: n, label: n })),
    [isimler, liste],
  );

  const etkin = Object.entries(araliklar);
  /** Düğmedeki sayı: sektör seçimi de bir filtredir, sayılmalı. */
  const etkinSayi = etkin.length + (sektorSecim.length > 0 ? 1 : 0);
  const olcutQ = olcutArama.trim().toLocaleLowerCase('tr');

  return (
    <aside className="radar" aria-label="Radar">
      <header className="radar__bas">
        <h3>Radar</h3>
        {/*
          "20 / 582" ne demek belli değildi: bölü işareti hem "sayfa" hem
          "oran" hem "eşleşme" okunabiliyor. Sayının yanına ne olduğu
          yazılıyor ve filtre varken FARKLI cümle kuruluyor — süzülmemiş
          listede "eşleşti" demek yanıltıcı olurdu.
        */}
        <span
          className="radar__sayac"
          title={`Radardaki ${satirlar.length} sembolden ${sirali.length} tanesi görünüyor`}
        >
          {sirali.length === satirlar.length ? (
            <>{satirlar.length} sembol</>
          ) : (
            <>
              <b>{sirali.length}</b> / {satirlar.length} eşleşti
            </>
          )}
        </span>
        <IconButton label="Radarı kapat" onClick={onClose}>
          <Icon name="close" size={16} />
        </IconButton>
      </header>

      {olculemedi.count > 0
        ? (() => {
            const kirilim = olculemedi.byMetric
              .map((m) => `${OLCUT_BY_ID.get(m.metric)?.label ?? m.metric}: ${m.count}`)
              .join(', ');
            return (
              <p className="radar__olculemedi desk__muted" title={kirilim}>
                {olculemedi.count} sembol ölçülemedi — kuralı geçemedikleri için değil, o ölçü
                onlarda olmadığı için.
                {/*
                Kırılım `title` ile FARE kullanıcısına gidiyor; klavye ve ekran
                okuyucu `title`'a erişemiyor. Aynı bilgi görünmez metin olarak
                da veriliyor — panel dar olduğu için ekrana sığmıyor, ama
                erişilemez kalması sığmamasının bedeli olmamalı.
              */}
                <span className="visually-hidden"> Ölçüt kırılımı: {kirilim}.</span>
              </p>
            );
          })()
        : null}

      <div className="radar__kontrol">
        <Select
          label="Kapsam"
          hideLabel
          value={kapsam}
          onChange={(v) => kapsamYaz(v === 'piyasa' ? 'piyasa' : 'liste')}
          options={[
            { value: 'liste', label: 'İzleme listem' },
            { value: 'piyasa', label: 'Tüm piyasa' },
          ]}
        />
        <input
          className="ui-input radar__ara"
          value={ara}
          onChange={(e) => setAra(e.target.value)}
          placeholder="Sembol ara"
          aria-label="Sembol ara"
        />
      </div>

      <div className="radar__araclar">
        {/*
          FİLTRE PANELİ. Önceki tasarım her filtre için dört etkileşim
          istiyordu (ölçüt seç → koşul seç → değer yaz → ekle) ve üç tam
          genişlik form alanı dar panelin dikey alanını yiyordu. Artık tek
          düğme: panelde bütün ölçütler gruplu, her biri "en az / en çok"
          ile — koşul seçmeye gerek yok, aralık zaten koşulun kendisi.
        */}
        <Popover
          title="Filtreler"
          // Radar SAĞ kenarda duruyor: panel sağa açılınca ekranın dışına
          // taşıyor. Ölçüldü — "Hazır filtreler" listesi 1.500 px'lik
          // pencerede 1.585 px'e uzanıyordu, yani açıklamaların 85 px'i
          // görünmüyordu ve okunamıyordu.
          align="end"
          trigger={(p) => (
            <Button
              size="sm"
              variant={etkinSayi ? 'primary' : 'secondary'}
              // Açık ad: "Filtreyi kaldır: …" çipleriyle karışmasın ve ekran
              // okuyucu kaç filtre olduğunu söylesin.
              aria-label={`Filtre paneli${etkinSayi ? `, ${etkinSayi} etkin` : ''}`}
              {...p}
            >
              Filtre{etkinSayi ? ` (${etkinSayi})` : ''}
            </Button>
          )}
        >
          <div className="radar__panel">
            <input
              className="ui-input"
              value={olcutArama}
              onChange={(e) => setOlcutArama(e.target.value)}
              placeholder="Ölçüt ara (F/K, RSI…)"
              aria-label="Ölçüt ara"
            />
            {/*
              SEKTÖR SÜZGECİ. En üstte, çünkü "hangi sektör" sorusu
              "hangi F/K" sorusundan önce geliyor: nabızda bir sektörün
              öne çıktığını gören kullanıcı buraya o sektörü daraltmaya
              geliyor.

              Sınıflandırma YOKSA bölüm hiç çizilmiyor — boş bir "Sektör"
              başlığı, filtrenin var olduğunu ama çalışmadığını düşündürür.
            */}
            {sektorAdlari.length > 0 ? (
              /*
                SEKTÖR ARTIK KATLI AÇILIYOR. 27 onay kutusu panelin yarısından
                fazlasını kaplıyordu: ölçüldü — panel 580 px yüksekliğinde ve
                sayısal filtrelerin ilki ancak sektör duvarının altında
                başlıyordu. "Hangi sektör" sorusu önce gelebilir ama HER
                açılışta 27 satır ödetmek, asıl aracı (30 ölçüt) gömüyor.

                Seçim varken KENDİLİĞİNDEN açık: kullanıcı kendi kurduğu
                süzgeci kapalı bir kutunun arkasında aramamalı.
              */
              <details className="radar__grup radar__sektor" open={sektorSecim.length > 0}>
                <summary>
                  Sektör{' '}
                  <span className="desk__muted">
                    {sektorSecim.length === 0
                      ? 'hepsi'
                      : `${sektorSecim.length} seçili · sektörü bilinmeyenler elenir`}
                  </span>
                </summary>
                <div className="radar__sektor-cipler">
                  {sektorAdlari.map((ad) => {
                    const acik = sektorSecim.includes(ad);
                    return (
                      <label key={ad} className={`radar__sektor-cip${acik ? ' is-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={acik}
                          onChange={() =>
                            sektorYaz(
                              acik ? sektorSecim.filter((x) => x !== ad) : [...sektorSecim, ad],
                            )
                          }
                        />
                        {ad}
                      </label>
                    );
                  })}
                </div>
              </details>
            ) : null}
            {GRUPLAR.map((grup) => {
              const gorunen = grup.idler
                .map((id) => OLCUT_BY_ID.get(id))
                .filter((d): d is MetricDef => !!d)
                .filter((d) => !olcutQ || d.label.toLocaleLowerCase('tr').includes(olcutQ));
              if (gorunen.length === 0) return null;
              return (
                <section key={grup.ad} className="radar__grup">
                  <h4>{grup.ad}</h4>
                  {gorunen.map((def) => (
                    <div key={def.id} className="radar__olcut">
                      <span className="radar__olcut-ad">
                        {def.label}
                        {birimEki(def) ? (
                          <span className="radar__olcut-birim">{birimEki(def)}</span>
                        ) : null}
                      </span>
                      <input
                        className="ui-input"
                        type="number"
                        inputMode="decimal"
                        value={araliklar[def.id]?.min ?? ''}
                        aria-label={`${def.label} en az`}
                        placeholder="en az"
                        onChange={(e) =>
                          araliklarYaz({
                            ...araliklar,
                            [def.id]: {
                              ...araliklar[def.id],
                              min: e.target.value === '' ? undefined : Number(e.target.value),
                            },
                          })
                        }
                      />
                      <input
                        className="ui-input"
                        type="number"
                        inputMode="decimal"
                        value={araliklar[def.id]?.max ?? ''}
                        aria-label={`${def.label} en çok`}
                        placeholder="en çok"
                        onChange={(e) =>
                          araliklarYaz({
                            ...araliklar,
                            [def.id]: {
                              ...araliklar[def.id],
                              max: e.target.value === '' ? undefined : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </Popover>

        <Popover
          title="Hazır filtreler"
          // Radar SAĞ kenarda duruyor: panel sağa açılınca ekranın dışına
          // taşıyor. Ölçüldü — "Hazır filtreler" listesi 1.500 px'lik
          // pencerede 1.585 px'e uzanıyordu, yani açıklamaların 85 px'i
          // görünmüyordu ve okunamıyordu.
          align="end"
          trigger={(p) => (
            <Button size="sm" variant="secondary" {...p}>
              Hazır
            </Button>
          )}
        >
          {(kapat) => {
            /*
              SEÇİMDE KAPANIYOR. İki nedeni var, ikisi de ölçüldü:

              1. Panel radar tablosunun ÜSTÜNDE duruyor. Hazır filtre
                 uygulandığında değişen şey tablo; panel açık kalınca kullanıcı
                 kendi yaptığı seçimin sonucunu göremiyor.
              2. Panel gövdeye taşındığı için odak tuzağı taşıyor (bkz.
                 `Popover`). Uygulandıktan sonra açık kalan panel Tab'ı beş
                 düğmeye hapsediyordu — klavye denetimi bunu yakaladı.

              Kapanışta odak "Hazır" düğmesine geri dönüyor.
            */
            return (
              <ul className="radar__hazirlar">
                {HAZIRLAR.map((h) => (
                  <li key={h.ad}>
                    <button
                      type="button"
                      onClick={() => {
                        araliklarYaz(h.araliklar);
                        kapat();
                      }}
                    >
                      <b>{h.ad}</b>
                      <span className="desk__muted">{h.aciklama}</span>
                    </button>
                  </li>
                ))}
              </ul>
            );
          }}
        </Popover>

        <Popover
          title="Sütunlar"
          // Radar SAĞ kenarda duruyor: panel sağa açılınca ekranın dışına
          // taşıyor. Ölçüldü — "Hazır filtreler" listesi 1.500 px'lik
          // pencerede 1.585 px'e uzanıyordu, yani açıklamaların 85 px'i
          // görünmüyordu ve okunamıyordu.
          align="end"
          trigger={(p) => (
            <Button
              size="sm"
              variant="secondary"
              aria-label={
                gizliSutun > 0
                  ? `Sütun seçici — ${gizliSutun} sütun panele sığmadığı için gizli`
                  : 'Sütun seçici'
              }
              /* Gizlenen sütun SESSİZCE düşürülmüyor: kullanıcı bir sütunu
                 açtıysa ve panel dar diye görünmüyorsa, bunu bilmeli. */
              title={gizliSutun > 0 ? `${gizliSutun} sütun panele sığmadı` : undefined}
              {...p}
            >
              Sütun{gizliSutun > 0 ? ` (−${gizliSutun})` : ''}
            </Button>
          )}
        >
          <div className="radar__panel">
            {GRUPLAR.map((grup) => {
              const gorunen = grup.idler
                .map((id) => OLCUT_BY_ID.get(id))
                .filter((d): d is MetricDef => !!d);
              return (
                <section key={grup.ad} className="radar__grup">
                  <h4>{grup.ad}</h4>
                  {gorunen.map((def) => (
                    <label key={def.id} className="radar__sutun-secim">
                      <input
                        type="checkbox"
                        checked={sutunlar.includes(def.id)}
                        onChange={(e) => {
                          const yeni = e.target.checked
                            ? [...sutunlar, def.id]
                            : sutunlar.filter((x) => x !== def.id);
                          setSutunlar(yeni);
                          tercihYaz(SUTUN_ANAHTARI, yeni);
                        }}
                      />
                      <span>{def.label}</span>
                    </label>
                  ))}
                </section>
              );
            })}
          </div>
        </Popover>

        <Combobox
          label="Radara ekle"
          hideLabel
          value=""
          onChange={ekle}
          options={secenekler}
          placeholder={ham ? '+ sembol' : 'Yükleniyor…'}
          emptyText={ham ? 'Eşleşme yok' : 'Paket yükleniyor'}
        />
      </div>

      {etkinSayi > 0 ? (
        <ul className="radar__cipler" aria-label="Etkin filtreler">
          {sektorSecim.length > 0 ? (
            <li>
              <span>
                {sektorSecim.length === 1 ? sektorSecim[0] : `${sektorSecim.length} sektör`}
              </span>
              <IconButton label="Filtreyi kaldır: Sektör" size="sm" onClick={() => sektorYaz([])}>
                <Icon name="close" size={12} />
              </IconButton>
            </li>
          ) : null}
          {etkin.map(([id, sinir]) => (
            <li key={id}>
              <span>{cipMetni(id, sinir)}</span>
              <IconButton
                label={`Filtreyi kaldır: ${OLCUT_BY_ID.get(id)?.label ?? id}`}
                size="sm"
                onClick={() => {
                  const { [id]: _cikan, ...kalan } = araliklar;
                  araliklarYaz(kalan);
                }}
              >
                <Icon name="close" size={12} />
              </IconButton>
            </li>
          ))}
          <li className="radar__cip-temizle">
            <button
              type="button"
              onClick={() => {
                araliklarYaz({});
                sektorYaz([]);
              }}
            >
              Tümünü temizle
            </button>
          </li>
        </ul>
      ) : null}

      {tabloGerekli && !tablolar ? (
        <p className="radar__bos desk__muted">
          Karne ve büyüme ölçütleri tüm sembollerin dönem tablolarını ister; dosya iniyor.
        </p>
      ) : null}

      {hata ? (
        <p className="radar__bos desk__muted">
          Radar verisi yüklenemedi: {hata}. Paket CI'da üretiliyor; yerelde{' '}
          <code>scripts/pack_data.py</code> çalıştırılmamış olabilir.
        </p>
      ) : !ham ? (
        <p className="radar__bos desk__muted">Paket indiriliyor…</p>
      ) : (
        <div className="radar__tablo" ref={tabloRef}>
          <VirtualTable
            rows={sirali}
            columns={columns}
            rowKey={(r) => r.symbol}
            label="Radar tablosu"
            rowHeight={30}
            sort={sira}
            onSortChange={(s) => {
              setSira(s);
              tercihYaz(SIRA_ANAHTARI, s);
            }}
            onRowClick={(r) => onSelect(r.symbol)}
            empty={
              kapsam === 'liste' && liste.length === 0 ? (
                /*
                  Boş durumun ÇIKIŞI olmalı. Eski hâli yalnızca "kapsamı Tüm
                  piyasa yapın" diye anlatıyordu; kullanıcı açılır listeyi
                  bulmak zorundaydı. Aynı işi tek tıkla yapan düğme duruyor.
                */
                <p className="radar__bos desk__muted">
                  Listeniz boş. Sağdaki kutudan sembol ekleyebilirsiniz; seçtikleriniz bu tarayıcıda
                  saklanır.{' '}
                  <button
                    type="button"
                    className="radar__bos-eylem"
                    onClick={() => kapsamYaz('piyasa')}
                  >
                    Tüm piyasayı göster
                  </button>
                </p>
              ) : etkinSayi > 0 ? (
                <p className="radar__bos desk__muted">
                  Filtrelere uyan sembol yok.{' '}
                  <button
                    type="button"
                    className="radar__bos-eylem"
                    onClick={() => {
                      araliklarYaz({});
                      sektorYaz([]);
                    }}
                  >
                    Filtreleri temizle
                  </button>
                </p>
              ) : (
                <p className="radar__bos desk__muted">Bu piyasanın paketinde sembol yok.</p>
              )
            }
          />
        </div>
      )}
    </aside>
  );
}

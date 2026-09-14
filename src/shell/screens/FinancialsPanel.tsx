import { useEffect, useMemo, useState } from 'react';
import { Badge, EmptyState, Popover, Skeleton, Stat, trPct, trNum } from '../../ui';
import { Icon } from '../../ui/icons';
import {
  annualSeries,
  computeRatios,
  growth,
  karne,
  qualityScore,
  quarterlySeries,
  reportStep,
  type Ratios,
} from '../../core/fundamentals/metrics';
import type { FieldId, Financials, FundamentalsSnapshot } from '../../core/fundamentals/types';
import { fundamentalsClient } from '../../data-client/fundamentals';
import { sectorsClient } from '../../data-client/sectors';
import type { Market } from '../../data-client/markets';
import type { Candles } from '../../core/data/types';
import { LineChart } from '../chart/LineChart';
import { BarSeries } from '../chart/BarSeries';
import { Select } from '../../ui';

interface Props {
  market: Market;
  symbol: string;
  /** Son kapanış — çarpanlar bununla hesaplanır. */
  price: number;
  /**
   * Fiyat serisi — finansal sekmesindeki DAR grafik için.
   *
   * Grafik ve finansallar ayrı panel olarak kalıyor; buradaki küçük fiyat
   * grafiği "hangi tarihte neye baktığımı" göstermek için, grafik sekmesinin
   * yerine geçmek için değil. Verilmezse bölüm hiç çizilmiyor.
   */
  candles?: Candles;
}

/** Kolon grafiklerinde gösterilecek dönem sayısı seçenekleri. */
const DONEM_SAYILARI = ['5', '8', '12', '20', 'hepsi'] as const;

/** Kolon grafiği kalemleri — üçü de AKIŞ kalemi, yani kümülatiften arındırılıyor. */
const KOLONLAR: { field: FieldId; label: string }[] = [
  { field: 'revenue', label: 'Satış' },
  { field: 'operatingProfit', label: 'Faaliyet kârı' },
  { field: 'netIncome', label: 'Net kâr' },
];

const fmtRatio = (v: number | null, digits = 2): string => (v === null ? '—' : trNum(v, digits));

const fmtPct = (v: number | null, digits = 1): string =>
  v === null || !Number.isFinite(v) ? '—' : trPct(v, digits, true);

const fmtMoney = (v: number | null): string => {
  if (v === null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${trNum(v / 1e9, 1)} mlr`;
  if (abs >= 1e6) return `${trNum(v / 1e6, 1)} mn`;
  if (abs >= 1e3) return `${trNum(v / 1e3, 1)} b`;
  return v.toFixed(0);
};

function prov(title: string, body: string) {
  return (
    <Popover
      title={title}
      trigger={(p) => (
        <button
          type="button"
          className="desk__prov"
          aria-label={`${title}: bu sayı nereden geliyor?`}
          {...p}
        >
          ?
        </button>
      )}
    >
      {body}
    </Popover>
  );
}

/** Sembol Masası'nın finansal sekmesi: çarpanlar, kalite, büyüme, tablolar. */
export function FinancialsPanel({ market, symbol, price, candles }: Props) {
  const [snapshot, setSnapshot] = useState<FundamentalsSnapshot | null>(null);
  const [fin, setFin] = useState<Financials | null>(null);
  const [noStatement, setNoStatement] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sector, setSector] = useState<string | null>(null);
  /**
   * Kolon grafikleri: dönem tabanı ve kaç dönem gösterileceği.
   *
   * Taban `null` iken VERİDEN karar veriliyor. Çeyreği olmayan bir şirkette
   * (kaynak yalnızca yıl sonu yayımlamışsa) "çeyreklik" görünüm üç tane boş
   * panel demek olurdu — kullanıcı hatası gibi görünen, aslında veri olan bir
   * durum. Seçim yapıldığı anda kullanıcının dediği geçerli.
   */
  const [tabanSecim, setTabanSecim] = useState<'ceyrek' | 'yil' | null>(null);
  const [adet, setAdet] = useState<string>('8');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFin(null);
    setNoStatement(false);
    Promise.all([
      fundamentalsClient.snapshot(market),
      fundamentalsClient.financials(market, symbol),
      fundamentalsClient.noStatementSymbols(market),
    ])
      .then(([snap, financials, tablosuz]) => {
        if (cancelled) return;
        setSnapshot(snap);
        setFin(financials);
        setNoStatement(tablosuz.has(symbol));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [market, symbol]);

  // Sektör AYRI yükleniyor: dosya yoksa (sınıflandırma üretilmediyse) finansal
  // panelin tamamı boş kalmamalı — detay satırı "—" der, panel çalışmaya devam
  // eder. Aynı sebeple hata yutuluyor, sektör UYDURULMUYOR.
  useEffect(() => {
    let cancelled = false;
    setSector(null);
    sectorsClient
      .map(market)
      .then((m) => {
        if (!cancelled) setSector(m?.of[symbol] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [market, symbol]);

  const row = snapshot?.symbols[symbol] ?? null;
  const ratios: Ratios | null = useMemo(
    () => (row ? computeRatios({ row, price }) : null),
    [row, price],
  );
  const quality = useMemo(() => (fin ? qualityScore(fin) : null), [fin]);
  const karneler = useMemo(() => (fin ? karne(fin) : null), [fin]);
  const g = useMemo(() => (fin ? growth(fin) : null), [fin]);

  const charts = useMemo(() => {
    if (!fin) return null;
    const revenue = annualSeries(fin, 'revenue');
    const netIncome = annualSeries(fin, 'netIncome');
    const equity = annualSeries(fin, 'equity');
    if (revenue.labels.length < 2) return null;

    // Yıl etiketlerini zaman eksenine çevir (grafik ortak bileşen).
    const time = revenue.labels.map((year) => Date.UTC(Number(year), 11, 31) / 1000);
    const clean = (values: (number | null)[]) => values.map((v) => (v === null ? NaN : v));

    // ÜÇ AYRI GRAFİK, tek grafikte üç çizgi değil.
    //
    // Üçü aynı doğrusal eksende çizilince net kâr görünmez oluyordu: satış
    // milyarlarla, net kâr sıfıra yakın; eksen satışa göre ölçeklenince
    // kârın bütün hareketi düz bir çizgiye iniyor. Yani grafiğin cevap
    // vermesi gereken soru ("bu şirket büyüyor mu?") tam olarak
    // cevaplanmıyordu.
    //
    // Endeksleme (taban yıl = 100) denenmedi çünkü ÖLÇÜLDÜ: yayındaki
    // veride 119 sembolün 27'sinde (%23) taban yıl net kârı NEGATİF, birinde
    // sıfır. Negatif tabana bölmek işaret çeviren, sıfıra bölmek tanımsız
    // sayı üretir — dörtte birinde yalan söyleyen bir ölçek, okunmayan bir
    // ölçekten kötüdür.
    //
    // Küçük çokluda her seri KENDİ ölçeğinde okunur ve hiçbir sahte
    // karşılaştırma üretilmez. Karşılaştırma zaten yandaki büyüme
    // kartlarında, sayıyla duruyor.
    return {
      time,
      panels: [
        {
          key: 'revenue',
          label: 'Satış',
          color: 'var(--accent)',
          values: clean(revenue.values),
        },
        {
          key: 'netIncome',
          label: 'Net kâr',
          color: 'var(--up)',
          values: clean(netIncome.values),
          // Net kâr negatife geçebilir: sıfır çizgisi olmadan "küçüldü" ile
          // "zarara döndü" aynı görünür.
          zeroLine: true,
        },
        {
          key: 'equity',
          label: 'Özkaynak',
          color: 'var(--text-muted)',
          values: clean(equity.values),
        },
      ],
    };
  }, [fin]);

  /**
   * Kolon grafiği verisi — taban (çeyrek/yıl) ve dönem sayısı kullanıcıda.
   *
   * Çeyreklik seride kümülatif farkı `quarterlySeries` alıyor: kaynak
   * "2026/6" satırında yılın İLK ALTI AYINI veriyor, ikinci çeyreği değil.
   * Ham hâliyle çizmek her çubuğu bir öncekini içeren bir merdivene çevirir.
   */
  // Tablonun kendi adımı: çeyreklik 3, altı aylık 6, yıllık 12. Yıllık
  // yayımlayan bir tabloda "çeyreklik" görünüm yıllığın aynısı olurdu.
  const ceyrekVar = useMemo(() => !!fin && reportStep(fin.periods) < 12, [fin]);
  const taban: 'ceyrek' | 'yil' = tabanSecim ?? (ceyrekVar ? 'ceyrek' : 'yil');

  const kolonlar = useMemo(() => {
    if (!fin) return null;
    const limit = adet === 'hepsi' ? undefined : Number(adet);
    const dizi = KOLONLAR.map(({ field, label }) => {
      if (taban === 'ceyrek') return { field, label, ...quarterlySeries(fin, field, limit) };
      const { labels, values } = annualSeries(fin, field);
      return limit && labels.length > limit
        ? { field, label, labels: labels.slice(-limit), values: values.slice(-limit) }
        : { field, label, labels, values };
    });
    return dizi[0].labels.length > 0 ? dizi : null;
  }, [fin, taban, adet]);

  /**
   * Finansal sekmesinin DAR fiyat grafiği.
   *
   * Son 500 bar: tam geçmiş bu genişlikte okunmuyor, üstelik dar grafiğin işi
   * "şu an nerede" sorusunu cevaplamak — derin inceleme grafik sekmesinde.
   */
  const mini = useMemo(() => {
    if (!candles || candles.length < 2) return null;
    const from = Math.max(0, candles.length - 500);
    return { time: candles.time.subarray(from), values: candles.close.subarray(from) };
  }, [candles]);

  /**
   * Şirket detayları.
   *
   * Fiili dolaşım oranı KASITLI olarak yok: veri setinde böyle bir alan
   * bulunmuyor ve tahminle doldurmak, üstelik bir "detay" başlığı altında,
   * uydurma sayıyı gerçek gibi gösterirdi. Panelin altındaki not bunu söylüyor.
   */
  const detaylar = useMemo(() => {
    if (!row) return null;
    const sermaye = row.paidCapital;
    const hbk =
      sermaye && sermaye > 0 && row.netIncomeTtm !== null ? row.netIncomeTtm / sermaye : null;
    const dd = sermaye && sermaye > 0 && row.equity !== null ? row.equity / sermaye : null;
    return { sermaye, hbk, dd };
  }, [row]);

  if (loading) return <Skeleton count={4} height="60px" />;

  if (!row && !fin) {
    // İki ayrı durum, iki ayrı cümle. "Veri yok" demek endeks ve fonlarda
    // YANLIŞ: XU100'ün bilançosu eksik değil, hiç yoktur. Ölçüldü — tablosu
    // gelmeyen 97 sembolün 52'si doğrudan endeks, kalanının çoğu fon ve
    // varant. Kullanıcıyı olmayan bir kusuru beklemeye bırakmamak gerekiyor.
    return noStatement ? (
      <EmptyState
        icon={<Icon name="report" size={28} />}
        title="Bu araç finansal tablo yayımlamıyor"
        description={
          <>
            Endeksler (XU100, XBANK…), fonlar ve varantlar bilanço ya da gelir tablosu açıklamaz —
            burada gösterilecek bir şey yok. Fiyat, grafik ve teknik ölçüler diğer sekmelerde
            çalışmaya devam ediyor.
          </>
        }
      />
    ) : (
      <EmptyState
        icon={<Icon name="report" size={28} />}
        title="Bu sembol için finansal veri yok"
        description={
          <>
            Finansal tablolar CI'da <code>scripts/build_fundamentals.py</code> ile üretiliyor
            (kaynak: İş Yatırım). Üretim çalışmadıysa ya da bu sembol için tablo bulunamadıysa
            burası boş kalır.
          </>
        }
      />
    );
  }

  return (
    <div className="fin">
      {/*
        ÜST SATIR: karne + DAR fiyat grafiği.

        Kullanıcı isteği: grafik ve finansallar ayrı panel kalsın, ama finansal
        sekmesinde de bir grafik olsun — "ama böyle dar". Buradaki grafik
        kapanış çizgisi; mum, indikatör ve çizim araçları grafik sekmesinde.
        Amaç finansal tabloya bakarken fiyatın nerede olduğunu kaybetmemek.
      */}
      <div className="fin__ust">
        {/*
          KARNE. Tek bir "11 üzerinden 4" sayısı üç ayrı soruyu birbirine
          karıştırıyordu: kârlı ama küçülen bir şirket ile zarar eden ama
          borcunu azaltan bir şirket aynı toplam skoru alabilir — oysa
          kullanıcının sorduğu şey hangisi olduğu. Ölçüt listesi altta
          duruyor: karne bir özet, kara kutu değil.
        */}
        {karneler ? (
          <section className="fin__panel" aria-label="Karne">
            <header>
              <h3>Karne</h3>
              <span className="desk__muted">
                Her başlık kendi ölçütleri üzerinden; veri eksikse madde değerlendirilmez ve PAYDA
                küçülür ("2/2" ile "2/5" aynı şey değil).
              </span>
            </header>
            <ul className="fin__karne">
              {karneler.map((b) => {
                const oran = b.available > 0 ? b.score / b.available : null;
                const tone =
                  oran === null ? 'unknown' : oran >= 0.7 ? 'up' : oran >= 0.4 ? 'warn' : 'down';
                return (
                  <li key={b.grup} className={`fin__karne-item is-${tone}`}>
                    <span className="fin__karne-score">
                      {b.available > 0 ? `${b.score}/${b.available}` : '—'}
                    </span>
                    <span className="fin__karne-label">{b.grup}</span>
                    {/* Halka: oranı renkten BAĞIMSIZ da okunur kılıyor. */}
                    <span
                      className="fin__karne-bar"
                      aria-hidden="true"
                      style={{ ['--oran' as string]: `${Math.round((oran ?? 0) * 100)}%` }}
                    />
                    <span className="visually-hidden">
                      {b.available > 0
                        ? `${b.grup}: ${b.available} ölçütün ${b.score} tanesi karşılandı`
                        : `${b.grup}: değerlendirilebilecek veri yok`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {mini ? (
          <section className="fin__panel fin__mini" aria-label="Fiyat (dar grafik)">
            <header>
              <h3>Fiyat</h3>
              <span className="desk__muted">son {mini.values.length} işlem günü · kapanış</span>
            </header>
            <LineChart
              series={[
                { label: symbol, color: 'var(--accent)', time: mini.time, values: mini.values },
              ]}
              height={150}
              unit="compact"
              ariaLabel={`${symbol} kapanış fiyatı, son ${mini.values.length} işlem günü`}
            />
          </section>
        ) : null}
      </div>

      <section className="fin__stats" aria-label="Çarpanlar">
        <Stat
          label="F/K"
          value={fmtRatio(ratios?.pe ?? null, 1)}
          hint={row ? `dönem ${row.period}` : undefined}
          provenance={prov(
            'F/K',
            'Piyasa değeri ÷ son 12 ay net kâr. Zarar eden şirkette boş bırakılır: negatif F/K sıralamada "ucuz" gibi görünür.',
          )}
        />
        <Stat
          label="PD/DD"
          value={fmtRatio(ratios?.pb ?? null)}
          provenance={prov('PD/DD', 'Piyasa değeri ÷ özkaynak (ana ortaklık payı).')}
        />
        <Stat
          label="PD/Satış"
          value={fmtRatio(ratios?.ps ?? null)}
          provenance={prov(
            'PD/Satış',
            'Piyasa değeri ÷ son 12 ay satış geliri. Zarar eden ya da kârı dalgalanan şirkette F/K anlamsızlaşır, satış ise pozitif kalır — bu yüzden bir yedek çarpandır, daha iyi bir çarpan değil. Bankada "satış" faiz geliridir; sanayi şirketiyle aynı ölçekte okunamaz.',
          )}
        />
        <Stat
          label="Özkaynak kârlılığı"
          value={fmtPct(ratios?.roePct ?? null)}
          provenance={prov(
            'Özkaynak kârlılığı (ROE)',
            'Son 12 ay net kâr ÷ özkaynak. Borçla büyüyen şirkette YÜKSEK çıkar: özkaynak küçüldükçe oran şişer, bu yüzden Borç/Özkaynak ile birlikte okunmalı.',
          )}
        />
        <Stat
          label="Net marj"
          value={fmtPct(ratios?.netMarginPct ?? null)}
          provenance={prov(
            'Net marj',
            'Son 12 ay net kâr ÷ son 12 ay satış geliri. Tek seferlik kalemler (varlık satışı, kur farkı) net kârı şişirip marjı gerçek faaliyetten kopuk gösterebilir.',
          )}
        />
        <Stat
          label="Brüt marj"
          value={fmtPct(ratios?.grossMarginPct ?? null)}
          provenance={prov(
            'Brüt marj',
            'Son 12 ay brüt kâr ÷ satış geliri. Satılan malın maliyeti dışındaki giderleri içermez; faaliyet verimliliğini değil FİYATLAMA gücünü ölçer.',
          )}
        />
        <Stat
          label="Borç/Özkaynak"
          value={fmtRatio(ratios?.debtToEquity ?? null)}
          hint={`net borç ${fmtMoney(ratios?.netDebt ?? null)}`}
          provenance={prov(
            'Borç/Özkaynak',
            'Toplam yükümlülük ÷ özkaynak. Yükümlülüğün tamamı finansal borç değildir (ticari borçlar, karşılıklar da içinde); bankada oran yapısı gereği çok yüksektir ve sanayi şirketiyle karşılaştırılamaz. Yanındaki net borç, finansal borçtan nakit düşülerek hesaplanır.',
          )}
        />
        <Stat
          label="Piyasa değeri"
          value={fmtMoney(ratios?.marketCap ?? null)}
          provenance={prov(
            'Piyasa değeri',
            "Son fiyat × ödenmiş sermaye. BIST'te nominal değer 1 TL olduğu için ödenmiş sermaye ≈ pay adedi; nominal değeri farklı şirketlerde bu yaklaşım sapar.",
          )}
        />
      </section>

      {g ? (
        <section className="fin__stats" aria-label="Büyüme">
          <Stat
            label="Ciro büyümesi"
            value={fmtPct(g.revenueYoyPct)}
            hint="son 12 ay, yıllık"
            provenance={prov(
              'Ciro büyümesi',
              'Son 12 ay satış geliri ile bir önceki 12 ayın karşılaştırması. ENFLASYONDAN ARINDIRILMAMIŞ: yüksek enflasyonda nominal büyüme, reel küçülmeyi gizleyebilir.',
            )}
          />
          <Stat
            label="Kâr büyümesi"
            value={fmtPct(g.netIncomeYoyPct)}
            hint="son 12 ay, yıllık"
            provenance={prov(
              'Kâr büyümesi',
              'Son 12 ay net kâr ile bir önceki 12 ayın karşılaştırması. Taban küçükse ya da işaret değiştiyse (zarardan kâra) yüzde yanıltıcı büyür; nominal, enflasyondan arındırılmamış.',
            )}
          />
          <Stat
            label="Özkaynak büyümesi"
            value={fmtPct(g.equityYoyPct)}
            hint="yıllık"
            provenance={prov(
              'Özkaynak büyümesi',
              'Son yıl sonu özkaynağı ile bir önceki yıl sonunun karşılaştırması. Sermaye artırımı ve yeniden değerleme de bu satırı büyütür — tamamı kâr birikimi değildir.',
            )}
          />
          <Stat
            label="Nakde dönüşüm"
            value={fmtRatio(ratios?.cashConversion ?? null)}
            hint="faaliyet nakit akışı ÷ net kâr"
            provenance={prov(
              'Nakde dönüşüm',
              '1’in altı, kârın nakde dönmediğini gösterir (alacak/stok şişmesi). Tahakkuk kalitesinin en basit ölçüsü.',
            )}
          />
        </section>
      ) : null}

      {kolonlar ? (
        <section className="fin__panel" aria-label="Dönemsel kolonlar">
          <header>
            <h3>{taban === 'ceyrek' ? 'Çeyreklik' : 'Yıllık'} satış, kâr ve net kâr</h3>
            <span className="desk__muted">
              {taban === 'ceyrek'
                ? 'Kümülatif dönemlerden ARINDIRILDI: kaynak "2026/6" satırında yılın ilk altı ayını verir, ikinci çeyreği değil. Önceki dönem eksikse çubuk çizilmez.'
                : 'Yıl sonu (/12) dönemleri.'}
            </span>
            <div className="fin__kontrol">
              <Select
                label="Dönem tabanı"
                value={taban}
                onChange={(v) => setTabanSecim(v === 'yil' ? 'yil' : 'ceyrek')}
                options={[
                  { value: 'ceyrek', label: 'Çeyreklik' },
                  { value: 'yil', label: 'Yıllık' },
                ]}
              />
              <Select
                label="Dönem sayısı"
                value={adet}
                onChange={setAdet}
                options={DONEM_SAYILARI.map((d) => ({
                  value: d,
                  label: d === 'hepsi' ? 'Hepsi' : `${d} dönem`,
                }))}
              />
            </div>
          </header>
          <div className="fin__kolonlar">
            {kolonlar.map((k) => (
              <div key={k.field} className="fin__serie">
                <span className="fin__serie-label">{k.label}</span>
                <BarSeries labels={k.labels} values={k.values} label={`${symbol} ${k.label}`} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {charts ? (
        <section className="fin__panel" aria-label="Yıllık seriler">
          <header>
            <h3>Yıllık seyir</h3>
            <span className="desk__muted">
              Yıl sonu dönemleri · her seri KENDİ ölçeğinde (büyüklükleri farklı)
            </span>
          </header>
          <div className="fin__series">
            {charts.panels.map((panel) => (
              <div key={panel.key} className="fin__serie">
                <span className="fin__serie-label" style={{ color: panel.color }}>
                  {panel.label}
                </span>
                <LineChart
                  series={[
                    {
                      label: panel.label,
                      color: panel.color,
                      time: charts.time,
                      values: panel.values,
                    },
                  ]}
                  height={120}
                  unit="compact"
                  zeroLine={panel.zeroLine}
                  ariaLabel={`${symbol} yıllık ${panel.label.toLowerCase()}`}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {detaylar ? (
        <section className="fin__panel" aria-label="Şirket detayları">
          <header>
            <h3>Şirket detayları</h3>
            {row ? <span className="desk__muted">bilanço dönemi {row.period}</span> : null}
          </header>
          <dl className="fin__detay">
            <div>
              <dt>Sektör</dt>
              <dd>{sector ?? '—'}</dd>
            </div>
            <div>
              <dt>Ödenmiş sermaye</dt>
              <dd>{fmtMoney(detaylar.sermaye)}</dd>
            </div>
            <div>
              <dt>Hisse başına kâr</dt>
              <dd>{fmtRatio(detaylar.hbk)}</dd>
            </div>
            <div>
              <dt>Hisse başına defter değeri</dt>
              <dd>{fmtRatio(detaylar.dd)}</dd>
            </div>
            <div>
              <dt>Piyasa değeri</dt>
              <dd>{fmtMoney(ratios?.marketCap ?? null)}</dd>
            </div>
            <div>
              <dt>Tablo tipi</dt>
              <dd>{fin?.group === '2' ? 'Banka' : fin?.group ? 'Sanayi/hizmet' : '—'}</dd>
            </div>
          </dl>
          {/*
            Fiili dolaşım oranı burada YOK çünkü veri setinde yok. Bir "detay"
            başlığı altında tahmin yazmak, uydurma sayıyı gerçek gibi gösterirdi.
          */}
          <p className="desk__muted">
            Hisse başına değerler ödenmiş sermayeye bölünerek bulunur; BIST'te nominal değer 1 TL
            olduğu için bu pay adedine yakındır, nominali farklı şirketlerde sapar. Fiili dolaşım
            oranı bu veri setinde bulunmuyor — tahminle doldurulmadı.
          </p>
        </section>
      ) : null}

      {quality ? (
        <section className="fin__panel" aria-label="Kalite ölçütleri">
          <header>
            <h3>Ölçütler</h3>
            <Badge
              tone={
                quality.score >= quality.available * 0.7
                  ? 'up'
                  : quality.score >= quality.available * 0.4
                    ? 'warn'
                    : 'down'
              }
            >
              {quality.score} / {quality.available}
            </Badge>
            <span className="desk__muted">
              Piotroski benzeri ölçütler; veri eksikse madde değerlendirilmez ve payda küçülür.
            </span>
          </header>
          <ul className="fin__checks">
            {quality.checks.map((check) => (
              <li
                key={check.id}
                className={`is-${check.passed === null ? 'unknown' : check.passed}`}
              >
                <span aria-hidden="true">
                  {check.passed === null ? '–' : check.passed ? '✓' : '✕'}
                </span>{' '}
                {check.label} <span className="desk__muted">· {check.group}</span>
                {check.passed === null ? <span className="desk__muted"> (veri yok)</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {fin && fin.missing.length > 0 ? (
        <p className="desk__muted">
          Bu şirketin tablosunda bulunamayan kalemler: {fin.missing.join(', ')} — ilgili oranlar boş
          bırakıldı.
        </p>
      ) : null}

      {snapshot ? <p className="desk__muted">{snapshot.note}</p> : null}
    </div>
  );
}

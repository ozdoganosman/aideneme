import { useEffect, useMemo, useState } from 'react';
import { Badge, EmptyState, Popover, Skeleton, Stat, trPct, trNum } from '../../ui';
import { Icon } from '../../ui/icons';
import {
  annualSeries,
  computeRatios,
  growth,
  qualityScore,
  type Ratios,
} from '../../core/fundamentals/metrics';
import type { Financials, FundamentalsSnapshot } from '../../core/fundamentals/types';
import { fundamentalsClient } from '../../data-client/fundamentals';
import type { Market } from '../../data-client/markets';
import { LineChart } from '../chart/LineChart';

interface Props {
  market: Market;
  symbol: string;
  /** Son kapanış — çarpanlar bununla hesaplanır. */
  price: number;
}

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
export function FinancialsPanel({ market, symbol, price }: Props) {
  const [snapshot, setSnapshot] = useState<FundamentalsSnapshot | null>(null);
  const [fin, setFin] = useState<Financials | null>(null);
  const [noStatement, setNoStatement] = useState(false);
  const [loading, setLoading] = useState(true);

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

  const row = snapshot?.symbols[symbol] ?? null;
  const ratios: Ratios | null = useMemo(
    () => (row ? computeRatios({ row, price }) : null),
    [row, price],
  );
  const quality = useMemo(() => (fin ? qualityScore(fin) : null), [fin]);
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

      {quality ? (
        <section className="fin__panel" aria-label="Kalite ölçütleri">
          <header>
            <h3>Kalite</h3>
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
                {check.label}
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

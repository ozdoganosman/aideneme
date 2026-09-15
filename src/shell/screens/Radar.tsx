import { useEffect, useMemo, useState } from 'react';
import {
  Combobox,
  IconButton,
  Select,
  VirtualTable,
  sortRows,
  trCompact,
  trNum,
  trPct,
  type Column,
} from '../../ui';
import { Icon } from '../../ui/icons';
import { NumberField } from '../../ui/Fields';
import { dataClient } from '../../data-client/client';
import { sectorsClient } from '../../data-client/sectors';
import { UNCLASSIFIED, type SectorMap } from '../../core/screen/sectors';
import { fundamentalsClient } from '../../data-client/fundamentals';
import { computeRatios } from '../../core/fundamentals/metrics';
import type { FundamentalsSnapshot } from '../../core/fundamentals/types';
import type { Market } from '../../data-client/markets';
import type { Bundle } from '../../core/data/pack';
import { tercihOku, tercihYaz } from '../tercih';

interface Props {
  market: Market;
  /** Şu an bakılan sembol — satırı vurgulanır. */
  symbol: string;
  onSelect: (symbol: string) => void;
  onClose: () => void;
}

const LISTE_ANAHTARI = 'radar.liste.v1';
const KAPSAM_ANAHTARI = 'radar.kapsam.v1';
const SIRA_ANAHTARI = 'radar.sira.v1';
const FILTRE_ANAHTARI = 'radar.filtre.v1';

/** Filtrelenebilir sayısal alanlar — tablo sütunlarıyla aynı isimler. */
const FILTRE_ALANLARI = [
  { key: 'degisimPct', label: 'Değ %' },
  { key: 'bagilHacim', label: 'Bağıl hacim' },
  { key: 'hacim', label: 'Hacim' },
  { key: 'fiyat', label: 'Fiyat' },
  { key: 'piyasaDegeri', label: 'Piyasa değeri' },
  { key: 'pe', label: 'F/K' },
  { key: 'pb', label: 'PD/DD' },
] as const;

type FiltreAlani = (typeof FILTRE_ALANLARI)[number]['key'];

interface Filtre {
  alan: FiltreAlani;
  /** 'gt' = büyüktür, 'lt' = küçüktür. */
  op: 'gt' | 'lt';
  deger: number;
}

type Listeler = Partial<Record<Market, string[]>>;
type Kapsam = 'liste' | 'piyasa';

interface Satir {
  symbol: string;
  fiyat: number;
  degisimPct: number | null;
  hacim: number;
  /** Son hacim ÷ son 20 barın ortalaması — "bugün olağandışı mı?" */
  bagilHacim: number | null;
  pe: number | null;
  pb: number | null;
  piyasaDegeri: number | null;
  /** Sınıflandırma dosyası yoksa boş. */
  sektor: string | null;
}

/** Son barın hacmi, 20 barlık ortalamaya göre. */
function bagilHacimHesapla(hacimler: Float64Array): number | null {
  const n = hacimler.length;
  if (n < 5) return null;
  const pencere = Math.min(20, n - 1);
  let toplam = 0;
  for (let i = n - 1 - pencere; i < n - 1; i++) toplam += hacimler[i];
  const ort = toplam / pencere;
  return ort > 0 ? hacimler[n - 1] / ort : null;
}

/**
 * Radar — grafiğin yanında duran, açılıp kapanan hisse takipçisi.
 *
 * Neden tablo: kullanıcının istediği şey bir "izleme listesi" değil, yan yana
 * KARŞILAŞTIRMA — fiyat, günlük değişim, hacim, bağıl hacim ve çarpanlar aynı
 * satırda. Sıralama da bu yüzden var: "bugün hacmi patlayanlar" sorusu ancak
 * sütunu sıralayarak cevaplanıyor.
 *
 * Neden paket (bundle) ile: tek istek tüm sembollerin son barlarını getiriyor.
 * Sembol başına ayrı seri indirmek yüz sembolde yüz istek demekti. Paket
 * YALNIZCA radar açıldığında iniyor — Sembol Masası'nın kendi yükü bilerek
 * hafif tutuldu, radarı açmayan kullanıcı bu bedeli ödemiyor.
 */
export function Radar({ market, symbol, onSelect, onClose }: Props) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [snapshot, setSnapshot] = useState<FundamentalsSnapshot | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [listeler, setListeler] = useState<Listeler>(() => tercihOku<Listeler>(LISTE_ANAHTARI, {}));
  const [kapsam, setKapsam] = useState<Kapsam>(() =>
    tercihOku<Kapsam>(KAPSAM_ANAHTARI, 'liste') === 'piyasa' ? 'piyasa' : 'liste',
  );
  const [sira, setSira] = useState<{ key: string; dir: 'asc' | 'desc' }>(() =>
    tercihOku(SIRA_ANAHTARI, { key: 'degisimPct', dir: 'desc' as const }),
  );
  const [sektorler, setSektorler] = useState<SectorMap | null>(null);
  const [filtreler, setFiltreler] = useState<Filtre[]>(() =>
    tercihOku<Filtre[]>(FILTRE_ANAHTARI, []),
  );
  const [secilenSektor, setSecilenSektor] = useState<string>('');
  const [ara, setAra] = useState('');
  // Yeni filtre taslağı (henüz eklenmemiş).
  const [taslak, setTaslak] = useState<{ alan: FiltreAlani; op: 'gt' | 'lt'; deger: number }>({
    alan: 'degisimPct',
    op: 'gt',
    deger: 0,
  });

  const liste = useMemo(() => listeler[market] ?? [], [listeler, market]);

  useEffect(() => {
    let iptal = false;
    setHata(null);
    setBundle(null);
    dataClient
      .bundle(market)
      .then((b) => {
        if (!iptal) setBundle(b);
      })
      .catch((err: unknown) => {
        // Sessizce boş kalmak "listeniz boş" gibi okunurdu; sebep yazılıyor.
        if (!iptal) setHata(err instanceof Error ? err.message : String(err));
      });
    return () => {
      iptal = true;
    };
  }, [market]);

  // Sektör sınıflandırması: yoksa sektör sütunu ve filtresi hiç görünmez.
  // Uydurma bir grup göstermek, olmayan bir bilgiyi varmış gibi sunardı.
  useEffect(() => {
    let iptal = false;
    setSektorler(null);
    setSecilenSektor('');
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

  // Çarpanlar AYRI yükleniyor: gelmezse fiyat sütunları çalışmaya devam eder,
  // F/K ve PD/DD "—" kalır. Temel veri her piyasada yok.
  useEffect(() => {
    let iptal = false;
    setSnapshot(null);
    fundamentalsClient
      .snapshot(market)
      .then((s) => {
        if (!iptal) setSnapshot(s);
      })
      .catch(() => {});
    return () => {
      iptal = true;
    };
  }, [market]);

  const listeYaz = (yeni: string[]) => {
    const sonraki = { ...listeler, [market]: yeni };
    setListeler(sonraki);
    tercihYaz(LISTE_ANAHTARI, sonraki);
  };

  const ekle = (s: string) => {
    if (!s || liste.includes(s)) return;
    listeYaz([...liste, s]);
  };

  const semboller = useMemo(
    () => (kapsam === 'piyasa' ? (bundle?.names ?? []) : liste),
    [kapsam, bundle, liste],
  );

  const satirlar: Satir[] = useMemo(() => {
    if (!bundle) return [];
    const out: Satir[] = [];
    for (const s of semboller) {
      const candles = bundle.seriesOf(s);
      if (!candles || candles.length < 2) continue;
      const n = candles.length;
      const fiyat = candles.close[n - 1];
      const onceki = candles.close[n - 2];
      const row = snapshot?.symbols[s] ?? null;
      const oranlar = row ? computeRatios({ row, price: fiyat }) : null;
      out.push({
        symbol: s,
        fiyat,
        // Önceki kapanış sıfır ya da geçersizse yüzde üretilmiyor.
        degisimPct:
          Number.isFinite(onceki) && onceki > 0 ? ((fiyat - onceki) / onceki) * 100 : null,
        hacim: candles.volume[n - 1],
        bagilHacim: bagilHacimHesapla(candles.volume),
        pe: oranlar?.pe ?? null,
        pb: oranlar?.pb ?? null,
        piyasaDegeri: oranlar?.marketCap ?? null,
        sektor: sektorler ? (sektorler.of[s] ?? UNCLASSIFIED) : null,
      });
    }
    return out;
  }, [bundle, semboller, snapshot, sektorler]);

  const columns: Column<Satir>[] = useMemo(() => {
    const cols: Column<Satir>[] = [
      {
        key: 'symbol',
        header: 'Sembol',
        width: '92px',
        sortValue: (r) => r.symbol,
        render: (r) => (
          <span className={r.symbol === symbol ? 'radar__ad is-aktif' : 'radar__ad'}>
            {r.symbol}
          </span>
        ),
      },
      {
        key: 'fiyat',
        header: 'Fiyat',
        numeric: true,
        width: '84px',
        sortValue: (r) => r.fiyat,
        render: (r) => trNum(r.fiyat, r.fiyat < 10 ? 3 : 2),
      },
      {
        key: 'degisimPct',
        header: 'Değ %',
        numeric: true,
        width: '80px',
        // Hesaplanamayan değişim sıralamada EN SONA düşsün; "0" saymak onu
        // yatay kapanışların arasına karıştırırdı.
        sortValue: (r) => r.degisimPct ?? Number.NEGATIVE_INFINITY,
        render: (r) =>
          r.degisimPct === null ? (
            '—'
          ) : (
            <span className={r.degisimPct >= 0 ? 'is-up' : 'is-down'}>
              {trPct(r.degisimPct, 2, true)}
            </span>
          ),
      },
      {
        key: 'hacim',
        header: 'Hacim',
        numeric: true,
        width: '84px',
        sortValue: (r) => r.hacim,
        render: (r) => trCompact(r.hacim),
      },
      {
        key: 'bagilHacim',
        header: 'Bağıl hacim',
        numeric: true,
        width: '100px',
        sortValue: (r) => r.bagilHacim ?? Number.NEGATIVE_INFINITY,
        render: (r) => (r.bagilHacim === null ? '—' : `${trNum(r.bagilHacim, 2)}×`),
      },
      {
        key: 'piyasaDegeri',
        header: 'Piyasa değeri',
        numeric: true,
        width: '104px',
        sortValue: (r) => r.piyasaDegeri ?? Number.NEGATIVE_INFINITY,
        render: (r) => (r.piyasaDegeri === null ? '—' : trCompact(r.piyasaDegeri)),
      },
      {
        key: 'pe',
        header: 'F/K',
        numeric: true,
        width: '76px',
        sortValue: (r) => r.pe ?? Number.POSITIVE_INFINITY,
        render: (r) => (r.pe === null ? '—' : trNum(r.pe, 1)),
      },
      {
        key: 'pb',
        header: 'PD/DD',
        numeric: true,
        width: '80px',
        sortValue: (r) => r.pb ?? Number.POSITIVE_INFINITY,
        render: (r) => (r.pb === null ? '—' : trNum(r.pb, 2)),
      },
    ];

    // Sektör sütunu YALNIZCA sınıflandırma varken: boş bir sütun dar panelde
    // yer yiyor ve "veri var ama bulunamadı" izlenimi veriyor.
    if (sektorler) {
      cols.push({
        key: 'sektor',
        header: 'Sektör',
        width: '128px',
        sortValue: (r) => r.sektor ?? '',
        render: (r) => r.sektor ?? '—',
      });
    }

    // Listeye ekleme/çıkarma sütunu: kapsam hangisiyse ona uygun eylem.
    cols.push({
      key: 'eylem',
      header: '',
      width: '40px',
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
    return cols;
    // `liste`, `symbol` ve sınıflandırma dışındaki her şey sabit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liste, symbol, sektorler]);

  /**
   * Süzme.
   *
   * DEĞERİ OLMAYAN satır sayısal filtreyi GEÇMİYOR. "F/K < 10" araması,
   * F/K'sı hiç olmayan (zarar eden ya da tablosu gelmemiş) şirketleri de
   * getirseydi sonuç listesi soruya cevap vermezdi — aynı kural tarama
   * ekranında da geçerli (NaN hiçbir kuralı geçmez).
   */
  const suzulmus = useMemo(() => {
    const q = ara.trim().toLocaleUpperCase('tr');
    return satirlar.filter((r) => {
      if (q && !r.symbol.toLocaleUpperCase('tr').includes(q)) return false;
      if (secilenSektor && r.sektor !== secilenSektor) return false;
      for (const f of filtreler) {
        const v = r[f.alan];
        if (v === null || !Number.isFinite(v)) return false;
        if (f.op === 'gt' ? !(v > f.deger) : !(v < f.deger)) return false;
      }
      return true;
    });
  }, [satirlar, ara, secilenSektor, filtreler]);

  const sirali = useMemo(() => sortRows(suzulmus, columns, sira), [suzulmus, columns, sira]);

  const filtreYaz = (yeni: Filtre[]) => {
    setFiltreler(yeni);
    tercihYaz(FILTRE_ANAHTARI, yeni);
  };

  const sektorListesi = useMemo(() => {
    if (!sektorler) return [];
    return [...new Set(Object.values(sektorler.of))].sort((a, b) => a.localeCompare(b, 'tr'));
  }, [sektorler]);

  const secenekler = useMemo(
    () =>
      (bundle?.names ?? []).filter((n) => !liste.includes(n)).map((n) => ({ value: n, label: n })),
    [bundle, liste],
  );

  return (
    <aside className="radar" aria-label="Radar">
      <header className="radar__bas">
        <h3>Radar</h3>
        <IconButton label="Radarı kapat" onClick={onClose}>
          <Icon name="close" size={16} />
        </IconButton>
      </header>

      {/*
        FİLTRELER. Radar bir izleme listesi değil tarama yüzeyi: "bugün bağıl
        hacmi 2 katını geçenler" ya da "F/K'sı 10'un altında olanlar" ancak
        filtreyle sorulabiliyor. Dar panele sığması için kural kur-ekle
        biçiminde: seçilen filtreler altta çip olarak duruyor.
      */}
      <div className="radar__kontrol">
        <Select
          label="Kapsam"
          value={kapsam}
          onChange={(v) => {
            const yeni: Kapsam = v === 'piyasa' ? 'piyasa' : 'liste';
            setKapsam(yeni);
            tercihYaz(KAPSAM_ANAHTARI, yeni);
          }}
          options={[
            { value: 'liste', label: 'İzleme listem' },
            { value: 'piyasa', label: 'Tüm piyasa' },
          ]}
        />
        <Combobox
          label="Radara ekle"
          value=""
          onChange={ekle}
          options={secenekler}
          placeholder={bundle ? 'Sembol ara…' : 'Yükleniyor…'}
          emptyText={bundle ? 'Eşleşme yok' : 'Paket yükleniyor'}
        />
      </div>

      <div className="radar__filtre">
        <label className="ui-field">
          <span className="ui-field__label">Sembol ara</span>
          <input
            className="ui-input"
            value={ara}
            onChange={(e) => setAra(e.target.value)}
            placeholder="THYAO"
          />
        </label>

        {/* Sınıflandırma yoksa sektör seçici HİÇ çizilmiyor: boş bir açılır
            kutu "sektör verisi var ama hiçbiri eşleşmedi" gibi okunurdu. */}
        {sektorListesi.length > 0 ? (
          <Select
            label="Sektör"
            value={secilenSektor}
            onChange={setSecilenSektor}
            options={[
              { value: '', label: 'Hepsi' },
              ...sektorListesi.map((x) => ({ value: x, label: x })),
            ]}
          />
        ) : null}

        <div className="radar__filtre-kur">
          <Select
            label="Ölçüt"
            value={taslak.alan}
            onChange={(v) => setTaslak((p) => ({ ...p, alan: v as FiltreAlani }))}
            options={FILTRE_ALANLARI.map((f) => ({ value: f.key, label: f.label }))}
          />
          <Select
            label="Koşul"
            value={taslak.op}
            onChange={(v) => setTaslak((p) => ({ ...p, op: v === 'lt' ? 'lt' : 'gt' }))}
            options={[
              { value: 'gt', label: 'büyüktür' },
              { value: 'lt', label: 'küçüktür' },
            ]}
          />
          <NumberField
            label="Değer"
            value={taslak.deger}
            step={0.1}
            onChange={(v) => setTaslak((p) => ({ ...p, deger: v }))}
          />
          <IconButton
            label="Filtreyi ekle"
            variant="primary"
            onClick={() => filtreYaz([...filtreler, { ...taslak }])}
          >
            <Icon name="plus" size={14} />
          </IconButton>
        </div>

        {filtreler.length > 0 ? (
          <ul className="radar__cipler" aria-label="Etkin filtreler">
            {filtreler.map((f, i) => (
              <li key={`${f.alan}-${f.op}-${f.deger}-${i}`}>
                <span>
                  {FILTRE_ALANLARI.find((x) => x.key === f.alan)?.label} {f.op === 'gt' ? '>' : '<'}{' '}
                  {trNum(f.deger, 2)}
                </span>
                <IconButton
                  label={`Filtreyi kaldır: ${FILTRE_ALANLARI.find((x) => x.key === f.alan)?.label}`}
                  size="sm"
                  onClick={() => filtreYaz(filtreler.filter((_, j) => j !== i))}
                >
                  <Icon name="close" size={12} />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Kaç satır elendiği YAZIYOR: filtre koyan kullanıcı "liste neden
            boşaldı" sorusunu tablonun boşluğundan çıkarmak zorunda kalmasın. */}
        <p className="radar__sayac desk__muted">
          {sirali.length} / {satirlar.length} sembol
        </p>
      </div>

      {hata ? (
        <p className="radar__bos desk__muted">
          Radar verisi yüklenemedi: {hata}. Paket CI'da üretiliyor; yerelde{' '}
          <code>scripts/pack_data.py</code> çalıştırılmamış olabilir.
        </p>
      ) : !bundle ? (
        <p className="radar__bos desk__muted">Paket indiriliyor…</p>
      ) : (
        <div className="radar__tablo">
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
              kapsam === 'liste' ? (
                <p className="radar__bos desk__muted">
                  Liste boş. Yukarıdan sembol ekleyin ya da kapsamı "Tüm piyasa" yapın;
                  seçtikleriniz bu tarayıcıda saklanır.
                </p>
              ) : (
                <p className="radar__bos desk__muted">Bu piyasanın paketinde sembol yok.</p>
              )
            }
          />
        </div>
      )}

      {/* Listede olup pakette OLMAYAN sembol sessizce düşmesin. */}
      {bundle && kapsam === 'liste' && sirali.length < liste.length ? (
        <p className="radar__bos desk__muted">
          {liste.length - sirali.length} sembol bu piyasanın paketinde yok ve gösterilemiyor.
        </p>
      ) : null}
    </aside>
  );
}

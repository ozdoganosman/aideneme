import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Combobox,
  Dialog,
  EmptyState,
  IconButton,
  NumberField,
  Popover,
  RangeField,
  Select,
  Sheet,
  Skeleton,
  Stat,
  Tabs,
  Toggle,
  Tooltip,
  VirtualTable,
  sortRows,
  useToast,
  type Column,
  trNum,
  trPct,
} from '../../ui';
import { Icon } from '../../ui/icons';

interface DemoRow {
  id: number;
  kod: string;
  fiyat: number;
  degisim: number;
}

/** Örnek satırlar — deterministik üretilir, gerçek piyasa verisi DEĞİLDİR. */
function demoRows(n: number): DemoRow[] {
  const rows: DemoRow[] = [];
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const r = seed / 2147483648;
    rows.push({
      id: i,
      kod: `ÖRN${String(i).padStart(3, '0')}`,
      fiyat: 10 + r * 90,
      degisim: (r - 0.5) * 8,
    });
  }
  return rows;
}

/**
 * UI Kitaplığı — Storybook yerine. Tüm primitive'ler gerçek uygulama kabuğunun
 * içinde, gerçek temayla, tek sayfada. Ayrı bir araç zinciri kurmadan aynı işi
 * görür: bileşenleri gözle ve klavyeyle denetlemek.
 */
export default function Gallery() {
  const toast = useToast();
  const [tab, setTab] = useState('primitives');
  const [toggle, setToggle] = useState(true);
  const [num, setNum] = useState(14);
  const [range, setRange] = useState(200);
  const [sel, setSel] = useState('D');
  const [combo, setCombo] = useState('THYAO');
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({
    key: 'degisim',
    dir: 'desc',
  });

  const rows = useMemo(() => demoRows(800), []);
  const columns: Column<DemoRow>[] = useMemo(
    () => [
      { key: 'kod', header: 'Kod', render: (r) => r.kod, sortValue: (r) => r.kod, width: '40%' },
      {
        key: 'fiyat',
        header: 'Fiyat',
        numeric: true,
        render: (r) => trNum(r.fiyat, 2),
        sortValue: (r) => r.fiyat,
      },
      {
        key: 'degisim',
        header: 'Değişim',
        numeric: true,
        sortValue: (r) => r.degisim,
        render: (r) => (
          <span style={{ color: r.degisim >= 0 ? 'var(--up)' : 'var(--down)' }}>
            {r.degisim >= 0 ? '▲' : '▼'} {trPct(r.degisim, 2)}
          </span>
        ),
      },
    ],
    [],
  );
  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);

  return (
    <div className="shell-gallery">
      <Tabs
        label="Kitaplık bölümleri"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'primitives', label: 'Bileşenler' },
          { id: 'table', label: 'Tablo', badge: 800 },
          { id: 'states', label: 'Durumlar' },
        ]}
      />

      {tab === 'primitives' ? (
        <div className="shell-gallery__grid">
          <section className="shell-card">
            <h3>Düğmeler</h3>
            <div className="shell-row">
              <Button variant="primary">Birincil</Button>
              <Button>İkincil</Button>
              <Button variant="ghost">Hayalet</Button>
              <Button variant="danger">Tehlikeli</Button>
              <Button busy>Çalışıyor</Button>
              <Button disabled>Devre dışı</Button>
            </div>
            <div className="shell-row">
              <IconButton label="Grafiği yenile">
                <Icon name="refresh" />
              </IconButton>
              <IconButton label="Takibe ekle" active>
                <Icon name="star" />
              </IconButton>
              <Tooltip text="İpucu klavye odağında da açılır">
                <Button size="sm">İpuçlu düğme</Button>
              </Tooltip>
              <Button size="sm" onClick={() => toast.show('Kaydedildi', 'success')}>
                Toast göster
              </Button>
            </div>
          </section>

          <section className="shell-card">
            <h3>Girdiler</h3>
            <div className="shell-row shell-row--wrap">
              <Toggle checked={toggle} onChange={setToggle} label="Log ölçek" />
              <Select
                label="Periyot"
                value={sel}
                onChange={setSel}
                options={[
                  { value: 'D', label: 'Günlük' },
                  { value: 'W', label: 'Haftalık' },
                  { value: 'M', label: 'Aylık' },
                ]}
              />
              <NumberField label="RSI uzunluğu" value={num} onChange={setNum} min={2} max={200} />
            </div>
            <RangeField
              label="EMA periyodu"
              value={range}
              onChange={setRange}
              min={5}
              max={400}
              format={(v) => `${v} bar`}
            />
            <Combobox
              label="Sembol"
              value={combo}
              onChange={setCombo}
              options={[
                { value: 'THYAO', label: 'Türk Hava Yolları', meta: 'BIST · Ulaştırma' },
                { value: 'GARAN', label: 'Garanti BBVA', meta: 'BIST · Banka' },
                { value: 'ASELS', label: 'Aselsan', meta: 'BIST · Savunma' },
                { value: 'BTCUSDT', label: 'Bitcoin', meta: 'Kripto' },
              ]}
              placeholder="Sembol ara…"
            />
            <p className="shell-muted">Seçili: {combo}</p>
          </section>

          <section className="shell-card">
            <h3>Katmanlar</h3>
            <div className="shell-row">
              <Button onClick={() => setDialog(true)}>Diyalog aç</Button>
              <Button onClick={() => setSheet(true)}>Panel aç</Button>
              <Popover
                title="Bu sayı nereden geliyor?"
                trigger={(p) => (
                  <Button size="sm" {...p}>
                    Kaynak
                  </Button>
                )}
              >
                <p>
                  Formül, girdi penceresi ve veri tarihi bu katmanda gösterilir. Ürün ilkesi #2: her
                  sayı tıklanabilir.
                </p>
              </Popover>
            </div>
          </section>

          <section className="shell-card">
            <h3>Göstergeler</h3>
            <div className="shell-row shell-row--wrap">
              <Badge tone="up" icon="▲">
                OOS geçti
              </Badge>
              <Badge tone="down" icon="▼">
                Maliyetsiz
              </Badge>
              <Badge tone="warn" icon="!">
                Bayat veri
              </Badge>
              <Badge tone="accent">Faz 1</Badge>
              <Badge>Nötr</Badge>
            </div>
            <div className="shell-row shell-row--wrap">
              <Stat label="Örnek getiri" value="18,40" delta={2.13} hint="örnek veri" />
              <Stat label="Maks. drawdown" value="-12,80" delta={-1.2} hint="örnek veri" />
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'table' ? (
        <section className="shell-card shell-card--tall">
          <h3>Pencerelenmiş tablo — 800 satır, örnek veri</h3>
          <p className="shell-muted">
            DOM'da yalnızca görünen satırlar var. Başlığa tıkla → sıralama (aria-sort ile
            duyurulur).
          </p>
          <VirtualTable
            rows={sorted}
            columns={columns}
            rowKey={(r) => String(r.id)}
            label="Örnek tarama sonuçları"
            sort={sort}
            onSortChange={setSort}
            height={360}
            onRowClick={(r) => toast.show(`${r.kod} seçildi`)}
          />
        </section>
      ) : null}

      {tab === 'states' ? (
        <div className="shell-gallery__grid">
          <section className="shell-card">
            <h3>Yükleniyor</h3>
            <Skeleton count={4} height="18px" />
          </section>
          <section className="shell-card">
            <h3>Boş</h3>
            <EmptyState
              title="Kriterlere uyan sonuç yok"
              description="Filtreleri gevşetmeyi dene."
              action={<Button size="sm">Filtreleri sıfırla</Button>}
            />
          </section>
          <section className="shell-card">
            <h3>Hata</h3>
            <EmptyState
              tone="error"
              icon={<Icon name="alert" size={28} />}
              title="Veri yüklenemedi"
              description="Ağ hatası. Son bilinen veri 2 saat önceye ait."
              action={<Button size="sm">Yeniden dene</Button>}
            />
          </section>
        </div>
      ) : null}

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Örnek diyalog"
        description="Odak tuzağı devrede: Tab bu panelin dışına çıkmaz, Esc kapatır."
        footer={
          <>
            <Button onClick={() => setDialog(false)}>Vazgeç</Button>
            <Button variant="primary" onClick={() => setDialog(false)}>
              Tamam
            </Button>
          </>
        }
      >
        <p>Kapanışta odak, diyaloğu açan düğmeye geri döner.</p>
      </Dialog>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Örnek panel">
        <p>
          Geniş ekranda sağdan, dar ekranda alttan açılır — aynı bileşen. Ayrı bir mobil sürüm
          yazılmaz.
        </p>
      </Sheet>
    </div>
  );
}

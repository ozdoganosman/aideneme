import type { GroupFlow, PulseRow, WindowRow } from './pulse';

/**
 * Resmî sektör sınıflandırmasına göre para akışı.
 *
 * Kümeleme (`flowByCluster`) "birlikte hareket edenler" diyor; bu dosya
 * "aynı işi yapanlar" diyor. İkisi farklı sorulardır ve birbirinin yerine
 * geçmez: bir bankanın çimento şirketiyle aynı kümeye düşmesi mümkündür,
 * sektörü değişmez.
 *
 * Sınıflandırma dışarıdan (veri hattından) gelir. Gelmediğinde bu katman
 * boş döner; arayüz kümeleme görünümüne düşer ve nedenini söyler — sektör
 * UYDURULMAZ.
 */

export interface SectorMap {
  /** Sembol → sektör adı. */
  of: Record<string, string>;
  /** Kaynak ve üretim zamanı — ekranda gösterilir. */
  source: string;
  generated: number;
}

export interface SectorFlow extends Omit<GroupFlow, 'cluster'> {
  /** Sektör adı; sınıflandırması olmayanlar için 'Sınıflandırılmamış'. */
  sector: string;
  /** Toplam işlem değeri içindeki payı (%). */
  sharePct: number;
  /** Sektörün en çok işlem gören sembolü. */
  leader: string;
}

export const UNCLASSIFIED = 'Sınıflandırılmamış';

export function flowBySector(rows: PulseRow[], map: SectorMap | null): SectorFlow[] {
  if (!map) return [];

  const groups = new Map<string, PulseRow[]>();
  for (const row of rows) {
    // Sınıflandırması olmayan sembol GİZLENMEZ: ayrı bir grupta toplanır,
    // yoksa toplam işlem değeri sessizce küçülür ve paylar şişer.
    const sector = map.of[row.symbol] ?? UNCLASSIFIED;
    const list = groups.get(sector);
    if (list) list.push(row);
    else groups.set(sector, [row]);
  }

  let total = 0;
  for (const row of rows) total += row.value;

  const out: SectorFlow[] = [];
  for (const [sector, list] of groups) {
    let value = 0;
    let weighted = 0;
    let up = 0;
    let down = 0;
    let advancing = 0;
    let declining = 0;
    for (const row of list) {
      value += row.value;
      weighted += row.value * row.changePct;
      if (row.changePct > 0) {
        up += row.value;
        advancing++;
      } else if (row.changePct < 0) {
        down += row.value;
        declining++;
      }
    }
    out.push({
      sector,
      label: sector,
      leader: list.reduce((a, b) => (b.value > a.value ? b : a)).symbol,
      symbols: list.length,
      value,
      weightedChangePct: value ? weighted / value : NaN,
      flowPct: value ? ((up - down) / value) * 100 : NaN,
      sharePct: total ? (value / total) * 100 : NaN,
      advancing,
      declining,
    });
  }

  // Sınıflandırılmamış grup her zaman en sonda: bir sektör değil, bir eksik.
  return out.sort((a, b) => {
    if (a.sector === UNCLASSIFIED) return 1;
    if (b.sector === UNCLASSIFIED) return -1;
    return b.value - a.value;
  });
}

/** Kaç sembolün sınıflandırması var — kapsama oranı ekranda gösterilir. */
export function sectorCoverage(
  symbols: string[],
  map: SectorMap | null,
): { known: number; total: number; pct: number } {
  const total = symbols.length;
  if (!map || total === 0) return { known: 0, total, pct: 0 };
  let known = 0;
  for (const symbol of symbols) if (map.of[symbol]) known++;
  return { known, total, pct: (known / total) * 100 };
}

/**
 * Tarama satırlarına sektörü işler. Haritada olmayan sembolün `sector` alanı
 * TANIMSIZ kalır (boş string değil): "sektörü yok" ile "bilinmiyor" aynı şey
 * değildir ve filtre ikisini de seçili sektöre sokmaz.
 */
export function withSectors<T extends { symbol: string; sector?: string }>(
  rows: T[],
  map: SectorMap | null,
): T[] {
  if (!map) return rows;
  return rows.map((row) => {
    const sector = map.of[row.symbol];
    return sector ? { ...row, sector } : row;
  });
}

/** Haritadaki sektör adları, alfabetik — filtre listesi bunu kullanır. */
export function sectorNames(map: SectorMap | null): string[] {
  if (!map) return [];
  return [...new Set(Object.values(map.of))].sort((a, b) => a.localeCompare(b, 'tr'));
}

export interface PeerRow {
  symbol: string;
  /** İşlem değeri (kapanış × hacim). */
  value: number;
  changePct: number;
}

export interface SectorPeers {
  sector: string;
  /** Sembolün sektör içindeki işlem değeri sırası (1 = en çok işlem gören). */
  rank: number;
  total: number;
  /** İşlem değerine göre sıralı akranlar; sembolün kendisi de listede. */
  peers: PeerRow[];
  /** Sektörün işlem değeriyle ağırlıklı ortalama değişimi. */
  weightedChangePct: number;
}

/**
 * Bir sembolün sektör akranları ve içindeki konumu.
 *
 * "Bu hisse bugün %2 düştü" tek başına eksik bir cümledir: sektörü %3 düştüyse
 * hisse aslında İYİ performans göstermiştir. Akran listesi bu bağlamı veriyor.
 */
export function sectorPeers(
  rows: PeerRow[],
  map: SectorMap | null,
  symbol: string,
): SectorPeers | null {
  const sector = map?.of[symbol];
  // Sembolün sektörü bilinmiyorsa akran listesi ÜRETİLMEZ: rastgele bir grup
  // göstermek, olmayan bir bağlamı varmış gibi sunmak olurdu.
  if (!sector) return null;

  const peers = rows
    .filter((row) => map!.of[row.symbol] === sector)
    .sort((a, b) => b.value - a.value);
  if (peers.length === 0) return null;

  let value = 0;
  let weighted = 0;
  for (const peer of peers) {
    value += peer.value;
    weighted += peer.value * peer.changePct;
  }

  return {
    sector,
    rank: peers.findIndex((p) => p.symbol === symbol) + 1,
    total: peers.length,
    peers,
    weightedChangePct: value ? weighted / value : NaN,
  };
}

export function isSectorMap(value: unknown): value is SectorMap {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<SectorMap>;
  return (
    typeof m.source === 'string' &&
    typeof m.generated === 'number' &&
    !!m.of &&
    typeof m.of === 'object'
  );
}

/**
 * Sektör ROTASYONU: para hangi sektöre kayıyor?
 *
 * Tek barlık akış "bugün ne oldu" diyor. Rotasyon, bir sektörün işlem değeri
 * PAYININ bir önceki eşit pencereye göre kaç puan değiştiğini söylüyor —
 * seviyeyi değil değişimi. Bankacılığın payının büyük olması bir rotasyon
 * değildir; payının iki haftada 3 puan artması rotasyondur.
 *
 * Pay puan (pp) olarak veriliyor, yüzde değişim olarak DEĞİL: %2'den %4'e
 * çıkan bir pay "%100 arttı" diye okunursa küçük sektörler her zaman listenin
 * başında görünür. Puan farkı paranın gerçekten ne kadarının yer değiştirdiğini
 * söylüyor.
 *
 * Önceki penceresi OLMAYAN sembol (yeni işlem görmeye başlamış) toplamlara
 * girer ama önceki toplamı 0'dır; bu sektörün payını yapay olarak yükseltmesin
 * diye önceki pay HESAPLANIRKEN kendi 0'ı kullanılır — uydurma bir taban
 * atanmaz.
 */
export interface SectorRotation {
  sector: string;
  symbols: number;
  /** Penceredeki toplam işlem değeri. */
  value: number;
  /** Payı (%) — pencere toplamı üzerinden. */
  sharePct: number;
  /** Önceki penceredeki payı (%). */
  prevSharePct: number;
  /** Pay değişimi (puan). Pozitif = para bu sektöre kaydı. */
  shareShiftPp: number;
  /** İşlem değeriyle ağırlıklı pencere getirisi (%). */
  returnPct: number;
  /** Sektörün en çok işlem gören sembolü. */
  leader: string;
}

export function rotationBySector(rows: WindowRow[], map: SectorMap | null): SectorRotation[] {
  if (!map) return [];

  const groups = new Map<string, WindowRow[]>();
  for (const row of rows) {
    // Sınıflandırması olmayan sembol GİZLENMEZ: payların toplamı 100 kalsın.
    const sector = map.of[row.symbol] ?? UNCLASSIFIED;
    const list = groups.get(sector);
    if (list) list.push(row);
    else groups.set(sector, [row]);
  }

  let total = 0;
  let prevTotal = 0;
  for (const row of rows) {
    total += row.value;
    prevTotal += row.prevValue;
  }

  const out: SectorRotation[] = [];
  for (const [sector, list] of groups) {
    let value = 0;
    let prevValue = 0;
    let weighted = 0;
    for (const row of list) {
      value += row.value;
      prevValue += row.prevValue;
      weighted += row.value * row.returnPct;
    }
    const sharePct = total ? (value / total) * 100 : NaN;
    const prevSharePct = prevTotal ? (prevValue / prevTotal) * 100 : NaN;
    out.push({
      sector,
      symbols: list.length,
      value,
      sharePct,
      prevSharePct,
      shareShiftPp:
        Number.isFinite(sharePct) && Number.isFinite(prevSharePct) ? sharePct - prevSharePct : NaN,
      returnPct: value ? weighted / value : NaN,
      leader: list.reduce((a, b) => (b.value > a.value ? b : a)).symbol,
    });
  }

  // Sınıflandırılmamış grup en sonda: bir sektör değil, bir eksik.
  return out.sort((a, b) => {
    if (a.sector === UNCLASSIFIED) return 1;
    if (b.sector === UNCLASSIFIED) return -1;
    return b.value - a.value;
  });
}

/**
 * Sektör bileşik getiri serisi (EŞİT AĞIRLIKLI).
 *
 * "Bu hisse %2 düştü" eksik bir cümle; sektörü %3 düştüyse hisse aslında iyi
 * performans göstermiştir. Karşılaştırma ancak ortak bir tabana oturtulmuş
 * iki seriyle yapılabilir: her iki seri de pencerenin başında %0.
 *
 * Neden eşit ağırlık: piyasa değeri tüm semboller için elimizde yok ve işlem
 * değeriyle ağırlıklandırmak endeksi tek bir devin hareketine indirger. Eşit
 * ağırlık "ortalama hisse ne yaptı" sorusunu cevaplıyor ve arayüz bunu böyle
 * söylüyor — gizli bir ağırlıklandırma varsaymıyor.
 *
 * Başlangıç kapanışı geçersiz (0 ya da NaN) olan sembol DIŞARIDA kalıyor:
 * sıfıra bölmek sonsuz, tahmin etmek uydurma olurdu.
 */
export function compositeSeries(peers: ArrayLike<number>[], bars: number): number[] {
  if (bars < 2) return [];
  const gecerli: { seri: ArrayLike<number>; taban: number; from: number }[] = [];
  for (const seri of peers) {
    const n = seri.length;
    if (n < bars) continue;
    const from = n - bars;
    const taban = seri[from];
    if (!(taban > 0) || !Number.isFinite(taban)) continue;
    gecerli.push({ seri, taban, from });
  }
  if (gecerli.length === 0) return [];

  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    let toplam = 0;
    let sayi = 0;
    for (const { seri, taban, from } of gecerli) {
      const v = seri[from + i];
      if (!Number.isFinite(v)) continue;
      toplam += (v / taban - 1) * 100;
      sayi++;
    }
    // Hiçbir sembolün o barda değeri yoksa seri KESİLİYOR: eksik barı bir
    // öncekiyle doldurmak, olmayan bir yatay seyir çizerdi.
    out.push(sayi > 0 ? toplam / sayi : NaN);
  }
  return out;
}

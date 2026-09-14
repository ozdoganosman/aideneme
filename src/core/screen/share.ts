import { DEFAULT_SCREEN_PARAMS, type Rule, type ScreenParams } from './metrics';

/**
 * Tarama durumunun paylaşılabilir kodlaması.
 *
 * Ürün ilkesi #4: her görünüm paylaşılabilir olmalı. Kural listesi ham JSON
 * olarak URL'e yazılırsa adres okunamaz hale gelir ve tarayıcı sınırlarına
 * dayanır; burada kısa, insan gözüyle ayıklanabilir bir biçim kullanılıyor:
 *
 *   1|rsi~b~40~70!chg21~g~0|14.14.20.50|Bankacılık,Enerji|chg21~d
 *   ^ sürüm      ^ kurallar            ^ parametreler ^ sektörler ^ sıralama
 *
 * Çözme KATI ama sessiz değil: tanınmayan metrik, bozuk sayı ya da bilinmeyen
 * operatör atılır ve `dropped` ile bildirilir. Sessizce düşürmek, kullanıcının
 * paylaştığı taramadan farklı bir sonuç görmesi demek olurdu.
 */

export interface ShareState {
  rules: Rule[];
  params: ScreenParams;
  sectors: string[];
  sort: { metric: string; dir: 'asc' | 'desc' };
}

const VERSION = '1';
const OP_CODE = { gt: 'g', lt: 'l', between: 'b' } as const;
const CODE_OP: Record<string, Rule['op']> = { g: 'gt', l: 'lt', b: 'between' };

/** Parametrelerin kodlanan alanları ve sırası — biçim sözleşmesinin parçası. */
const PARAM_KEYS: (keyof ScreenParams)[] = [
  'rsiLength',
  'adxLength',
  'emaFast',
  'emaSlow',
  'atrLength',
  'volLookback',
  'highLookback',
];

const num = (v: number): string => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));

export function encodeScreen(state: ShareState): string {
  const rules = state.rules
    .map((rule) => {
      const parts = [rule.metric, OP_CODE[rule.op], num(rule.a)];
      if (rule.op === 'between') parts.push(num(rule.b ?? 0));
      return parts.join('~');
    })
    .join('!');

  // Eksik alan varsayılanla doldurulur: eski bir kayıttan gelen yarım parametre
  // nesnesi bağlantı üretimini ÇÖKERTMEMELİ (gerçek bir kusurdu, test ediliyor).
  const params = PARAM_KEYS.map((key) =>
    num(Number.isFinite(state.params[key]) ? state.params[key] : DEFAULT_SCREEN_PARAMS[key]),
  ).join('.');
  // Sektör adlarında virgül olmadığı varsayılmıyor: ayırıcı çakışırsa ad
  // bölünür ve tanınmaz; bu yüzden virgül içeren ad kodlamaya girmez.
  const sectors = state.sectors.filter((s) => !s.includes(',') && !s.includes('|')).join(',');
  const sort = `${state.sort.metric}~${state.sort.dir === 'asc' ? 'a' : 'd'}`;

  return [VERSION, rules, params, sectors, sort].join('|');
}

export interface DecodeResult {
  state: ShareState | null;
  /** Atılan parçaların insan okunur gerekçeleri. */
  dropped: string[];
}

export function decodeScreen(text: string, knownMetrics: Set<string>): DecodeResult {
  const dropped: string[] = [];
  if (!text) return { state: null, dropped };

  const [version, rulePart = '', paramPart = '', sectorPart = '', sortPart = ''] = text.split('|');
  if (version !== VERSION) {
    return { state: null, dropped: [`bağlantı biçimi tanınmadı (sürüm ${version || '?'})`] };
  }

  const rules: Rule[] = [];
  for (const chunk of rulePart.split('!').filter(Boolean)) {
    const [metric, code, a, b] = chunk.split('~');
    const op = CODE_OP[code];
    if (!knownMetrics.has(metric)) {
      dropped.push(`bilinmeyen metrik: ${metric}`);
      continue;
    }
    if (!op) {
      dropped.push(`bilinmeyen koşul: ${code}`);
      continue;
    }
    const low = Number(a);
    if (!Number.isFinite(low)) {
      dropped.push(`okunamayan değer: ${metric}`);
      continue;
    }
    const rule: Rule = { metric, op, a: low };
    if (op === 'between') {
      const high = Number(b);
      if (!Number.isFinite(high)) {
        dropped.push(`okunamayan üst sınır: ${metric}`);
        continue;
      }
      rule.b = high;
    }
    rules.push(rule);
  }

  const params = { ...DEFAULT_SCREEN_PARAMS };
  const values = paramPart.split('.');
  PARAM_KEYS.forEach((key, i) => {
    const raw = values[i];
    // Alan HİÇ YOKSA (kısa bağlantı) varsayılan sessizce kalır; alan var ama
    // okunamıyorsa varsayılana düşer ve bildirilir — taramanın tamamını çöpe
    // atmak yerine tek alanı kurtarıyoruz, ama sessizce değil.
    if (raw === undefined || raw === '') return;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) params[key] = parsed;
    else dropped.push(`okunamayan parametre: ${key}`);
  });

  const sectors = sectorPart ? sectorPart.split(',').filter(Boolean) : [];

  const [sortMetric, sortDir] = sortPart.split('~');
  const sort: ShareState['sort'] =
    sortMetric && knownMetrics.has(sortMetric)
      ? { metric: sortMetric, dir: sortDir === 'a' ? 'asc' : 'desc' }
      : { metric: 'chg21', dir: 'desc' };
  if (sortMetric && !knownMetrics.has(sortMetric)) {
    dropped.push(`bilinmeyen sıralama metriği: ${sortMetric}`);
  }

  return { state: { rules, params, sectors, sort }, dropped };
}

/**
 * Kayıtlı tarama koleksiyonu — cihazlar arası taşıma.
 *
 * Kayıtlar tarayıcıda duruyor; başka bir makineye geçen kullanıcı kitaplığını
 * kaybediyordu. Tek bir taramayı paylaşmak için bağlantı yeterli, ama
 * KOLEKSİYONU taşımak için metin biçimi gerekiyor.
 *
 * İçe aktarma KATI: tanınmayan metrik, bozuk sayı ya da adı olmayan kayıt
 * atılır ve gerekçesi bildirilir. Yarım anlaşılmış bir taramayı sessizce
 * kabul etmek, kullanıcının sandığından farklı bir filtreyle çalışması demek.
 */

export interface SavedScreen {
  name: string;
  rules: Rule[];
  params: ScreenParams;
  sectors?: string[];
}

export interface ImportResult {
  screens: SavedScreen[];
  dropped: string[];
}

const COLLECTION_VERSION = 1;

export function exportScreens(screens: SavedScreen[]): string {
  return JSON.stringify(
    {
      version: COLLECTION_VERSION,
      kind: 'borsa.screens',
      screens: screens.map((s) => ({ name: s.name, f: encodeScreen(toShare(s)) })),
    },
    null,
    2,
  );
}

function toShare(screen: SavedScreen): ShareState {
  return {
    rules: screen.rules,
    params: screen.params,
    sectors: screen.sectors ?? [],
    sort: { metric: 'chg21', dir: 'desc' },
  };
}

export function importScreens(text: string, knownMetrics: Set<string>): ImportResult {
  const dropped: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { screens: [], dropped: ['metin JSON olarak okunamadı'] };
  }

  const root = parsed as { version?: unknown; kind?: unknown; screens?: unknown };
  if (root?.kind !== 'borsa.screens') {
    return { screens: [], dropped: ['bu metin bir tarama koleksiyonu değil'] };
  }
  if (root.version !== COLLECTION_VERSION) {
    return { screens: [], dropped: [`koleksiyon sürümü tanınmadı (${String(root.version)})`] };
  }
  if (!Array.isArray(root.screens)) {
    return { screens: [], dropped: ['koleksiyon listesi bulunamadı'] };
  }

  const screens: SavedScreen[] = [];
  for (const [index, raw] of root.screens.entries()) {
    const item = raw as { name?: unknown; f?: unknown };
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name) {
      dropped.push(`${index + 1}. kayıtta ad yok`);
      continue;
    }
    if (typeof item?.f !== 'string') {
      dropped.push(`"${name}": filtre okunamadı`);
      continue;
    }
    const decoded = decodeScreen(item.f, knownMetrics);
    if (!decoded.state) {
      dropped.push(`"${name}": ${decoded.dropped.join(', ') || 'çözülemedi'}`);
      continue;
    }
    for (const reason of decoded.dropped) dropped.push(`"${name}": ${reason}`);
    screens.push({
      name,
      rules: decoded.state.rules,
      params: decoded.state.params,
      sectors: decoded.state.sectors,
    });
  }

  return { screens, dropped };
}

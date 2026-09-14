import type { Condition, Operand, Strategy } from './dsl';

/**
 * Stratejinin paylaşılabilir kodlaması.
 *
 * Laboratuvarda kurulan kural şimdiye kadar yalnızca ekranda yaşıyordu; "şuna
 * bir bak" diye bağlantı göndermek mümkün değildi. Biçim, tarama bağlantısıyla
 * aynı ilkeyi izliyor: kısa ama gözle ayıklanabilir.
 *
 *   1|c~x~ema50!rsi14~l~k30|c~L~ema50*0.97|8_0_14_3
 *   ^sürüm ^giriş          ^çıkış       ^stop_hedef_atrUzunluk_atrKat
 *
 * Operand: `c` kapanış, `ema50` gösterge, `k30` sabit, `*0.97` ölçek,
 * `@1` bir bar geri. Sarmalayıcı sırası her zaman scale(prev(taban)) —
 * aynı kural her zaman aynı metne dönüşür.
 *
 * Kodlanamayan bir kural SESSİZCE BASİTLEŞTİRİLMEZ; kodlayıcı metin yerine
 * gerekçe döndürür, çünkü yanlış bir bağlantı paylaşmak hiç bağlantı
 * paylaşmamaktan kötüdür.
 */

const PRICE_CODE: Record<string, string> = {
  close: 'c',
  open: 'o',
  high: 'h',
  low: 'l',
  volume: 'v',
};
const CODE_PRICE: Record<string, Operand['kind']> = {
  c: 'close',
  o: 'open',
  h: 'high',
  l: 'low',
  v: 'volume',
};

const OP_CODE: Record<string, string> = {
  gt: 'g',
  gte: 'G',
  lt: 'l',
  lte: 'L',
  crossAbove: 'x',
  crossBelow: 'y',
};
const CODE_OP: Record<string, 'gt' | 'gte' | 'lt' | 'lte' | 'crossAbove' | 'crossBelow'> = {
  g: 'gt',
  G: 'gte',
  l: 'lt',
  L: 'lte',
  x: 'crossAbove',
  y: 'crossBelow',
};

const INDICATORS = new Set(['ema', 'sma', 'rsi', 'adx', 'atr', 'roc', 'highest', 'lowest']);
const num = (v: number): string => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));

function encodeOperand(operand: Operand): string | null {
  let factor = 1;
  let shift = 0;
  let base = operand;
  // Sarmalayıcıları soy; sıra önemsiz, yeniden kurarken kanonik sıraya konur.
  for (let guard = 0; guard < 8; guard++) {
    if (base.kind === 'scale') {
      factor *= base.factor;
      base = base.of;
    } else if (base.kind === 'prev') {
      shift += base.bars;
      base = base.of;
    } else break;
  }

  let text: string;
  if (base.kind === 'const') text = `k${num(base.value)}`;
  else if (PRICE_CODE[base.kind]) text = PRICE_CODE[base.kind];
  else if (INDICATORS.has(base.kind) && 'length' in base) text = `${base.kind}${base.length}`;
  else return null;

  if (shift > 0) text += `@${shift}`;
  if (factor !== 1) text += `*${num(factor)}`;
  return text;
}

function decodeOperand(text: string): Operand | null {
  if (!text) return null;
  let rest = text;
  let factor = 1;
  let shift = 0;

  const star = rest.indexOf('*');
  if (star >= 0) {
    const parsed = Number(rest.slice(star + 1));
    if (!Number.isFinite(parsed) || parsed === 0) return null;
    factor = parsed;
    rest = rest.slice(0, star);
  }
  const at = rest.indexOf('@');
  if (at >= 0) {
    const parsed = Number(rest.slice(at + 1));
    if (!Number.isInteger(parsed) || parsed < 0) return null;
    shift = parsed;
    rest = rest.slice(0, at);
  }

  let base: Operand | null = null;
  if (rest.startsWith('k')) {
    const value = Number(rest.slice(1));
    base = Number.isFinite(value) ? { kind: 'const', value } : null;
  } else if (CODE_PRICE[rest]) {
    base = { kind: CODE_PRICE[rest] } as Operand;
  } else {
    const match = /^([a-z]+)(\d+)$/.exec(rest);
    if (match && INDICATORS.has(match[1])) {
      base = { kind: match[1] as 'ema', length: Number(match[2]) };
    }
  }
  if (!base) return null;

  let out = base;
  if (shift > 0) out = { kind: 'prev', of: out, bars: shift };
  if (factor !== 1) out = { kind: 'scale', of: out, factor };
  return out;
}

export interface EncodeResult {
  text: string;
  /** Kodlanamayan parçalar; boş değilse text de boştur. */
  unsupported: string[];
}

function encodeCondition(condition: Condition, unsupported: string[]): string {
  switch (condition.op) {
    case 'all':
      return condition.of.map((c) => encodeCondition(c, unsupported)).join('!');
    case 'any':
      unsupported.push('VEYA bağlacı');
      return '';
    case 'not':
      unsupported.push('DEĞİL bağlacı');
      return '';
    default: {
      const code = OP_CODE[condition.op];
      const left = encodeOperand(condition.left);
      const right = encodeOperand(condition.right);
      if (!code || !left || !right) {
        unsupported.push(`kodlanamayan kural (${condition.op})`);
        return '';
      }
      // Operatör `~` ile AYRILIR: kodlar (x, l, g…) gösterge adlarının içinde de
      // geçiyor ("adx" içindeki x), bitişik yazılsa kural yanlış bölünürdü.
      return `${left}~${code}~${right}`;
    }
  }
}

export function encodeStrategy(strategy: Strategy): EncodeResult {
  const unsupported: string[] = [];
  const entry = encodeCondition(strategy.entry, unsupported);
  const exit = strategy.exit ? encodeCondition(strategy.exit, unsupported) : '';
  if (unsupported.length > 0) return { text: '', unsupported };

  // Ayırıcı `_`: ondalıklı bir kat (2.5) nokta ile ayrılsaydı alanlara bölünür
  // ve sessizce 2'ye yuvarlanırdı — gerçek bir kusurdu, test altında.
  const stops = [
    num(strategy.stopLossPct ?? 0),
    num(strategy.takeProfitPct ?? 0),
    num(strategy.atrStop?.length ?? 14),
    num(strategy.atrStop?.mult ?? 0),
  ].join('_');

  return { text: ['1', entry, exit, stops].join('|'), unsupported: [] };
}

export interface DecodeStrategyResult {
  strategy: Strategy | null;
  dropped: string[];
}

function decodeCondition(text: string, dropped: string[], label: string): Condition | null {
  const parts = text.split('!').filter(Boolean);
  const conditions: Condition[] = [];
  for (const part of parts) {
    const match = /^(.+)~([gGlLxy])~(.+)$/.exec(part);
    if (!match) {
      dropped.push(`${label}: okunamayan kural`);
      continue;
    }
    const left = decodeOperand(match[1]);
    const right = decodeOperand(match[3]);
    const op = CODE_OP[match[2]];
    if (!left || !right || !op) {
      dropped.push(`${label}: okunamayan kural (${part})`);
      continue;
    }
    conditions.push({ op, left, right });
  }
  if (conditions.length === 0) return null;
  return { op: 'all', of: conditions };
}

export function decodeStrategy(text: string): DecodeStrategyResult {
  const dropped: string[] = [];
  if (!text) return { strategy: null, dropped };

  const [version, entryPart = '', exitPart = '', stopPart = ''] = text.split('|');
  if (version !== '1') {
    return { strategy: null, dropped: [`bağlantı biçimi tanınmadı (sürüm ${version || '?'})`] };
  }

  const entry = decodeCondition(entryPart, dropped, 'giriş');
  if (!entry) {
    dropped.push('giriş kuralı okunamadı; strateji uygulanmadı');
    return { strategy: null, dropped };
  }
  const exit = exitPart ? decodeCondition(exitPart, dropped, 'çıkış') : null;

  const [stop, target, atrLength, atrMult] = stopPart.split('_').map(Number);
  const strategy: Strategy = {
    entry,
    exit: exit ?? undefined,
    stopLossPct: Number.isFinite(stop) && stop > 0 ? stop : undefined,
    takeProfitPct: Number.isFinite(target) && target > 0 ? target : undefined,
    atrStop:
      Number.isFinite(atrMult) && atrMult > 0
        ? { length: Number.isFinite(atrLength) && atrLength > 1 ? atrLength : 14, mult: atrMult }
        : undefined,
  };
  return { strategy, dropped };
}

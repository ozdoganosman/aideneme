import type { Strategy } from './dsl';

/**
 * Hazır strateji kitaplığı.
 *
 * Amaç "en iyi stratejiyi vermek" değil; piyasa genelinde **aynı kurallarla**
 * ölçülen bir karşılaştırma tabanı kurmak. Her strateji tek cümlede ne yaptığını
 * ve hangi piyasa görüşüne dayandığını söyler; kullanıcı sıralamaya bakarken
 * "bu neyi varsayıyor?" sorusunu kaybetmesin.
 *
 * Hepsi DSL nesnesi: JSON'a serileşir, laboratuvara olduğu gibi yüklenir,
 * parametresi kullanıcı tarafından değiştirilebilir.
 */

export interface StrategyPreset {
  id: string;
  name: string;
  /** Tek cümlelik kural özeti. */
  detail: string;
  /** Hangi piyasa görüşüne dayanıyor. */
  premise: string;
  strategy: Strategy;
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: 'ema-cross',
    name: 'EMA 20/50 kesişimi',
    detail: 'EMA(20) EMA(50) üstüne çıkınca al, altına inince sat.',
    premise: 'Trendler süreklidir: başlayan hareket bir süre devam eder.',
    strategy: {
      name: 'EMA 20/50 kesişimi',
      entry: {
        op: 'crossAbove',
        left: { kind: 'ema', length: 20 },
        right: { kind: 'ema', length: 50 },
      },
      exit: {
        op: 'crossBelow',
        left: { kind: 'ema', length: 20 },
        right: { kind: 'ema', length: 50 },
      },
    },
  },
  {
    id: 'golden-cross',
    name: 'Altın kesişim 50/200',
    detail: 'EMA(50) EMA(200) üstüne çıkınca al, altına inince sat.',
    premise: 'Uzun vadeli rejim değişimi; az sinyal, uzun tutuş.',
    strategy: {
      name: 'Altın kesişim 50/200',
      entry: {
        op: 'crossAbove',
        left: { kind: 'ema', length: 50 },
        right: { kind: 'ema', length: 200 },
      },
      exit: {
        op: 'crossBelow',
        left: { kind: 'ema', length: 50 },
        right: { kind: 'ema', length: 200 },
      },
    },
  },
  {
    id: 'breakout-55',
    name: '55 bar kırılımı',
    detail: 'Fiyat son 55 barın en yükseğini aşınca al, 20 bar dibine inince sat.',
    premise: 'Donchian tipi kırılım: yeni zirve, yeni bilgi demektir.',
    strategy: {
      name: '55 bar kırılımı',
      entry: { op: 'gt', left: { kind: 'close' }, right: { kind: 'highest', length: 55 } },
      exit: { op: 'lt', left: { kind: 'close' }, right: { kind: 'lowest', length: 20 } },
      atrStop: { length: 14, mult: 3 },
    },
  },
  {
    id: 'rsi-reversion',
    name: 'RSI dip alımı',
    detail: 'RSI(14) 30 altına inince al, 55 üstüne çıkınca sat.',
    premise: 'Aşırı satım geri çeker: kısa vadeli ortalamaya dönüş.',
    strategy: {
      name: 'RSI dip alımı',
      entry: { op: 'lt', left: { kind: 'rsi', length: 14 }, right: { kind: 'const', value: 30 } },
      exit: { op: 'gt', left: { kind: 'rsi', length: 14 }, right: { kind: 'const', value: 55 } },
      stopLossPct: 10,
    },
  },
  {
    id: 'trend-pullback',
    name: 'Trendde geri çekilme',
    detail: 'Fiyat EMA(200) üstündeyken RSI(14) 40 altına inince al, RSI 60 üstünde sat.',
    premise: 'Yükselen trendde geçici zayıflık fırsattır; trend filtresi yönü sabitler.',
    strategy: {
      name: 'Trendde geri çekilme',
      entry: {
        op: 'all',
        of: [
          { op: 'gt', left: { kind: 'close' }, right: { kind: 'ema', length: 200 } },
          { op: 'lt', left: { kind: 'rsi', length: 14 }, right: { kind: 'const', value: 40 } },
        ],
      },
      exit: { op: 'gt', left: { kind: 'rsi', length: 14 }, right: { kind: 'const', value: 60 } },
      stopLossPct: 8,
    },
  },
  {
    id: 'momentum-adx',
    name: 'Güçlü momentum',
    detail: '63 barlık getiri pozitif ve ADX(14) 25 üstündeyken al; momentum negatife dönünce sat.',
    premise: 'Momentum yalnızca trend güçlüyken çalışır; ADX gücü ölçer.',
    strategy: {
      name: 'Güçlü momentum',
      entry: {
        op: 'all',
        of: [
          { op: 'gt', left: { kind: 'roc', length: 63 }, right: { kind: 'const', value: 0 } },
          { op: 'gt', left: { kind: 'adx', length: 14 }, right: { kind: 'const', value: 25 } },
        ],
      },
      exit: { op: 'lt', left: { kind: 'roc', length: 21 }, right: { kind: 'const', value: 0 } },
      atrStop: { length: 14, mult: 2.5 },
    },
  },
  {
    id: 'ema-trend-hold',
    name: 'EMA 50 üstünde kal',
    detail: 'Fiyat EMA(50) üstüne çıkınca al, EMA(50)’nin %97’sinin altına inince sat.',
    premise: 'Basit trend takibi; küçük gürültüde çıkmamak için eşikte pay var.',
    strategy: {
      name: 'EMA 50 üstünde kal',
      entry: {
        op: 'crossAbove',
        left: { kind: 'close' },
        right: { kind: 'ema', length: 50 },
      },
      exit: {
        op: 'lt',
        left: { kind: 'close' },
        right: { kind: 'scale', of: { kind: 'ema', length: 50 }, factor: 0.97 },
      },
    },
  },
  {
    id: 'new-high-momentum',
    name: 'Yeni zirve momentumu',
    detail: 'Fiyat 250 barlık zirveye değince al, 50 bar dibine inince sat.',
    premise: '52 hafta zirvesi etkisi: zirvedeki hisse daha çok yükselir.',
    strategy: {
      name: 'Yeni zirve momentumu',
      entry: {
        op: 'gte',
        left: { kind: 'close' },
        right: { kind: 'highest', length: 250 },
      },
      exit: { op: 'lt', left: { kind: 'close' }, right: { kind: 'lowest', length: 50 } },
      atrStop: { length: 14, mult: 3 },
    },
  },
];

export const PRESET_BY_ID = new Map(STRATEGY_PRESETS.map((p) => [p.id, p]));

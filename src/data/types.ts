// Columnar OHLCV storage (struct of typed arrays). Cache-friendly for the
// per-frame decimation scan and cheap to hold millions of bars.
export interface Candles {
  time: Float64Array; // unix seconds, ascending
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  length: number;
}

export function emptyCandles(n: number): Candles {
  return {
    time: new Float64Array(n),
    open: new Float64Array(n),
    high: new Float64Array(n),
    low: new Float64Array(n),
    close: new Float64Array(n),
    volume: new Float64Array(n),
    length: n,
  };
}

export interface Timeframe {
  label: string;
  binance: string;
  yahoo: string; // Yahoo has no 4h; it falls back to 60m
  seconds: number;
}

export const TIMEFRAMES: Timeframe[] = [
  { label: '1m', binance: '1m', yahoo: '1m', seconds: 60 },
  { label: '5m', binance: '5m', yahoo: '5m', seconds: 300 },
  { label: '15m', binance: '15m', yahoo: '15m', seconds: 900 },
  { label: '1h', binance: '1h', yahoo: '60m', seconds: 3600 },
  { label: '4h', binance: '4h', yahoo: '60m', seconds: 14400 },
  { label: '1d', binance: '1d', yahoo: '1d', seconds: 86400 },
];

export interface LiveBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

// A small built-in symbol list so autocomplete works before/without the full
// Binance list (and in synthetic mode).
export const BUILTIN_SYMBOLS: string[] = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT',
  'AVAXUSDT', 'LINKUSDT', 'TRXUSDT', 'DOTUSDT', 'LTCUSDT', 'MATICUSDT', 'SHIBUSDT',
  'BCHUSDT', 'UNIUSDT', 'XLMUSDT', 'ATOMUSDT', 'ETCUSDT', 'FILUSDT', 'APTUSDT',
  'NEARUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT', 'SUIUSDT', 'AAVEUSDT', 'PEPEUSDT',
  'WIFUSDT', 'TIAUSDT', 'SEIUSDT', 'RNDRUSDT', 'FETUSDT', 'IMXUSDT',
];

// Popular Borsa İstanbul tickers for autocomplete (Yahoo symbols add ".IS").
export const BIST_SYMBOLS: string[] = [
  'THYAO', 'GARAN', 'AKBNK', 'ASELS', 'KCHOL', 'SISE', 'EREGL', 'BIMAS', 'SAHOL',
  'TUPRS', 'FROTO', 'PGSUS', 'TCELL', 'ISCTR', 'YKBNK', 'KOZAL', 'KOZAA', 'SASA',
  'HEKTS', 'TOASO', 'TTKOM', 'PETKM', 'ENKAI', 'KRDMD', 'VESTL', 'GUBRF', 'ARCLK',
  'OYAKC', 'TAVHL', 'DOHOL', 'EKGYO', 'ALARK', 'MGROS', 'ULKER', 'SOKM', 'TKFEN',
  'AEFES', 'BRSAN', 'KONTR', 'SMRTG', 'ODAS', 'XU100', 'XU030',
];

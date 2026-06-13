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
  seconds: number;
}

export const TIMEFRAMES: Timeframe[] = [
  { label: '1m', binance: '1m', seconds: 60 },
  { label: '5m', binance: '5m', seconds: 300 },
  { label: '15m', binance: '15m', seconds: 900 },
  { label: '1h', binance: '1h', seconds: 3600 },
  { label: '4h', binance: '4h', seconds: 14400 },
  { label: '1d', binance: '1d', seconds: 86400 },
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

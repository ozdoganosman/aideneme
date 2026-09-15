import { emptyCandles, type Candles } from './types';

/**
 * Kolonsal ikili OHLCV formatı — çözücü/kodlayıcı.
 * Sözleşme ve gerekçeler: docs/plan/veri-formati.md
 * Üretici eşi: scripts/pack_data.py (aynı bayt düzeni, fixture ile kilitli).
 *
 * Saf: ağ yok, DOM yok. Ana thread'de de Worker'da da aynı kod çalışır.
 */

export const DAY_SECONDS = 86400;

const SERIES_MAGIC = 0x31535242; // 'BRS1' little-endian
const BUNDLE_MAGIC = 0x42535242; // 'BRSB'
export const PACK_VERSION = 1;
const SERIES_HEADER = 32;
const BUNDLE_HEADER = 24;
const COLUMNS = 5; // o, h, l, c, v

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`pack: ${message}`);
}

/** Bir sembolün tam geçmişi → Candles (zaman saniye, UTC gece yarısı). */
export function decodeSeries(buf: ArrayBuffer): Candles {
  check(buf.byteLength >= SERIES_HEADER, 'dosya çok kısa');
  const head = new DataView(buf);
  check(head.getUint32(0, true) === SERIES_MAGIC, 'sihirli sayı tutmuyor');
  const version = head.getUint16(4, true);
  check(version === PACK_VERSION, `desteklenmeyen sürüm: ${version}`);

  const n = head.getUint32(8, true);
  const expected = SERIES_HEADER + n * (4 + COLUMNS * 4);
  check(buf.byteLength >= expected, `beklenen ${expected} bayt, gelen ${buf.byteLength}`);

  const days = new Int32Array(buf, SERIES_HEADER, n);
  const out = emptyCandles(n);
  for (let i = 0; i < n; i++) out.time[i] = days[i] * DAY_SECONDS;

  const targets = [out.open, out.high, out.low, out.close, out.volume];
  let offset = SERIES_HEADER + n * 4;
  for (const target of targets) {
    const col = new Float32Array(buf, offset, n);
    for (let i = 0; i < n; i++) target[i] = col[i];
    offset += n * 4;
  }
  return out;
}

/** Candles → .bin (testler ve ileride istemci tarafı önbellek için). */
export function encodeSeries(c: Candles): ArrayBuffer {
  const n = c.length;
  const buf = new ArrayBuffer(SERIES_HEADER + n * (4 + COLUMNS * 4));
  const head = new DataView(buf);
  head.setUint32(0, SERIES_MAGIC, true);
  head.setUint16(4, PACK_VERSION, true);
  head.setUint16(6, 1, true); // bayrak: hacim var
  head.setUint32(8, n, true);

  const days = new Int32Array(buf, SERIES_HEADER, n);
  for (let i = 0; i < n; i++) days[i] = Math.floor(c.time[i] / DAY_SECONDS);
  head.setInt32(12, n ? days[0] : 0, true);
  head.setInt32(16, n ? days[n - 1] : 0, true);

  let offset = SERIES_HEADER + n * 4;
  for (const source of [c.open, c.high, c.low, c.close, c.volume]) {
    new Float32Array(buf, offset, n).set(source);
    offset += n * 4;
  }
  return buf;
}

export interface Bundle {
  /** Alfabetik sembol listesi. */
  names: string[];
  /** Ortak gün ekseni (epoch gün), artan. */
  days: Int32Array;
  bars: number;
  /** Sembolün o gündeki kapanışı; veri yoksa NaN. */
  closeAt: (symbolIndex: number, dayIndex: number) => number;
  /**
   * Sembolü Candles'a çevirir. Veri olmayan günler ATILIR (doldurulmaz) —
   * seri dosyasıyla aynı anlam: takvim boşluğu boşluk olarak kalır.
   */
  seriesOf: (symbol: string) => Candles | null;
}

/** Tüm sembollerin son N barı — tek istekle piyasa geneli. */
export function decodeBundle(buf: ArrayBuffer): Bundle {
  check(buf.byteLength >= BUNDLE_HEADER, 'paket çok kısa');
  const head = new DataView(buf);
  check(head.getUint32(0, true) === BUNDLE_MAGIC, 'sihirli sayı tutmuyor');
  const version = head.getUint16(4, true);
  check(version === PACK_VERSION, `desteklenmeyen sürüm: ${version}`);

  const bars = head.getUint16(6, true);
  const count = head.getUint32(8, true);
  const namesLen = head.getUint32(12, true);

  // Uzunluk kontrolü görünümleri KURMADAN önce: kırpılmış bir dosyada
  // `new Uint8Array(buf, ...)` "Invalid typed array length" diye patlıyor ve
  // kullanıcı motor hatası görüyordu. Kendi mesajımız ne olduğunu söylüyor.
  check(
    buf.byteLength >= BUNDLE_HEADER + namesLen,
    `sembol adları için ${BUNDLE_HEADER + namesLen} bayt gerekiyor, gelen ${buf.byteLength}`,
  );
  const nameBytes = new Uint8Array(buf, BUNDLE_HEADER, namesLen);
  let end = nameBytes.length;
  while (end > 0 && nameBytes[end - 1] === 0) end--; // hizalama dolgusunu at
  const names = new TextDecoder().decode(nameBytes.subarray(0, end)).split('\n');
  check(names.length === count, `sembol sayısı tutmuyor: ${names.length} ≠ ${count}`);

  let offset = BUNDLE_HEADER + namesLen;
  check(
    buf.byteLength >= offset + bars * 4,
    `gün ekseni için ${offset + bars * 4} bayt gerekiyor, gelen ${buf.byteLength}`,
  );
  const days = new Int32Array(buf, offset, bars);
  offset += bars * 4;

  const cells = count * bars;
  const expected = offset + COLUMNS * cells * 4;
  check(buf.byteLength >= expected, `beklenen ${expected} bayt, gelen ${buf.byteLength}`);

  const cols: Float32Array[] = [];
  for (let c = 0; c < COLUMNS; c++) {
    cols.push(new Float32Array(buf, offset, cells));
    offset += cells * 4;
  }
  const [open, high, low, close, volume] = cols;
  const indexOf = new Map(names.map((name, i) => [name, i]));

  return {
    names,
    days,
    bars,
    closeAt: (si, di) => close[si * bars + di],
    seriesOf(symbol) {
      const si = indexOf.get(symbol);
      if (si === undefined) return null;
      const base = si * bars;

      let n = 0;
      for (let i = 0; i < bars; i++) if (Number.isFinite(close[base + i])) n++;

      const out = emptyCandles(n);
      let k = 0;
      for (let i = 0; i < bars; i++) {
        const v = close[base + i];
        if (!Number.isFinite(v)) continue;
        out.time[k] = days[i] * DAY_SECONDS;
        out.open[k] = open[base + i];
        out.high[k] = high[base + i];
        out.low[k] = low[base + i];
        out.close[k] = v;
        out.volume[k] = volume[base + i];
        k++;
      }
      return out;
    },
  };
}

export interface BundleInput {
  symbols: string[];
  /** Ortak gün ekseni (epoch gün). */
  days: Int32Array | number[];
  /** Her biri symbols.length × days.length; veri yoksa NaN. */
  columns: {
    open: ArrayLike<number>;
    high: ArrayLike<number>;
    low: ArrayLike<number>;
    close: ArrayLike<number>;
    volume: ArrayLike<number>;
  };
}

/**
 * Paket kodlayıcı — Python üreticisiyle aynı bayt düzeni.
 * Testlerde kullanılıyor; aynı zamanda formatın simetrik (yazılabilir) olduğunu
 * kanıtlıyor: fixture'ı çözüp yeniden kodlamak birebir aynı baytları vermeli.
 */
export function encodeBundle(input: BundleInput): ArrayBuffer {
  const count = input.symbols.length;
  const bars = input.days.length;
  const nameBytes = new TextEncoder().encode(input.symbols.join('\n'));
  const namesLen = nameBytes.length + (((-nameBytes.length % 4) + 4) % 4);
  const cells = count * bars;

  const buf = new ArrayBuffer(BUNDLE_HEADER + namesLen + bars * 4 + COLUMNS * cells * 4);
  const head = new DataView(buf);
  head.setUint32(0, BUNDLE_MAGIC, true);
  head.setUint16(4, PACK_VERSION, true);
  head.setUint16(6, bars, true);
  head.setUint32(8, count, true);
  head.setUint32(12, namesLen, true);

  new Uint8Array(buf, BUNDLE_HEADER, nameBytes.length).set(nameBytes);

  let offset = BUNDLE_HEADER + namesLen;
  new Int32Array(buf, offset, bars).set(input.days as ArrayLike<number> as number[]);
  offset += bars * 4;

  for (const column of [
    input.columns.open,
    input.columns.high,
    input.columns.low,
    input.columns.close,
    input.columns.volume,
  ]) {
    new Float32Array(buf, offset, cells).set(column as ArrayLike<number> as number[]);
    offset += cells * 4;
  }
  return buf;
}

export interface ManifestEntry {
  /** Dosya adı. */
  f: string;
  /** Bar sayısı. */
  n: number;
  /** İlk/son bar (epoch gün). */
  d0: number;
  d1: number;
  /** Bayt. */
  b: number;
  /** İçerik hash'i — önbellek anahtarı + cache-busting. */
  h: string;
  /**
   * 1 ise bu sembol bir ENDEKS (XU100, XBANK, …), hisse değil.
   *
   * Manifest'te duruyor ki grafikte açılabilsin ve portföy ona göre
   * kıyaslanabilsin; ama tarama paketinde (`bundle`) yok — hisse tarayan
   * ekranların evreni paketten geliyor. İsteğe bağlı: eski manifest'lerde
   * alan yok ve bu bir kusur değil, o sürümde eleme yapılmıyordu.
   */
  e?: number;
}

export interface Manifest {
  version: number;
  market: string;
  /** Üretim zamanı (unix saniye). */
  generated: number;
  bundle?: { file: string; bars: number; bytes: number; hash: string };
  /**
   * SEKTÖR ENDEKSİ paketi — yalnızca endeks serileri, son N bar.
   *
   * Ana paketten ayrı, çünkü ana paket "tarama evreni" ve endeksler oraya
   * girmemeli. İsteğe bağlı: endeksi olmayan bir piyasada (ABD, kripto) alan
   * hiç yazılmaz ve bu bir kusur değildir.
   */
  indices?: { file: string; bars: number; bytes: number; hash: string; symbols: number };
  symbols: Record<string, ManifestEntry>;
}

/** Manifest'in beklenen şekilde olduğunu doğrular (bozuk dosya sessizce geçmesin). */
export function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<Manifest>;
  return (
    m.version === PACK_VERSION &&
    typeof m.market === 'string' &&
    typeof m.generated === 'number' &&
    !!m.symbols &&
    typeof m.symbols === 'object'
  );
}

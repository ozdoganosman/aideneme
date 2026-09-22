import type { ScreenParams, ScreenRow } from '../core/screen/metrics';
import type { OlcutIstegi } from '../core/screen/indikatorOlcut';
import type { IndBundle, IndicatorParams } from '../core/indicators/calc';
import type { Parametreler } from '../core/indicators/kayit';
import type { PulseRow, PulseSummary, WindowRow } from '../core/screen/pulse';
import type { SektorEslesmesi } from '../core/screen/sectorIndices';
import type { Candles } from '../core/data/types';
import type { HealthReport } from '../core/data/health';
import type { Metric } from '../core/stats/summary';
import type { TF } from '../core/data/resample';

/**
 * Ana thread ↔ Worker sözleşmesi. Tek dosyada tutuluyor ki iki uç tip düzeyinde
 * bağlı kalsın: mesaj biçimi değişirse her iki taraf da derlenmez.
 */

export interface InitRequest {
  id: number;
  type: 'init';
  market: string;
  /** Paket dosyasının ham baytları (worker başına bir kopya). */
  buffer: ArrayBuffer;
}

export interface ScreenRequest {
  id: number;
  type: 'screen';
  market: string;
  params: ScreenParams;
  /** Bu worker'ın hesaplayacağı sembol aralığı [from, to). */
  from: number;
  to: number;
}

export interface CorrelateRequest {
  id: number;
  type: 'correlate';
  market: string;
  /** Son N barı kullan (0 = tümü). */
  lookback: number;
  minPairs?: number;
  /** Alt küme; verilmezse tüm semboller. */
  symbols?: string[];
  /** Kümeleme kesme eşiği (uzaklık = 1 − korelasyon). */
  threshold?: number;
}

export interface PulseRequest {
  id: number;
  type: 'pulse';
  market: string;
  /** Yeni zirve/dip penceresi (bar). */
  window?: number;
  minBars?: number;
  /**
   * Rotasyon penceresi (bar). Verilirse sembol başına pencere toplamları da
   * döner — sektör rotasyonu bunlardan hesaplanıyor. Verilmezse HESAPLANMAZ:
   * tek barlık nabza bakan kullanıcı 200 sembollük ikinci bir döngüyü
   * boşuna ödemesin.
   */
  rotationBars?: number;
}

/**
 * Sektör eşleşmesi: her hissenin en çok birlikte hareket ettiği sektör
 * endeksi. Worker'da, çünkü gerçek veride ölçüldü — 599 hisse × 23 endeks
 * 246 ms sürüyor ve bu ana iş parçacığında zayıf makinede ~1,5 saniyelik
 * donma demek.
 */
export interface SectorMatchRequest {
  id: number;
  type: 'sectorMatch';
  market: string;
  /** Sektör endeksi paketinin ham baytları (ayrı ve küçük paket). */
  indexBuffer: ArrayBuffer;
  /** Bu korelasyonun altındaki eşleşme BİLDİRİLMEZ. */
  esik?: number;
}

export interface IndikatorIstegi {
  /** Örneğin kimliği — sonuçlar bununla eşleniyor. */
  ornekId: string;
  /** Kayıt defterindeki tanımın kimliği. */
  id: string;
  parametreler: Parametreler;
}

export interface SymbolRequest {
  id: number;
  type: 'symbol';
  /** Günlük seri (tam geçmiş). */
  candles: Candles;
  /** İstenen periyot; yeniden örnekleme worker'da yapılır. */
  tf: TF;
  /** Hesaplanacak EMA benzeri örtüler. */
  overlays: { key: string; length: number }[];
  /**
   * Fiyatın ALTINDAKİ panellere çizilecek indikatörler için parametreler.
   *
   * Verilmezse hesaplanmıyor: kullanıcı paneli kapalıyken 3650 barlık iki
   * indikatörü hesaplamak boşa iş. Parametreler dışarıdan geliyor çünkü
   * ayarlanabilir olmaları isteniyor ve worker'ın varsayılan tutması
   * arayüzle ikinci bir gerçek kaynağı olurdu.
   */
  indicators?: IndicatorParams;
  /**
   * KAYIT DEFTERİNDEN gelen göstergeler.
   *
   * Sabit `indicators` alanı iki panelin on üç sayısını taşıyordu; bu alan
   * kullanıcının EKLEDİĞİ örnekleri taşıyor — aynı gösterge farklı
   * parametrelerle birden çok kez olabilir, bu yüzden `ornekId` var.
   * Boşsa hiçbiri hesaplanmıyor.
   */
  indikatorler?: IndikatorIstegi[];
  /** Bugün (epoch gün) — sağlık raporu saf kalsın diye dışarıdan gelir. */
  todayDay: number;
  /** TL bazlı piyasada reel getiri metriği eklensin mi. */
  realReturn: boolean;
}

/**
 * Grafikteki göstergelerin piyasa genelinde ölçülmesi.
 *
 * Taramadan AYRI bir istek. Kullanıcı bir göstergeyi radara eklediğinde tüm
 * taramayı yeniden koşturmak, zaten hesaplanmış on üç temel metriği 600
 * sembolde boşuna yeniden hesaplamak olurdu; bu istek yalnızca istenen
 * göstergeleri ölçüp sembol başına birkaç sayı döndürüyor.
 */
export interface GostergeOlcutRequest {
  id: number;
  type: 'gostergeOlcut';
  market: string;
  istekler: OlcutIstegi[];
  /** Bu worker'ın hesaplayacağı sembol aralığı [from, to). */
  from: number;
  to: number;
}

export interface GostergeOlcutResponse {
  id: number;
  ok: true;
  type: 'gostergeOlcut';
  rows: { symbol: string; values: Record<string, number> }[];
  ms: number;
}

/**
 * Filtre zaman makinesi: taramayı GEÇMİŞ bir güne kurar.
 *
 * `geri` ortak gün ekseninde kaç gün geriye gidileceği (0 = bugün). Kesim
 * bar indeksiyle değil TARİHLE yapılıyor: her sembol kendi sonlu
 * kapanışlarına sıkıştırılmış olduğu için "sondan k. bar" sembolden sembole
 * farklı takvim gününe düşer (bkz. core/data/kes.ts).
 *
 * Gösterge ölçütleri de aynı kesik seriden hesaplanıyor; ileri getiri
 * `ileriGetiri` ölçütü olarak satıra yazılıyor ki radar onu sütun ve
 * sıralama olarak bedavaya alsın.
 */
export interface ZamanMakinesiRequest {
  id: number;
  type: 'zamanMakinesi';
  market: string;
  params: ScreenParams;
  /** Ortak eksende kaç gün geri; 0 = bugün. */
  geri: number;
  istekler?: OlcutIstegi[];
  from: number;
  to: number;
}

export interface ZamanMakinesiResponse {
  id: number;
  ok: true;
  type: 'zamanMakinesi';
  rows: ScreenRow[];
  /** Kesim gününün epoch günü — arayüz tarihi buradan yazıyor. */
  gun: number;
  ms: number;
}

export type WorkerRequest =
  | InitRequest
  | GostergeOlcutRequest
  | ZamanMakinesiRequest
  | ScreenRequest
  | CorrelateRequest
  | PulseRequest
  | SectorMatchRequest
  | SymbolRequest;

export interface InitResponse {
  id: number;
  ok: true;
  type: 'init';
  symbols: string[];
  bars: number;
}

export interface ScreenResponse {
  id: number;
  ok: true;
  type: 'screen';
  rows: ScreenRow[];
  /** Worker'da geçen süre (ms) — performans bütçesi bunun üstünden ölçülür. */
  ms: number;
}

export interface CorrelateResponse {
  id: number;
  ok: true;
  type: 'correlate';
  symbols: string[];
  matrix: Float64Array;
  order: number[];
  clusterOf: number[];
  clusters: number;
  ms: number;
}

export interface ErrorResponse {
  id: number;
  ok: false;
  error: string;
}

export interface PulseResponse {
  id: number;
  ok: true;
  type: 'pulse';
  rows: PulseRow[];
  summary: PulseSummary;
  /** `rotationBars` istendiyse: sembol başına pencere toplamları. */
  windows?: WindowRow[];
  ms: number;
}

export interface SymbolResponse {
  id: number;
  ok: true;
  type: 'symbol';
  /** Periyoda indirgenmiş seri — grafik bunu çizer. */
  candles: Candles;
  metrics: Metric[];
  health: HealthReport;
  /** overlays isteğiyle aynı sırada. */
  overlayValues: Float64Array[];
  /** İstenmişse: Williams %R ve NizamiCedid MACD serileri. */
  indicators?: IndBundle;
  /**
   * Örnek kimliği → çıktı dizileri (tanımın `ciktilar` sırasıyla).
   *
   * Tanımı bilinmeyen bir kimlik istenirse o örnek sonuçta YOKTUR; arayüz
   * "hesaplanmadı" ile "sıfır çıktı"yı ayırt edebilsin diye sessizce boş
   * dizi konmuyor.
   */
  indikatorDegerleri?: Record<string, Float64Array[]>;
  ms: number;
}

export interface SectorMatchResponse {
  id: number;
  ok: true;
  type: 'sectorMatch';
  matches: SektorEslesmesi[];
  /** Eşiği geçen / değerlendirilen hisse sayısı — kapsama şeffaf olsun. */
  evaluated: number;
  ms: number;
}

export type WorkerResponse =
  | InitResponse
  | GostergeOlcutResponse
  | ZamanMakinesiResponse
  | SectorMatchResponse
  | SymbolResponse
  | ScreenResponse
  | CorrelateResponse
  | PulseResponse
  | ErrorResponse;

import { computeIndicators } from '../core/indicators/calc';
import { decodeBundle, type Bundle } from '../core/data/pack';
import type { Candles } from '../core/data/types';
import { metricsFor, type ScreenRow } from '../core/screen/metrics';
import {
  pulseRow,
  summarizePulse,
  windowRow,
  type PulseRow,
  type WindowRow,
} from '../core/screen/pulse';
import { clusterSymbols, correlationMatrix } from '../core/stats/correlation';
import { sektorEslesmeleri } from '../core/screen/sectorIndices';
import { inspect } from '../core/data/health';
import { resample } from '../core/data/resample';
import { emaArr } from '../core/indicators/calc';
import { summarize } from '../core/stats/summary';
import { INDIKATOR_ILE, parametreSinirla } from '../core/indicators/kayit';
import { HESAPLAR } from '../core/indicators/kayitHesap';
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * Worker'ın beyni — DOM'suz, `self`'siz saf fonksiyon fabrikası.
 * Böylece aynı kod hem gerçek Worker'da hem de testte (Worker olmadan) koşar.
 */
export function createHandler() {
  const bundles = new Map<string, Bundle>();

  return function handle(req: WorkerRequest): WorkerResponse {
    try {
      switch (req.type) {
        case 'init': {
          const bundle = decodeBundle(req.buffer);
          bundles.set(req.market, bundle);
          return { id: req.id, ok: true, type: 'init', symbols: bundle.names, bars: bundle.bars };
        }

        case 'screen': {
          const started = now();
          const bundle = need(bundles, req.market);
          const rows: ScreenRow[] = [];
          const to = Math.min(req.to, bundle.names.length);
          for (let i = req.from; i < to; i++) {
            const symbol = bundle.names[i];
            const candles = bundle.seriesOf(symbol);
            if (!candles) continue;
            const row = metricsFor(symbol, candles, req.params);
            if (row) rows.push(row);
          }
          return { id: req.id, ok: true, type: 'screen', rows, ms: now() - started };
        }

        case 'sectorMatch': {
          const started = now();
          const bundle = need(bundles, req.market);
          const endeksPaketi = decodeBundle(req.indexBuffer);

          // Haritalar burada kuruluyor: paket zaten worker'da, seriyi ana iş
          // parçacığına taşıyıp geri göndermek kopyalama masrafı olurdu.
          const hisseler = new Map<string, Candles>();
          for (const ad of bundle.names) {
            const c = bundle.seriesOf(ad);
            if (c) hisseler.set(ad, c);
          }
          const endeksler = new Map<string, Candles>();
          for (const ad of endeksPaketi.names) {
            const c = endeksPaketi.seriesOf(ad);
            if (c) endeksler.set(ad, c);
          }

          const matches = sektorEslesmeleri(hisseler, endeksler, { esik: req.esik });
          return {
            id: req.id,
            ok: true,
            type: 'sectorMatch',
            matches,
            evaluated: hisseler.size,
            ms: now() - started,
          };
        }

        case 'pulse': {
          const started = now();
          const bundle = need(bundles, req.market);
          const rows: PulseRow[] = [];
          const windows: WindowRow[] = [];
          for (const symbol of bundle.names) {
            const candles = bundle.seriesOf(symbol);
            if (!candles) continue;
            const row = pulseRow(symbol, candles, {
              window: req.window,
              minBars: req.minBars,
            });
            if (row) rows.push(row);
            // Pencere toplamları AYNI çözümlemede: paket zaten burada, seriyi
            // ikinci kez kurmak boşuna iş olurdu.
            if (req.rotationBars) {
              const w = windowRow(symbol, candles, req.rotationBars);
              if (w) windows.push(w);
            }
          }
          return {
            id: req.id,
            ok: true,
            type: 'pulse',
            rows,
            summary: summarizePulse(rows),
            windows: req.rotationBars ? windows : undefined,
            ms: now() - started,
          };
        }

        case 'symbol': {
          const started = now();
          // Yeniden örnekleme + indikatör + özet + sağlık: hepsi burada.
          // Ana iş parçacığında yapıldığında zayıf makinede ~150 ms'lik tek
          // parça blok oluşturuyordu (ölçüldü).
          const resampled = resample(req.candles, req.tf);
          return {
            id: req.id,
            ok: true,
            type: 'symbol',
            candles: resampled,
            metrics: summarize(resampled, { realReturn: req.realReturn }),
            health: inspect(req.candles, { today: req.todayDay }),
            overlayValues: req.overlays.map((o) => emaArr(resampled.close, o.length)),
            // Panel kapalıyken hesaplanmıyor: 3650 barlık iki indikatör boşa iş.
            indicators: req.indicators ? computeIndicators(resampled, req.indicators) : undefined,
            indikatorDegerleri: req.indikatorler?.length
              ? indikatorlariHesapla(resampled, req.indikatorler)
              : undefined,
            ms: now() - started,
          };
        }

        case 'correlate': {
          const started = now();
          const bundle = need(bundles, req.market);
          const wanted = req.symbols?.length ? req.symbols : bundle.names;
          const symbols = wanted.filter((s) => bundle.names.includes(s));

          // Paketin ortak gün eksenindeki kapanışları, istenen sembol sırasıyla.
          const bars = bundle.bars;
          const close = new Float64Array(symbols.length * bars);
          symbols.forEach((symbol, s) => {
            const si = bundle.names.indexOf(symbol);
            for (let i = 0; i < bars; i++) close[s * bars + i] = bundle.closeAt(si, i);
          });

          const { matrix } = correlationMatrix(
            { symbols, bars, close },
            { lookback: req.lookback, minPairs: req.minPairs },
          );
          const clustered = clusterSymbols(matrix, symbols.length, req.threshold ?? 0.6);

          return {
            id: req.id,
            ok: true,
            type: 'correlate',
            symbols,
            matrix,
            order: clustered.order,
            clusterOf: clustered.clusterOf,
            clusters: clustered.count,
            ms: now() - started,
          };
        }
      }
    } catch (err) {
      return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

/**
 * Kayıt defterindeki göstergeleri örnek örnek hesapla.
 *
 * Tanımı bilinmeyen kimlik ATLANIYOR: eski bir bağlantıdan ya da silinmiş bir
 * kullanıcı göstergesinden gelen kimlik yüzünden tüm sembol isteği düşmesin.
 * Arayüz sonuçta olmayan örneği "hesaplanmadı" diye gösterebilir.
 *
 * Parametreler burada da sınırlanıyor: worker'a ne geldiğine güvenmek, tek
 * bozuk sayının sessizce boş bir çizgiye dönüşmesi demekti.
 */
function indikatorlariHesapla(
  c: Candles,
  istekler: { ornekId: string; id: string; parametreler: Record<string, number> }[],
): Record<string, Float64Array[]> {
  const out: Record<string, Float64Array[]> = {};
  for (const istek of istekler) {
    const tanim = INDIKATOR_ILE.get(istek.id);
    const hesap = HESAPLAR[istek.id];
    if (!tanim || !hesap) continue;
    out[istek.ornekId] = hesap(c, parametreSinirla(tanim, istek.parametreler));
  }
  return out;
}

function need(bundles: Map<string, Bundle>, market: string): Bundle {
  const bundle = bundles.get(market);
  if (!bundle) throw new Error(`${market}: worker'a paket yüklenmedi (önce init)`);
  return bundle;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

import { useEffect, useRef, useState } from 'react';
import { dataClient } from '../data-client/client';
import { type Market } from '../data-client/markets';
import { AnalysisClient } from '../workers/analysisClient';

/**
 * Paketi bir kez indirip worker havuzuna yükler; ekranlar bu hazır istemciyi
 * kullanır. Paket indirme (ağ + IndexedDB) veri istemcisinde, hesap worker'da —
 * ana iş parçacığı yalnızca çizer.
 *
 * Sözleşme: `client` kimliği sabittir (yüklenene kadar null, sonra aynı nesne).
 */
export interface AnalysisState {
  client: AnalysisClient | null;
  symbols: string[];
  bars: number;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /**
   * Paket indirme ilerlemesi. Yavaş bağlantıda 1 MB'lık paket 20 saniye
   * sürebiliyor ve ekran bu süre boyunca "hesaplanıyor" diyordu: hem yanlış
   * (indiriyoruz, hesaplamıyoruz) hem de kullanıcıya bekleyeceği sürenin
   * büyüklüğünü göstermiyordu.
   */
  progress: { loaded: number; total: number } | null;
}

export interface UseAnalysisOptions {
  /**
   * Paket (latest-N) indirilsin mi. Yalnızca tek sembolle çalışan ekranlar
   * (ör. Sembol Masası) worker havuzuna ihtiyaç duyar ama pakete duymaz;
   * boşuna ~1 MB indirmek zayıf bağlantıda ilk açılışı uzatır.
   */
  bundle?: boolean;
}

export function useAnalysis(market: Market, options: UseAnalysisOptions = {}): AnalysisState {
  const withBundle = options.bundle !== false;
  const [state, setState] = useState<AnalysisState>({
    client: null,
    symbols: [],
    bars: 0,
    status: 'loading',
    error: null,
    progress: null,
  });
  const clientRef = useRef<AnalysisClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState((s) => ({ ...s, status: 'loading', error: null }));

    (async () => {
      try {
        const manifest = await dataClient.manifest(market, controller.signal);

        if (!withBundle) {
          // Paketsiz mod: worker havuzu kurulur, semboller manifest'ten gelir.
          clientRef.current?.terminate();
          const client = new AnalysisClient();
          clientRef.current = client;
          if (cancelled) return;
          setState({
            client,
            symbols: Object.keys(manifest.symbols).sort(),
            bars: 0,
            status: 'ready',
            error: null,
            progress: null,
          });
          return;
        }

        if (!manifest.bundle) throw new Error(`${market}: paket dosyası üretilmemiş`);

        // İndirme ve ÖNBELLEK veri istemcisinde: kabuk kendi fetch'ini
        // yazdığı sürece aynı paket her ziyarette yeniden iniyordu (ölçüldü).
        const { buffer } = await dataClient.bundleBuffer(
          market,
          controller.signal,
          (loaded, total) => {
            if (!cancelled) setState((s) => ({ ...s, progress: { loaded, total } }));
          },
        );
        if (cancelled) return;

        clientRef.current?.terminate();
        const client = new AnalysisClient();
        clientRef.current = client;
        const info = await client.load(market, buffer);
        if (cancelled) return;

        setState({
          client,
          symbols: info.symbols,
          bars: info.bars,
          status: 'ready',
          error: null,
          progress: null,
        });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setState({
          client: null,
          symbols: [],
          bars: 0,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          progress: null,
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [market, withBundle]);

  // Ekran kapanınca worker'lar bırakılır.
  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  return state;
}

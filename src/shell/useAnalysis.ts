import { useEffect, useRef, useState } from 'react';
import { dataClient } from '../data-client/client';
import { packPath, type Market } from '../data-client/markets';
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
}

export function useAnalysis(market: Market): AnalysisState {
  const [state, setState] = useState<AnalysisState>({
    client: null,
    symbols: [],
    bars: 0,
    status: 'loading',
    error: null,
  });
  const clientRef = useRef<AnalysisClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState((s) => ({ ...s, status: 'loading', error: null }));

    (async () => {
      try {
        const manifest = await dataClient.manifest(market, controller.signal);
        if (!manifest.bundle) throw new Error(`${market}: paket dosyası üretilmemiş`);

        const url = packPath(market, `${manifest.bundle.file}?h=${manifest.bundle.hash}`);
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Paket indirilemedi (HTTP ${res.status})`);
        const buffer = await res.arrayBuffer();
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
        });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setState({
          client: null,
          symbols: [],
          bars: 0,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [market]);

  // Ekran kapanınca worker'lar bırakılır.
  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);

  return state;
}

import type { Candles } from '../../core/data/types';
import { LineChart } from './LineChart';

export interface NormalizedSeries {
  symbol: string;
  color: string;
  candles: Candles;
}

export interface NormalizedChartProps {
  series: NormalizedSeries[];
  height?: number;
}

/**
 * Normalize getiri grafiği: tüm seriler ortak başlangıçta %0'a eşitlenir,
 * böylece fiyat seviyeleri değil GÖRECELİ performans karşılaştırılır.
 * Çizim işi ortak LineChart'ta — tek canvas uygulaması.
 */
export function NormalizedChart({ series, height = 280 }: NormalizedChartProps) {
  return (
    <LineChart
      normalize
      height={height}
      ariaLabel={`Normalize getiri karşılaştırması: ${series.map((s) => s.symbol).join(', ')}`}
      series={series.map((s) => ({
        label: s.symbol,
        color: s.color,
        time: s.candles.time,
        values: s.candles.close,
      }))}
    />
  );
}

import { trNum } from '../ui';
import type { AnalysisState } from './useAnalysis';

// `toFixed` İNGİLİZCE ondalık üretir ("1.2 MB"). Ürünün geri kalanı Türkçe
// biçimde ve bu satır yalnızca indirme SIRASINDA görünüyor — biçim denetimi
// onu bu yüzden hiç yakalayamamıştı.
const kb = (bytes: number): string =>
  bytes >= 1_048_576 ? `${trNum(bytes / 1_048_576, 1)} MB` : `${Math.round(bytes / 1024)} KB`;

/**
 * Paket indirme ilerlemesi.
 *
 * Yavaş bağlantıda 1 MB'lık paket 20 saniye sürebiliyor; ekran o süre boyunca
 * "hesaplanıyor" diyordu. İki kusur birden: yanlış (indiriliyor, hesaplanmıyor)
 * ve ölçüsüz (kullanıcı ne kadar bekleyeceğini bilmiyor). İlerleme bilinmiyorsa
 * bu bileşen hiçbir şey göstermiyor — sahte bir çubuk çizmiyor.
 */
export function LoadNote({ progress }: { progress: AnalysisState['progress'] }) {
  if (!progress || progress.total <= 0) return null;
  const pct = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
  return (
    <span className="desk__muted" role="status">
      Veri paketi indiriliyor — {kb(progress.loaded)} / {kb(progress.total)} (%{pct})
    </span>
  );
}

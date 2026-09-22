import { EmptyState } from '../ui';
import { Icon } from '../ui/icons';

/**
 * Veri yüklenemediğinde gösterilen tek bileşen.
 *
 * Üç ekran (Stratejiler, Model, Rapor) hata durumunda SONSUZA KADAR iskelet
 * gösteriyordu: kullanıcı yüklenmeyi bekliyor sanıyor, oysa istek çoktan
 * başarısız olmuş. Sessiz başarısızlık, yanlış sayı göstermenin bir adım
 * gerisindeki kusurdur.
 *
 * Araç çubuğu ekranda KALIYOR (bu bileşen içerik alanına giriyor): piyasa ya
 * da sembol değiştirerek toparlanmak mümkün olsun.
 */
export function DataError({ title, detail }: { title: string; detail?: string | null }) {
  return (
    <EmptyState
      tone="error"
      icon={<Icon name="alert" size={28} />}
      title={title}
      description={detail ?? ''}
    />
  );
}

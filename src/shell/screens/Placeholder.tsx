import { Badge, EmptyState } from '../../ui';
import { Icon } from '../../ui/icons';
import type { Screen } from '../nav';
import { SCREEN_PLAN } from './plan';

/**
 * Faz 1 kabuğunun ekran içeriği. Bilinçli olarak boş: gezinme, tema, klavye ve
 * paylaşılabilir URL bu iskelet üzerinde doğrulanır; veri Faz 2'de gelir.
 */
export function Placeholder({ screen }: { screen: Screen }) {
  const items = SCREEN_PLAN[screen.id] ?? [];
  return (
    <div className="shell-placeholder">
      <EmptyState
        icon={<Icon name={screen.icon} size={28} />}
        title={screen.question}
        description={
          <>
            Bu ekran <Badge tone="accent">{screen.phase}</Badge> ile doluyor. Kabuk hazır — veri
            katmanı bağlanınca içerik buraya gelecek.
          </>
        }
      />
      {items.length > 0 ? (
        <section className="shell-placeholder__plan" aria-label={`${screen.label} planı`}>
          <h3>Buraya gelecek</h3>
          <ul>
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

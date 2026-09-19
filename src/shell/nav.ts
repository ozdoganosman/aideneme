/**
 * Bilgi mimarisi — 7 ekran. Kabuk buradan üretilir: ray navigasyonu, komut
 * paleti girdileri ve URL'deki `v` parametresi hep bu listeden gelir.
 */
import type { IconName } from '../ui/icons';

export interface Screen {
  id: string;
  label: string;
  icon: IconName;
  /** Ekranın cevapladığı soru — boş durum metinlerinde de bu kullanılır. */
  question: string;
  /** Dolduğu faz (bkz. docs/plan/next-gen-finans-platformu.md §7). */
  phase: string;
  hidden?: boolean;
}

export const SCREENS: Screen[] = [
  {
    id: 'nabiz',
    label: 'Nabız',
    icon: 'pulse',
    question: 'Piyasada bugün ne oluyor?',
    phase: 'Faz 3',
  },
  {
    id: 'sembol',
    label: 'Sembol Masası',
    icon: 'candles',
    question: 'Bu hisse ne durumda?',
    phase: 'Faz 2',
  },
  {
    id: 'tarayici',
    label: 'Tarayıcı',
    icon: 'search',
    question: 'Kriterlerime uyan hisseler hangileri?',
    phase: 'Faz 3',
  },
  {
    id: 'karsilastir',
    label: 'Karşılaştır',
    icon: 'compare',
    question: 'Bunlar birbirine göre nasıl?',
    phase: 'Faz 3',
  },
  {
    id: 'portfoy',
    label: 'Portföy',
    icon: 'wallet',
    question: 'Param nerede, riskim ne?',
    phase: 'Faz 5',
  },
  {
    id: 'rapor',
    label: 'Rapor',
    icon: 'report',
    question: 'Bunu nasıl paylaşırım?',
    phase: 'Faz 6',
  },
  {
    id: 'kitaplik',
    label: 'UI Kitaplığı',
    icon: 'swatch',
    question: 'Tasarım sistemi neye benziyor?',
    phase: 'Faz 1',
    hidden: true,
  },
];

export const DEFAULT_SCREEN = 'nabiz';

export function screenById(id: string): Screen {
  return SCREENS.find((s) => s.id === id) ?? SCREENS[0];
}

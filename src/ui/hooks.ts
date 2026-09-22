import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Odaklanabilir öğeler — odak tuzağı ve ilk odak için ortak seçici. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(root: HTMLElement): HTMLElement[] {
  // Görünürlük için offsetParent'a bakmak cazip ama kırılgan: position:fixed
  // öğelerde tarayıcı null döndürür, jsdom ise yerleşim hesaplamadığı için her
  // zaman null verir. Gizlemenin anlamsal işaretlerine bakmak her ikisinde de
  // doğru çalışır.
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute('hidden') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.closest('[hidden]') === null,
  );
}

/**
 * Diyalog/sheet için odak tuzağı: açılışta ilk odaklanabilir öğeye gider,
 * Tab döngüsü kabın dışına çıkmaz, kapanışta odak tetikleyen öğeye döner.
 * Modal bir yüzeyi klavyeyle kullanılabilir kılan şey budur.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const previous = document.activeElement as HTMLElement | null;
    const first = focusable(root)[0] ?? root;
    first.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !root) return;
      const items = focusable(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus?.();
    };
  }, [ref, active]);
}

/** Esc ile kapatma — tüm katmanlı yüzeylerde aynı davranış. */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscape();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, onEscape]);
}

/** Dışarı tıklayınca kapat (popover/combobox). */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  active = true,
  /**
   * Ek "dışarıda mı" sorusu. Portal ile GÖVDEYE taşınan bir panel, kökün
   * DOM alt ağacında değildir; onsuz panele tıklamak "dışarı" sayılır ve
   * panel kendi kendini kapatır.
   */
  ayricaDisarida?: (hedef: Node) => boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      const hedef = e.target as Node;
      if (!el || el.contains(hedef)) return;
      if (ayricaDisarida && !ayricaDisarida(hedef)) return;
      onOutside();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ref, onOutside, active, ayricaDisarida]);
}

/** Medya sorgusu — tek responsive ağaç için (ayrı mobil bileşen yok). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export interface VirtualWindow {
  start: number;
  end: number;
  padTop: number;
  totalHeight: number;
  onScroll: () => void;
}

/**
 * Sabit satır yüksekliğinde pencereleme. 600+ satırlık tarama tabloları için
 * bağımlılık eklemeden yeterli: DOM'da yalnızca görünen satırlar durur.
 */
export function useVirtualRows(
  scrollRef: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  overscan = 6,
): VirtualWindow {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 40) });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    const viewport = el?.clientHeight || 400;
    const scrollTop = el?.scrollTop || 0;
    const visible = Math.ceil(viewport / rowHeight);
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(count, start + visible + overscan * 2);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [scrollRef, count, rowHeight, overscan]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef, measure]);

  return {
    start: range.start,
    end: range.end,
    padTop: range.start * rowHeight,
    totalHeight: count * rowHeight,
    onScroll: measure,
  };
}

/** Bir değeri geciktir (arama kutuları için). */
export function useDebounced<T>(value: T, ms = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Değişmeyen kimlik üreteci (label ↔ input bağlama). */
let idCounter = 0;
export function useAutoId(prefix: string): string {
  const ref = useRef<string>('');
  if (!ref.current) ref.current = `${prefix}-${++idCounter}`;
  return ref.current;
}

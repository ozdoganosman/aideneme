import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Tone = 'info' | 'success' | 'warn' | 'error';

interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}

interface ToastApi {
  show: (text: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Geçici bildirim. Canlı bölge role="status" → ekran okuyucu sessizce duyurur. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const show = useCallback((text: string, tone: Tone = 'info') => {
    const id = ++seq.current;
    setItems((list) => [...list, { id, text, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`ui-toast ui-toast--${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast, <ToastProvider> içinde kullanılmalı');
  return ctx;
}

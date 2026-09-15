import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui';

/**
 * "Bağlantıyı kopyala" — her görünümün paylaşılabilir olması (ürün ilkesi #4)
 * yalnızca URL'in doğru olmasıyla bitmiyor; kullanıcının ona ULAŞMASI da kolay
 * olmalı. Adres çubuğundan kopyalamak, uzun ve yüzde kodlu bir bağlantıda
 * güvenilir bir iş değil.
 *
 * Kopyalama başarısız olursa (izin yok, güvenli olmayan bağlam) düğme sessizce
 * "kopyalandı" DEMEZ; hata durumunu gösterir.
 */
export function CopyLink({ label = 'Bağlantıyı kopyala' }: { label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState('ok');
    } catch {
      setState('error');
    }
    timer.current = setTimeout(() => setState('idle'), 2500);
  }

  return (
    <Button onClick={copy} title={state === 'error' ? 'Panoya erişilemedi' : undefined}>
      {state === 'ok' ? 'Kopyalandı' : state === 'error' ? 'Kopyalanamadı' : label}
    </Button>
  );
}

import type { ReactNode } from 'react';
import { Popover } from '../ui';

/**
 * "Bu sayı nereden geliyor?" katmanı.
 *
 * Ürün ilkesi #2 her sayının tıklanabilir olmasını istiyor; Sembol Masası'nda
 * bu yapısaldı (metrik formülünü kendisi taşıyor) ama Laboratuvar, Model ve
 * Nabız'ın bazı kartlarında hiç yoktu. Tek bileşene toplandı ki yeni bir kart
 * eklerken "provenance nasıl yazılıyordu" sorusu çıkmasın.
 */
export function Prov({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover
      title={label}
      align="start"
      trigger={(p) => (
        <button
          type="button"
          className="desk__prov"
          {...p}
          aria-label={`${label}: bu sayı nereden geliyor?`}
        >
          ?
        </button>
      )}
    >
      {children}
    </Popover>
  );
}

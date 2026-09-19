import type { KeyboardEvent } from 'react';

/**
 * Tıklanabilir ama düğme OLMAYAN öğeler için klavye desteği.
 *
 * Devralınan ekranlarda kart ve satırlar `<div onClick>` ile yapılmış: fareyle
 * çalışıyor, klavyeyle çalışmıyordu — sekme ile üzerine gelinemiyor, Enter
 * hiçbir şey yapmıyordu. Bu yardımcı üçünü birden veriyor:
 *
 *   role="button"  — ekran okuyucu "düğme" der
 *   tabIndex=0     — sekme sırasına girer
 *   Enter / Space  — etkinleştirir (düğmenin yerleşik davranışı)
 *
 * Not: doğrusu gerçek bir `<button>` kullanmaktır. Bu kartların içinde başka
 * düğmeler olduğu için (iç içe düğme geçersiz HTML) burada rol veriliyor.
 */
export function clickable(onActivate: () => void, label?: string) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      // Space sayfayı kaydırmasın; düğme davranışı bu.
      e.preventDefault();
      onActivate();
    },
    ...(label ? { 'aria-label': label } : {}),
  };
}

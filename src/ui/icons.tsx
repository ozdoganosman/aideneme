import type { SVGProps } from 'react';

/**
 * İkon seti — satır içi SVG. Emoji/glyph kullanmıyoruz: platforma göre farklı
 * çiziliyor, hizası kayıyor ve renk devralmıyor. Hepsi 24'lük ızgarada, 1.5
 * kalınlıkta çizgi, currentColor ile boyanır.
 */
export type IconName =
  | 'pulse'
  | 'candles'
  | 'search'
  | 'compare'
  | 'flask'
  | 'wallet'
  | 'report'
  | 'swatch'
  | 'sun'
  | 'moon'
  | 'auto'
  | 'star'
  | 'refresh'
  | 'close'
  | 'model'
  | 'rank'
  | 'alert';

const PATHS: Record<IconName, string> = {
  pulse: 'M3 12h3.5l2.5-7 4 14 2.5-7H21',
  candles:
    'M7 4v3m0 10v3M7 7h0a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM17 3v5m0 8v5m0-13h0a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  compare: 'M4 8h13M14 5l3 3-3 3M20 16H7m3 3-3-3 3-3',
  flask: 'M10 3v6L5 18a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 18l-5-9V3M9 3h6M7.5 14h9',
  wallet: 'M4 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zM16 12h3M4 9h15',
  report: 'M7 3h7l5 5v13H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h7M9 17h5',
  swatch: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  sun: 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
  auto: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18a9 9 0 0 0 0-18z',
  star: 'M12 4l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z',
  refresh: 'M20 11a8 8 0 1 0-.6 4M20 5v6h-6',
  close: 'M6 6l12 12M18 6 6 18',
  model:
    'M6 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 14.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 8.5l8 2.5M8 15.5l8-2.5',
  rank: 'M4 20h16M7 20V9M12 20V4M17 20v-7',
  alert: 'M12 4 2.5 20h19L12 4zM12 10v4m0 3h.01',
};

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

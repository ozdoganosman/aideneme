import type { ReactNode } from 'react';
import { trNum, trPct } from './format';

type Tone = 'neutral' | 'up' | 'down' | 'warn' | 'info' | 'accent';

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  /** Renk tek başına anlam taşımamalı — işaret/ikon burada. */
  icon?: ReactNode;
  title?: string;
}

export function Badge({ tone = 'neutral', icon, children, title }: BadgeProps) {
  return (
    <span className={`ui-badge ui-badge--${tone}`} title={title}>
      {icon ? (
        <span className="ui-badge__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export interface StatProps {
  label: string;
  value: ReactNode;
  /** Değişim: yüzde ya da mutlak; işaretine göre renk + ok. */
  delta?: number;
  deltaSuffix?: string;
  hint?: ReactNode;
  /** "Bu sayı nereden geliyor?" katmanı (Popover ile doldurulur). */
  provenance?: ReactNode;
}

export function Stat({ label, value, delta, deltaSuffix = '%', hint, provenance }: StatProps) {
  const dir = delta == null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
  return (
    <div className="ui-stat">
      <div className="ui-stat__label">
        {label}
        {provenance ? <span className="ui-stat__prov">{provenance}</span> : null}
      </div>
      <div className="ui-stat__value num">{value}</div>
      {delta != null ? (
        <div className={`ui-stat__delta is-${dir}`}>
          <span aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'}</span>
          <span className="num">
            {deltaSuffix === '%'
              ? trPct(delta, 2, true)
              : `${delta > 0 ? '+' : ''}${trNum(delta, 2)}${deltaSuffix}`}
          </span>
        </div>
      ) : null}
      {hint ? <div className="ui-stat__hint">{hint}</div> : null}
    </div>
  );
}

export interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
  count?: number;
}

/** Yükleme iskeleti — boş ekran yerine yerleşimi önceden gösterir. */
export function Skeleton({ width = '100%', height = '14px', radius, count = 1 }: SkeletonProps) {
  return (
    <span className="ui-skeleton-group" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="ui-skeleton"
          style={{ width, height, borderRadius: radius ?? 'var(--radius-sm)' }}
        />
      ))}
    </span>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'error';
}

/** Boş / hata durumu. Her veri gösteren yüzeyin dört durumundan ikisi burada. */
export function EmptyState({
  icon = '◌',
  title,
  description,
  action,
  tone = 'neutral',
}: EmptyStateProps) {
  return (
    <div className={`ui-empty ui-empty--${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      {icon ? (
        <div className="ui-empty__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="ui-empty__title">{title}</h3>
      {description ? <p className="ui-empty__desc">{description}</p> : null}
      {action ? <div className="ui-empty__action">{action}</div> : null}
    </div>
  );
}

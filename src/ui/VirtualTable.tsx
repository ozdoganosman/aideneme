import { useRef, type ReactNode } from 'react';
import { useVirtualRows } from './hooks';

export interface Column<T> {
  key: string;
  header: string;
  /** Sayısal sütunlar sağa yaslanır ve tabular hizalanır. */
  numeric?: boolean;
  width?: string;
  render: (row: T) => ReactNode;
  /** Sıralama anahtarı; verilmezse sütun sıralanamaz. */
  sortValue?: (row: T) => number | string;
}

export interface VirtualTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  label: string;
  rowHeight?: number;
  height?: number | string;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSortChange?: (sort: { key: string; dir: 'asc' | 'desc' }) => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}

/**
 * Pencerelenmiş tablo. 600+ satırlık tarama sonucunda DOM'da yalnızca görünen
 * satırlar durur; üstte/altta boşluk satırları kaydırma çubuğunu doğru tutar.
 *
 * Neden transform değil de boşluk satırı: gerçek bir <table> + yapışkan <thead>
 * korunuyor, böylece aria-sort başlık hücresinde (tek doğru yeri) durabiliyor.
 * Satır tıklaması ilk sütundaki gerçek düğmeye bağlanır — fare kadar klavye de
 * çalışır, <tr>'ye sahte "button" rolü takmaya gerek kalmaz.
 */
export function VirtualTable<T>({
  rows,
  columns,
  rowKey,
  label,
  rowHeight = 34,
  height = '100%',
  sort,
  onSortChange,
  onRowClick,
  empty,
}: VirtualTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualRows(scrollRef, rows.length, rowHeight);
  const visible = rows.slice(v.start, v.end);
  const padBottom = Math.max(0, (rows.length - v.end) * rowHeight);

  function toggleSort(col: Column<T>) {
    if (!col.sortValue || !onSortChange) return;
    const dir = sort?.key === col.key && sort.dir === 'desc' ? 'asc' : 'desc';
    onSortChange({ key: col.key, dir });
  }

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className="ui-vtable" style={{ height }}>
      <div
        className="ui-vtable__scroll"
        ref={scrollRef}
        onScroll={v.onScroll}
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        <table className="ui-vtable__table">
          <caption className="visually-hidden">{label}</caption>
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => {
                const sorted = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={c.numeric ? 'num' : undefined}
                    aria-sort={
                      sorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                  >
                    {c.sortValue && onSortChange ? (
                      <button
                        type="button"
                        className="ui-vtable__sort"
                        onClick={() => toggleSort(c)}
                      >
                        {c.header}
                        <span aria-hidden="true">
                          {sorted ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </span>
                      </button>
                    ) : (
                      // Sıralanamayan başlıklar da aynı iç boşluğu almalı; yoksa
                      // komşu sütunun başlığına yapışıyor.
                      <span className="ui-vtable__label">{c.header}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {v.padTop > 0 ? (
              <tr aria-hidden="true" style={{ height: v.padTop }}>
                <td colSpan={columns.length} />
              </tr>
            ) : null}

            {visible.map((row) => (
              <tr key={rowKey(row)} style={{ height: rowHeight }}>
                {columns.map((c, i) => (
                  <td key={c.key} className={c.numeric ? 'num' : undefined}>
                    {i === 0 && onRowClick ? (
                      <button
                        type="button"
                        className="ui-vtable__rowbtn"
                        onClick={() => onRowClick(row)}
                      >
                        {c.render(row)}
                      </button>
                    ) : (
                      c.render(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}

            {padBottom > 0 ? (
              <tr aria-hidden="true" style={{ height: padBottom }}>
                <td colSpan={columns.length} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Sıralama yardımcı: sütunun sortValue'suna göre kopya dizi döndürür. */
export function sortRows<T>(
  rows: T[],
  columns: Column<T>[],
  sort: { key: string; dir: 'asc' | 'desc' } | undefined,
): T[] {
  if (!sort) return rows;
  const col = columns.find((c) => c.key === sort.key);
  if (!col?.sortValue) return rows;
  const get = col.sortValue;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (typeof x === 'number' && typeof y === 'number') {
      if (Number.isNaN(x)) return 1;
      if (Number.isNaN(y)) return -1;
      return (x - y) * sign;
    }
    return String(x).localeCompare(String(y), 'tr') * sign;
  });
}

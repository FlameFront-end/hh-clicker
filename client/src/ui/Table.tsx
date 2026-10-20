import type { ReactNode } from 'react';
import s from './Ui.module.css';

export interface Col<T> { key: string; label: string; sort?: boolean; render: (row: T) => ReactNode; nowrap?: boolean; width?: number }

export function SortTable<T>({ cols, rows, sort, onSort, rowKey }: {
  cols: Col<T>[]; rows: T[]; sort: { field: string; dir: 1 | -1 }; onSort: (f: string) => void; rowKey: (r: T, i: number) => string;
}) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.sort ? s.sortable : ''} style={c.width ? { width: c.width } : undefined} onClick={c.sort ? () => onSort(c.key) : undefined}>
                {c.label}{c.sort && (sort.field === c.key ? (sort.dir === -1 ? ' ↓' : ' ↑') : <span style={{ opacity: .35 }}> ↕</span>)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)}>
              {cols.map((c) => <td key={c.key} className={c.nowrap ? s.nowrap : ''}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function sortRows<T>(rows: T[], sort: { field: string; dir: 1 | -1 }): T[] {
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sort.field] ?? '';
    const bv = (b as Record<string, unknown>)[sort.field] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
    return String(av).localeCompare(String(bv), 'ru') * sort.dir;
  });
}

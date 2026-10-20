import { useApp, useT } from '@/store/app';
import { fmtInt } from '@/lib/format';
import styles from './Kpi.module.css';

export function Kpi() {
  const t = useT();
  const g = useApp((s) => s.snapshot?.global_stats);
  const items: [string, number, string | undefined][] = [
    [t('gs_found'), g?.total_found ?? 0, ''],
    [t('gs_applied'), g?.total_sent ?? 0, styles.ok],
    [t('gs_tests'), g?.total_tests ?? 0, ''],
    [t('gs_errors'), g?.total_errors ?? 0, (g?.total_errors ?? 0) > 0 ? styles.bad : ''],
    [t('gs_in_db'), g?.storage_total ?? 0, ''],
    [t('gs_in_db_tests'), g?.storage_tests ?? 0, ''],
  ];
  return (
    <div className={styles.strip}>
      {items.map(([l, v, c]) => (
        <div key={l} className={styles.cell}>
          <div className={`${styles.val} ${c ?? ''} tnum`}>{fmtInt(v)}</div>
          <div className={styles.lbl}>{l}</div>
        </div>
      ))}
    </div>
  );
}

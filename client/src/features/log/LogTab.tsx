import { useMemo, useState } from 'react';
import { Emoji, Icon } from '@/components/Icon';
import { useApp, useT } from '@/store/app';
import { colorVar } from '@/lib/safe';
import s from '@/ui/Ui.module.css';
import styles from './LogTab.module.css';

const LEVELS: { id: string; icon: 'check' | 'triangle-alert' | 'x' | 'circle-help' | null; cls: string }[] = [
  { id: '', icon: null, cls: '' },
  { id: 'success', icon: 'check', cls: s.ok },
  { id: 'warning', icon: 'triangle-alert', cls: s.warn },
  { id: 'error', icon: 'x', cls: s.bad },
  { id: 'info', icon: 'circle-help', cls: s.dim },
];

export function LogTab() {
  const t = useT();
  const log = useApp((x) => x.snapshot?.log) ?? [];
  const [q, setQ] = useState('');
  const [acc, setAcc] = useState('');
  const [level, setLevel] = useState('');
  const accs = useMemo(() => [...new Set(log.map((e) => e.acc).filter(Boolean))].sort(), [log]);
  const entries = useMemo(() => {
    const needle = q.toLowerCase();
    return log
      .filter((e) => (!level || e.level === level) && (!acc || e.acc === acc) && (!needle || e.message?.toLowerCase().includes(needle) || e.acc?.toLowerCase().includes(needle)))
      .slice(0, 500);
  }, [log, q, acc, level]);

  return (
    <div className={s.page}>
      <div className={s.filters}>
        <input className={`${s.input} ${s.search}`} placeholder={t('log_search_ph')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={s.select} value={acc} onChange={(e) => setAcc(e.target.value)}>
          <option value="">{t('log_all_accs')}</option>
          {accs.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className={styles.seg}>
          {LEVELS.map((l) => (
            <button key={l.id} className={`${styles.segBtn} ${level === l.id ? styles.active : ''} ${l.cls}`} onClick={() => setLevel(l.id)}>
              {l.icon ? <Icon name={l.icon} size={13} /> : t('log_all')}
            </button>
          ))}
        </div>
        <span className={s.grow} />
        <span className={s.dim}>{entries.length} записей</span>
      </div>
      <div className={styles.list}>
        {entries.length === 0 && <div className={s.state}>Нет записей</div>}
        {entries.map((e, i) => (
          <div key={i} className={styles.item}>
            <span className={styles.time}>{e.time}</span>
            <span className={styles.acc} style={{ color: colorVar(e.color) }}>{e.acc}</span>
            <span className={`${styles.msg} ${styles['l' + e.level]}`}><Emoji text={e.message} size={12} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

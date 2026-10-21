import { useMemo, useState } from 'react';
import { Select } from '@/ui/radix';
import { Emoji, Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import { useApp, useT } from '@/store/app';
import { AccChip, Empty, PageHead, Search, Seg } from '@/ui/Kit';
import s from '@/ui/Ui.module.css';
import styles from './LogTab.module.css';

const LVL: Record<string, { icon: IconName; label: string }> = {
  success: { icon: 'check', label: 'Успешно' },
  warning: { icon: 'triangle-alert', label: 'Внимание' },
  error: { icon: 'x', label: 'Ошибки' },
  info: { icon: 'circle-help', label: 'Инфо' },
};
type Level = '' | 'success' | 'warning' | 'error' | 'info';

export function LogTab() {
  const t = useT();
  const log = useApp((x) => x.snapshot?.log) ?? [];
  const [q, setQ] = useState('');
  const [acc, setAcc] = useState('');
  const [level, setLevel] = useState<Level>('');
  const accs = useMemo(() => [...new Set(log.map((e) => e.acc).filter(Boolean))].sort(), [log]);
  const base = useMemo(() => {
    const needle = q.toLowerCase();
    return log.filter((e) => (!acc || e.acc === acc) && (!needle || e.message?.toLowerCase().includes(needle) || e.acc?.toLowerCase().includes(needle)));
  }, [log, q, acc]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of base) c[e.level] = (c[e.level] ?? 0) + 1;
    return c;
  }, [base]);
  const entries = useMemo(() => base.filter((e) => !level || e.level === level).slice(0, 500), [base, level]);

  return (
    <div className={s.page}>
      <PageHead title="Журнал событий" count={entries.length.toLocaleString('ru')} sub="Что бот делал в последнее время: отклики, проверки, ошибки." />
      <div className={styles.bar}>
        <Search value={q} onChange={setQ} placeholder={t('log_search_ph')} />
        <Select value={acc} onChange={(e) => setAcc(e.target.value)}>
          <option value="">{t('log_all_accs')}</option>
          {accs.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Seg<Level> value={level} onChange={setLevel} options={[
          { id: '', label: 'Все', count: base.length },
          { id: 'success', label: LVL.success!.label, count: counts.success ?? 0, tone: 'ok' },
          { id: 'warning', label: LVL.warning!.label, count: counts.warning ?? 0, tone: 'warn' },
          { id: 'error', label: LVL.error!.label, count: counts.error ?? 0, tone: 'bad' },
        ]} />
      </div>
      {entries.length === 0 ? (
        <Empty icon="scroll-text" title={log.length ? 'Ничего не найдено' : 'Журнал пока пуст'} hint={log.length ? 'Попробуйте изменить поиск или фильтры.' : 'Записи появятся, как только бот начнёт работать.'} />
      ) : (
        <div className={styles.list}>
          {entries.map((e, i) => {
            const l = LVL[e.level] ?? LVL.info!;
            return (
              <div key={i} className={`${styles.item} ${styles['l' + e.level]}`}>
                <span className={styles.time}>{e.time}</span>
                <span className={styles.ico}><Icon name={l.icon} size={12} /></span>
                <div className={styles.body}>
                  <span className={styles.msg}><Emoji text={e.message} size={13} /></span>
                  {e.acc && <AccChip name={e.acc} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

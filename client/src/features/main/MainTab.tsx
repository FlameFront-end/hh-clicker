import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useApp } from '@/store/app';
import { Tip } from '@/ui/radix';
import { KpiCards } from './KpiCards';
import { AccountCard } from './AccountCard';
import { AccountSheet } from './AccountSheet';
import { Recent } from './Recent';
import styles from './MainTab.module.css';
import { mainCopy } from './copy';
import { needsAttention, profileActive } from './metrics';

export function MainTab() {
  const en = useApp((s) => s.lang) === 'en';
  const c = mainCopy(en);
  const snap = useApp((s) => s.snapshot);
  const connected = useApp((s) => s.connected);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [openTab, setOpenTab] = useState('overview');
  if (!snap) return <div className={styles.empty} role="status"><Icon name="hourglass" size={24} />{en ? 'Connecting to the dashboard…' : 'Подключаемся к панели…'}</div>;
  const current = snap.accounts.find((a) => a.idx === openIdx);
  const sorted = [...snap.accounts].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || a.idx - b.idx);
  const attention = sorted.filter(needsAttention).length;
  const active = sorted.filter((a) => profileActive(a) && !a.paused && !snap.paused);
  const checking = active.filter((a) => ['collecting', 'applying', 'checking'].includes(a.status)).length;
  const waiting = active.filter((a) => a.status === 'waiting').length;
  const errors = snap.global_stats.total_errors;
  const groups = new Map<string, number>();
  sorted.forEach((a) => { if (a.hh_user_id) groups.set(a.hh_user_id, (groups.get(a.hh_user_id) || 0) + 1); });
  return (
    <>
    <header className={styles.top}>
      <div className={styles.titleBlock}>
        <h1>{c.heading}</h1>
        <Tip text={c.tzHint}><span className={styles.info} tabIndex={0} aria-label={c.tzHint}><Icon name="circle-help" size={14} /></span></Tip>
      </div>
      <div className={styles.pills} role="status">
        <span className={styles.pill}><i className={connected ? styles.dotOk : styles.dotWarn} />{connected ? c.live : c.disconnected}</span>
        <span className={styles.pill}><Icon name="users" size={13} />{c.profilesOn} <b>{active.length}/{sorted.length}</b></span>
        {checking > 0 && <span className={styles.pill}><Icon name="search" size={13} />{c.checking} <b>{checking}</b></span>}
        {waiting > 0 && <span className={styles.pill}><Icon name="hourglass" size={13} />{c.waiting} <b>{waiting}</b></span>}
        {attention > 0 && <span className={`${styles.pill} ${styles.pillWarn}`}><Icon name="triangle-alert" size={13} />{c.attention} <b>{attention}</b></span>}
        {errors > 0 && <span className={`${styles.pill} ${styles.pillBad}`}><Icon name="triangle-alert" size={13} />{en ? 'Failed attempts this run' : 'Неудачных попыток за запуск'}: <b>{errors}</b> · {en ? 'details in profile cards' : 'подробности в карточках'}</span>}
      </div>
    </header>
    {(!connected || snap.paused) && (
      <div className={styles.banner} role="status">
        <Icon name={connected ? 'pause' : 'triangle-alert'} size={16} />
        <div><strong>{connected ? c.globalPause : c.disconnected}</strong><p>{connected ? c.globalPauseHint : c.disconnectedHint}</p></div>
      </div>
    )}
    <div className={styles.layout}>
      <div className={styles.left}>
        <h2 className={styles.srOnly}>{en ? 'Summary' : 'Сводка'}</h2>
        <KpiCards />
        <div className={styles.sectionHead}>
          <h2>{c.profiles}</h2><span className={styles.count}>{snap.accounts.length}</span>
        </div>
        {snap.accounts.length === 0 ? (
          <div className={styles.empty}><Icon name="inbox" size={28} /><div>{c.noProfiles}</div><Link to="/settings">{en ? 'Open settings' : 'Открыть настройки'}</Link></div>
        ) : (
          <div className={styles.grid}>{sorted.map((a) => <AccountCard key={a.idx} acc={a} shared={!!a.hh_user_id && (groups.get(a.hh_user_id) || 0) > 1} onOpen={() => { setOpenTab('overview'); setOpenIdx(a.idx); }} onSearch={() => { setOpenTab('search'); setOpenIdx(a.idx); }} />)}</div>
        )}
      </div>
      <aside className={styles.side}><Recent /></aside>
      <AccountSheet acc={current} tab={openTab} onClose={() => setOpenIdx(null)} />
    </div>
    </>
  );
}

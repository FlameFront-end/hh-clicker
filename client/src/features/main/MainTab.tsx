import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useApp, useT } from '@/store/app';
import { KpiCards } from './KpiCards';
import { AccountCard } from './AccountCard';
import { AccountSheet } from './AccountSheet';
import { Recent } from './Recent';
import styles from './MainTab.module.css';

export function MainTab() {
  const t = useT();
  const snap = useApp((s) => s.snapshot);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (!snap) return <div className={styles.empty}>Подключение…</div>;
  const current = snap.accounts.find((a) => a.idx === openIdx);
  return (
    <div className={styles.layout}>
      <div className={styles.left}>
        <KpiCards />
        <div className={styles.sectionHead}>
          <h2>Аккаунты</h2><span className={styles.count}>{snap.accounts.length}</span>
        </div>
        {snap.accounts.length === 0 ? (
          <div className={styles.empty}><Icon name="inbox" size={28} /><div>{t('no_accounts')}</div></div>
        ) : (
          <div className={styles.grid}>{snap.accounts.map((a) => <AccountCard key={a.idx} acc={a} onOpen={() => setOpenIdx(a.idx)} />)}</div>
        )}
      </div>
      <aside className={styles.side}><Recent /></aside>
      <AccountSheet acc={current} onClose={() => setOpenIdx(null)} />
    </div>
  );
}

import { Icon } from '@/components/Icon';
import { useApp, useT } from '@/store/app';
import { Kpi } from './Kpi';
import { AccountRow } from './AccountRow';
import { Recent } from './Recent';
import styles from './MainTab.module.css';

export function MainTab() {
  const t = useT();
  const snap = useApp((s) => s.snapshot);
  if (!snap) return <div className={styles.empty}>Подключение…</div>;
  return (
    <div className={styles.layout}>
      <div className={styles.left}>
        <Kpi />
        {snap.accounts.length === 0 ? (
          <div className={styles.empty}><Icon name="inbox" size={28} /><div>{t('no_accounts')}</div></div>
        ) : (
          <div className={styles.list}>{snap.accounts.map((a) => <AccountRow key={a.idx} acc={a} />)}</div>
        )}
      </div>
      <aside className={styles.side}><Recent /></aside>
    </div>
  );
}

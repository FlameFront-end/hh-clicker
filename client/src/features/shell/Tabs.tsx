import { NavLink } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { useT } from '@/store/app';
import { ROUTES } from '@/routes';
import styles from './Tabs.module.css';

export function Tabs() {
  const t = useT();
  return (
    <nav className={styles.tabs}>
      {ROUTES.map((r) => (
        <NavLink key={r.path} to={`/${r.path}`} end={r.path === ''} className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ''}`}>
          <Icon name={r.icon} size={14} />
          {r.label ?? t(r.key)}
        </NavLink>
      ))}
    </nav>
  );
}

import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import { useApp, useT, type TabId } from '@/store/app';
import styles from './Tabs.module.css';

export const TABS: { id: TabId; key: string; icon: IconName; label?: string }[] = [
  { id: 'main', key: 'tab_main', icon: 'layout-dashboard' },
  { id: 'log', key: 'tab_log', icon: 'scroll-text' },
  { id: 'applied', key: 'tab_applied', icon: 'check' },
  { id: 'tests', key: 'tab_tests', icon: 'flask-conical' },
  { id: 'db', key: 'tab_db', icon: 'database' },
  { id: 'hh', key: 'tab_hh', icon: 'target' },
  { id: 'views', key: 'tab_views', icon: 'eye' },
  { id: 'apply', key: 'tab_apply', icon: 'rocket' },
  { id: 'llm', key: 'tab_llm', icon: 'bot' },
  { id: 'hedi', key: '', icon: 'sparkles', label: 'HH Хэдди' },
  { id: 'recoh', key: '', icon: 'lightbulb', label: 'Рекомендации' },
  { id: 'settings', key: 'tab_settings', icon: 'settings' },
];

export function Tabs() {
  const t = useT();
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  return (
    <nav className={styles.tabs}>
      {TABS.map((x) => (
        <button key={x.id} className={`${styles.tab} ${tab === x.id ? styles.active : ''}`} onClick={() => setTab(x.id)}>
          <Icon name={x.icon} size={14} />
          {x.label ?? t(x.key)}
        </button>
      ))}
    </nav>
  );
}

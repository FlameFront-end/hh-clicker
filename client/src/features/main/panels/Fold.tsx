import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import p from './Panels.module.css';

/** Карточка-аккордеон: заголовок + пояснение; содержимое монтируется при первом открытии. */
export function Fold({ icon, title, desc, chip, children }: { icon: IconName; title: string; desc?: string; chip?: ReactNode; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className={p.fold} onToggle={(e) => e.currentTarget.open && setOpened(true)}>
      <summary>
        <span className={p.ico}><Icon name={icon} size={15} /></span>
        <span className={p.ttl}><b>{title}</b>{desc && <small>{desc}</small>}</span>
        {chip}
        <Icon name="chevron-down" size={14} className={p.chev} />
      </summary>
      <div className={p.body}>{opened && children}</div>
    </details>
  );
}

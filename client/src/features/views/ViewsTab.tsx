import { stripEmoji } from '@/components/Icon';
import { useState } from 'react';
import { useApp, useT } from '@/store/app';
import { num } from '@/lib/format';
import s from '@/ui/Ui.module.css';
import v from './Views.module.css';
import { Audit } from './Audit';
import { AccountHistory } from './History';
import { Resumes } from './Resumes';
import { HotLeads, HrContacts, OAuthBox, Remindable } from './Tools';

export function ViewsTab() {
  const t = useT();
  const accs = useApp((x) => x.snapshot?.accounts) ?? [];
  const [sel, setSel] = useState<string>('');
  const idx = sel !== '' && accs.some((a) => String(a.idx) === sel) ? sel : accs[0] ? String(accs[0].idx) : '';
  const sum = (k: string) => accs.reduce((n, a) => n + num(a[k]), 0);
  const stats: [string, string, string][] = [
    [t('views_7d'), String(sum('resume_views_7d')), s.accent],
    [t('views_new'), `+${sum('resume_views_new')}`, s.ok],
    [t('views_shows'), String(sum('resume_shows_7d')), s.dim],
    [t('views_invitations'), String(sum('resume_invitations_7d')), ''],
    [t('views_inv_new'), `+${sum('resume_invitations_new')}`, s.ok],
  ];
  return (
    <div className={s.page}>
      <div className={v.stats}>
        {stats.map(([l, val, c]) => <div key={l} className={v.stat}><div className={`${v.statVal} ${c} tnum`}>{val}</div><div className={v.statLbl}>{l}</div></div>)}
      </div>
      <div className={s.filters}>
        <span className={s.dim}>Аккаунт для инструментов:</span>
        <select className={s.select} value={idx} onChange={(e) => setSel(e.target.value)}>
          {accs.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name || a.short)}</option>)}
        </select>
      </div>
      <Audit idx={idx} />
      <HotLeads idx={idx} />
      <HrContacts />
      <Remindable idx={idx} />
      <OAuthBox idx={idx} />
      <Resumes idx={idx} />
      {accs.map((a) => <AccountHistory key={a.idx} acc={a} />)}
    </div>
  );
}

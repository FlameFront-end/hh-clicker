import { stripEmoji } from '@/components/Icon';
import { Select } from '@/ui/radix';
import { useState } from 'react';
import { useApp, useT } from '@/store/app';
import { num } from '@/lib/format';
import { Empty, PageHead, Seg, Stats } from '@/ui/Kit';
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
  const [tab, setTab] = useState('views');
  const idx = sel !== '' && accs.some((a) => String(a.idx) === sel) ? sel : accs[0] ? String(accs[0].idx) : '';
  const acc = accs.find((a) => String(a.idx) === idx);
  const sum = (k: string) => accs.reduce((n, a) => n + num(a[k]), 0);
  const plus = (n: number) => (n > 0 ? `+${n}` : '0');
  return (
    <div className={s.page}>
      <PageHead title="Резюме и инструменты" sub="Кто смотрит ваши резюме, что улучшить и быстрые действия на hh.ru. Данные за последние 7 дней.">
        <span className={s.dim} style={{ fontSize: 12 }}>Аккаунт</span>
        <Select value={idx} onChange={(e) => setSel(e.target.value)}>
          {accs.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name || a.short)}</option>)}
        </Select>
      </PageHead>
      <Stats items={[
        { label: t('views_7d'), value: sum('resume_views_7d').toLocaleString('ru'), tone: 'accent' },
        { label: t('views_new'), value: plus(sum('resume_views_new')), tone: sum('resume_views_new') ? 'ok' : undefined },
        { label: t('views_shows'), value: sum('resume_shows_7d').toLocaleString('ru') },
        { label: t('views_invitations'), value: sum('resume_invitations_7d').toLocaleString('ru') },
        { label: t('views_inv_new'), value: plus(sum('resume_invitations_new')), tone: sum('resume_invitations_new') ? 'ok' : undefined },
      ]} />
      <Seg value={tab} onChange={setTab} options={[
        { id: 'views', label: 'Кто смотрел' },
        { id: 'audit', label: 'Аудит резюме' },
        { id: 'leads', label: 'Лиды и напоминания' },
        { id: 'hr', label: 'Контакты HR' },
        { id: 'tools', label: 'Резюме и доступ' },
      ]} />
      {tab === 'views' && (acc ? <AccountHistory key={acc.idx} acc={acc} /> : <Empty icon="eye" title="Нет аккаунтов" hint="Добавьте аккаунт в настройках." />)}
      {tab === 'audit' && <Audit idx={idx} />}
      {tab === 'leads' && (
        <div className={v.grid2}>
          <HotLeads idx={idx} />
          <Remindable idx={idx} />
        </div>
      )}
      {tab === 'hr' && <HrContacts />}
      {tab === 'tools' && (
        <>
          <Resumes idx={idx} />
          <OAuthBox idx={idx} />
        </>
      )}
    </div>
  );
}

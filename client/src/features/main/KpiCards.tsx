import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import { fmtInt } from '@/lib/format';
import { useApp } from '@/store/app';
import { Tip } from '@/ui/radix';
import { Spark } from './Spark';
import { hhQuota, invitationTotals, relative } from './metrics';
import { mainCopy } from './copy';
import s from './KpiCards.module.css';

function Card({ icon, label, value, sub, tone, hint, children }: { icon: IconName; label: string; value: string; sub?: React.ReactNode; tone?: string; hint?: string; children?: React.ReactNode }) {
  return <section className={s.card} aria-label={label}>
    <h3 className={s.head}><Icon name={icon} size={14} />{label}</h3>
    <Tip text={hint}><div className={[s.value, tone, 'tnum'].filter(Boolean).join(' ')}>{value}</div></Tip>
    {sub && <div className={s.sub}>{sub}</div>}{children}
  </section>;
}

export function KpiCards() {
  const snap = useApp((x) => x.snapshot);
  const en = useApp((x) => x.lang) === 'en';
  const c = mainCopy(en);
  const accs = snap?.accounts ?? [];
  const metrics = snap?.dashboard;
  const quota = hhQuota(accs);
  const pct = quota.complete && quota.limit > 0 ? Math.min(100, quota.used / quota.limit * 100) : 0;
  const invitations = invitationTotals(accs);
  const inv = invitations.recent;
  const invAll = invitations.total;
  const quotaWho = quota.unidentified ? (en ? 'limits may overlap' : 'лимиты могут пересекаться') : `${quota.users} ${c.hhUsers}`;
  return <div className={s.grid}>
    <Card icon="send" label={c.today} value={metrics ? fmtInt(metrics.today) : '—'} tone={metrics?.today ? s.ok : ''} sub={en ? 'Moscow day' : 'сутки по Москве'} hint={c.todaySub} />
    <Card icon="mailbox" label={c.invitations} value={invitations.known ? fmtInt(inv) : '—'} tone={inv ? s.warn : ''}
      hint={invitations.known ? `${c.invitationsSub}${invitations.updated ? ' · ' + c.updated.toLowerCase() + ' ' + relative(invitations.updated, en) : ''}` : undefined}
      sub={invitations.known ? `${c.totalShort} ${fmtInt(invAll)}` : snap?.paused ? (en ? 'HH updates paused' : 'обновление HH на паузе') : c.syncingStats} />
    <Card icon="activity" label={c.last24} value={metrics ? fmtInt(metrics.last_24h) : '—'} hint={c.history}>
      {metrics && <div className={s.spark}><Spark values={metrics.hourly} /></div>}
    </Card>
    <Card icon="key-round" label={c.quota} value={quota.complete ? fmtInt(quota.used) + ' / ' + fmtInt(quota.limit) : '—'}
      hint={quota.complete ? `${c.sourceHh} · ${c.updated.toLowerCase()} ${relative(quota.updated, en)}${quota.shared ? ' · ' + c.shared.toLowerCase() : ''}${quota.unidentified ? ' · ' + c.unidentified.toLowerCase() : ''}` : c.unknown}
      sub={quota.complete ? quotaWho : c.unknown}>
      <div className={s.bar} aria-hidden="true"><i style={{ width: pct + '%' }} /></div>
    </Card>
  </div>;
}

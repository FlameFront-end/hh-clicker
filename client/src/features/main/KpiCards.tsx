import { useMemo } from 'react';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import { fmtInt, num } from '@/lib/format';
import { useApp } from '@/store/app';
import { Spark } from './Spark';
import { plural } from './status';
import s from './KpiCards.module.css';

function hourly(times: string[]): number[] {
  const now = Date.now();
  const buckets = new Array<number>(24).fill(0);
  for (const raw of times) {
    const ts = new Date(raw.replace(' ', 'T')).getTime();
    if (Number.isNaN(ts)) continue;
    const h = Math.floor((now - ts) / 3600_000);
    if (h >= 0 && h < 24) buckets[23 - h] = (buckets[23 - h] ?? 0) + 1;
  }
  return buckets;
}

function Card({ icon, label, value, sub, tone, children }: { icon: IconName; label: string; value: string; sub?: React.ReactNode; tone?: string; children?: React.ReactNode }) {
  return (
    <div className={s.card}>
      <div className={s.head}><Icon name={icon} size={14} />{label}</div>
      <div className={`${s.value} ${tone ?? ''} tnum`}>{value}</div>
      {sub && <div className={s.sub}>{sub}</div>}
      {children}
    </div>
  );
}

export function KpiCards() {
  const snap = useApp((x) => x.snapshot);
  const g = snap?.global_stats;
  const accs = snap?.accounts ?? [];
  const recent = snap?.recent_responses ?? [];
  const spark = useMemo(() => hourly(recent.map((r) => r.time)), [recent]);
  const used = accs.reduce((a, x) => a + num(x.hh_today_applies), 0);
  const lim = accs.reduce((a, x) => a + (num(x.hh_daily_limit) || 200), 0);
  const pct = lim > 0 ? Math.min(100, Math.round((used / lim) * 100)) : 0;
  const inv = accs.reduce((a, x) => a + num(x.hh_interviews_recent ?? x.hh_interviews), 0);
  const invAll = accs.reduce((a, x) => a + num(x.hh_interviews), 0);
  const errors = g?.total_errors ?? 0;
  const last24 = spark.reduce((x, y) => x + y, 0);
  return (
    <div className={s.grid}>
      <Card icon="send" label="Откликов сегодня" value={fmtInt(used)} tone={s.ok} sub={<>лимит HH {fmtInt(lim)} на все аккаунты</>}>
        <div className={s.bar}><i style={{ width: `${pct}%` }} /></div>
      </Card>
      <Card icon="mailbox" label="Приглашения" value={fmtInt(inv)} tone={inv > 0 ? s.warn : ''} sub={invAll > inv ? `свежие · всего ${fmtInt(invAll)}` : 'на собеседование'} />
      <Card icon="activity" label="Активность за 24 часа" value={fmtInt(last24)} sub={`${plural(last24, 'отклик', 'отклика', 'откликов')} в ленте · по часам`}>
        <div className={s.spark}><Spark values={spark} /></div>
      </Card>
      <Card icon="database" label="База вакансий" value={fmtInt(g?.storage_total ?? 0)} sub={<>{fmtInt(g?.storage_tests ?? 0)} с тестом{errors > 0 ? <> · <b className={s.bad}>{fmtInt(errors)} {plural(errors, 'ошибка', 'ошибки', 'ошибок')}</b></> : ''}</>} />
    </div>
  );
}

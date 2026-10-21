import { useState } from 'react';
import { Emoji } from '@/components/Icon';
import { get } from '@/lib/api';
import s from '@/ui/Ui.module.css';
import v from './Views.module.css';
import { Err, Section, useLoader, type Json } from './bits';

const LVL: Record<string, [string, number]> = { critical: ['🔴', 0], high: ['🟠', 1], medium: ['🟡', 2], low: ['🔵', 3], info: ['ℹ️', 4] };
const Card = ({ l, children }: { l: string; children: React.ReactNode }) => <div className={v.card}><div className={v.cardLbl}>{l}</div><div>{children}</div></div>;

function Result({ d }: { d: Json }) {
  const issues: Json[] = [...(d.issues ?? [])].sort((a, b) => (LVL[a.level]?.[1] ?? 5) - (LVL[b.level]?.[1] ?? 5));
  const months = d.total_experience_months || 0;
  const exp = Math.floor(months / 12) ? `${Math.floor(months / 12)} г. ${months % 12 ? (months % 12) + ' м.' : ''}` : `${months} м.`;
  const sColor = ({ not_looking_for_job: s.bad, looking_for_offers: s.warn, actively_searching: s.ok } as Record<string, string>)[d.job_search_status] ?? s.dim;
  const pct = d.percent || 0;
  const m: Json | undefined = d.market;
  const mine = new Set<string>((d.skills ?? []).map((x: string) => x.toLowerCase()));
  const wa: Json[] = d.weight_analysis ?? [];
  const sd: Json[] = d.supply_demand_comparison ?? [];
  const ha: Json | undefined = d.hr_activity;
  return (
    <>
      <div><b>{d.name || '?'}</b> <span className={s.dim}>{d.title}</span></div>
      <div className={v.cards}>
        <Card l="Статус поиска"><b className={sColor}>{d.job_search_status_label || '?'}</b></Card>
        <Card l="Заполнено"><b className={pct >= 80 ? s.ok : pct >= 60 ? s.warn : s.bad}>{pct}%</b></Card>
        <Card l="Опыт">{exp}</Card>
        <Card l="Зарплата">{d.salary ? `${d.salary} ₽` : <span className={s.bad}>не указана</span>}</Card>
        <Card l="Фото">{d.has_photo ? <span className={s.ok}>Есть</span> : <span className={s.bad}>Нет</span>}</Card>
        <Card l="Статус резюме"><span className={d.status === 'published' ? s.ok : s.bad}>{d.status || '?'}</span></Card>
      </div>
      <div className={v.row}>
        <span>Формат: <b>{(d.work_formats ?? []).join(', ') || '—'}</b></span>
        <span>График: <b>{(d.work_schedule ?? []).join(', ') || '—'}</b></span>
        <span>Занятость: <b>{(d.employment ?? []).join(', ') || '—'}</b></span>
        <span>Роли: <b>{(d.roles ?? []).join(', ') || '—'}</b></span>
      </div>
      <div className={v.row}>
        <span><b>{d.stats_7d?.search_shows ?? 0}</b> показов/7д</span>
        <span><b>{d.stats_7d?.views ?? 0}</b> просмотров <span className={s.ok}>+{d.stats_7d?.views_new ?? 0}</span></span>
        <span><b>{d.stats_7d?.invitations ?? 0}</b> приглашений <span className={s.ok}>+{d.stats_7d?.invitations_new ?? 0}</span></span>
      </div>
      <div className={s.dim}>Навыки: <span style={{ color: 'var(--text)' }}>{(d.skills ?? []).slice(0, 15).join(', ')}</span></div>

      <h4 className={v.h}>Рекомендации ({issues.length})</h4>
      {!issues.length && <span className={s.ok}>Проблем не найдено</span>}
      {issues.map((i, n) => (
        <div key={n} className={v.issue}><Emoji text={LVL[i.level]?.[0] ?? '❓'} /><div>{i.text}{i.fix && <div className={v.fix}>{i.fix}</div>}</div></div>
      ))}

      {m && (m.vacancy_count || m.active_seekers) && (
        <>
          <h4 className={v.h}>Анализ рынка</h4>
          <div className={v.cards}>
            <Card l="Вакансий"><b>{(m.vacancy_count || 0).toLocaleString('ru')}</b></Card>
            <Card l="Активных соискателей"><b>{(m.active_seekers || 0).toLocaleString('ru')}</b></Card>
            <Card l="Конкуренция (чел/вак)"><b className={m.supply_demand_ratio > 5 ? s.bad : m.supply_demand_ratio > 2 ? s.warn : s.ok}>{m.supply_demand_ratio || '—'}</b></Card>
          </div>
          {m.experience_distribution?.length > 0 && <div className={v.chips}>{m.experience_distribution.map((e: Json, i: number) => <span key={i} className={v.chip}>{e.name} <b>{(e.count || 0).toLocaleString('ru')}</b></span>)}</div>}
          {m.top_competitor_skills?.length > 0 && (
            <div className={v.chips}>{m.top_competitor_skills.map((k: string | Json, i: number) => {
              const name = typeof k === 'string' ? k : k.name || '';
              const has = mine.has(name.toLowerCase());
              return <span key={i} className={`${v.chip} ${has ? v.chipOk : v.chipBad}`}>{name}{typeof k === 'object' && k.count ? ` (${Math.round(k.count / 1000)}K)` : ''}</span>;
            })}</div>
          )}
        </>
      )}

      {wa.length > 0 && (
        <>
          <h4 className={v.h}>Заполненность: {d.filled_weight || 0}/{d.total_weight || 1}</h4>
          <div className={v.chips}>{wa.map((f, i) => <span key={i} className={`${v.chip} ${f.filled ? v.chipOk : v.chipBad}`} title={`weight=${f.weight}, status=${f.status}`}>{f.label || f.name}</span>)}</div>
        </>
      )}

      {sd.length > 0 && (
        <>
          <h4 className={v.h}>Конкуренция по запросам</h4>
          <div className={s.tableWrap}><table className={s.table}>
            <thead><tr><th>Запрос</th><th>Вакансий</th><th>Конкуренция</th><th /></tr></thead>
            <tbody>{sd.map((i, n) => {
              const r = i.ratio || 0;
              return <tr key={n}><td>{i.term}</td><td>{i.vacancies || 0}</td><td className={r > 30 ? s.bad : r > 15 ? s.warn : s.ok}>{r ? `${r} чел/вак` : '—'}</td><td>{r > 30 ? 'высокая' : r > 15 ? 'средняя' : r > 0 ? 'низкая' : '—'}</td></tr>;
            })}</tbody>
          </table></div>
        </>
      )}

      {ha && ha.active_count + ha.slow_count + ha.dead_count > 0 && (
        <>
          <h4 className={v.h}>Активность HR-менеджеров</h4>
          <div className={v.row}>
            <span><b className={s.ok}>{ha.active_count}</b> активных (&lt;3 дн.)</span>
            <span><b className={s.warn}>{ha.slow_count}</b> медленных (3–7 дн.)</span>
            <span><b className={s.bad}>{ha.dead_count}</b> неактивных (&gt;7 дн.)</span>
          </div>
        </>
      )}
    </>
  );
}

export function Audit({ idx }: { idx: string }) {
  const [extra, setExtra] = useState('');
  const l = useLoader(() => get<Json>(`/api/account/${idx}/resume_audit`, { extra_terms: extra.trim() }));
  return (
    <Section icon="search" title="Аудит резюме" desc="Проверка заполненности, конкуренции на рынке и советы, что исправить" tone={s.accent}
      actions={<button className={s.btn} disabled={l.busy || !idx} onClick={l.run}>Проверить</button>}
      status={l.busy ? 'Анализирую…' : <Err text={l.err} />}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>Сравнить с другими запросами <span className={s.dim} style={{ fontWeight: 400 }}>— необязательно</span></span>
        <input className={s.input} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="devops, python developer, SRE — через запятую" />
      </label>
      {l.data && <Result d={l.data} />}
    </Section>
  );
}

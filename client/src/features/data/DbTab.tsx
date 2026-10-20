import { Fragment, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import { useApp, useT } from '@/store/app';
import { del, get } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { fmtDate, safeHref, shortAcc } from '@/lib/safe';
import { sortRows } from '@/ui/Table';
import { useSort } from '@/ui/useSort';
import { downloadCsv } from '@/ui/csv';
import s from '@/ui/Ui.module.css';

interface Vac { status: string; at: string; vacancy_id: string; title: string; company: string; applied_by: string[]; url: string }
interface Similar { found?: number; items?: { name?: string; employer_name?: string; alternate_url?: string; area_name?: string; schedule?: string; experience?: string; salary_from?: number; salary_to?: number; salary_currency?: string; has_test?: boolean; response_letter_required?: boolean }[] }
const PAGE = 100;
const ST: Record<string, [IconName, string, string]> = {
  sent: ['check', 'Отклик отправлен', s.ok],
  test_passed: ['file-pen-line', 'Тест пройден', s.accent],
  test_pending: ['flask-conical', 'Не пройден', s.warn],
};

export function DbTab() {
  const t = useT();
  const names = useApp((x) => x.snapshot?.accounts);
  const { data, error, loading, reload } = useFetch<Vac[]>('/api/vacancies', { limit: 3000 });
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [acc, setAcc] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [sim, setSim] = useState<Record<string, Similar | 'err' | undefined>>({});
  const { sort, onSort } = useSort('at');

  const all = useMemo(() => (Array.isArray(data) ? data : []).filter((v) => !removed.has(v.vacancy_id)), [data, removed]);
  const active = useMemo(() => new Set((names ?? []).flatMap((a) => [a.name, a.short]).filter(Boolean)), [names]);
  const accs = useMemo(() => [...new Set(all.flatMap((i) => i.applied_by || []).filter((a) => active.has(a)))].sort(), [all, active]);
  const rows = useMemo(() => {
    const n = q.toLowerCase();
    return sortRows(all.filter((i) => (!status || i.status === status) && (!acc || (i.applied_by || []).includes(acc)) && (!n || (i.title || '').toLowerCase().includes(n) || (i.company || '').toLowerCase().includes(n) || (i.vacancy_id || '').includes(n))), sort);
  }, [all, q, status, acc, sort]);

  const toggleSimilar = async (vid: string) => {
    if (open === vid) return setOpen(null);
    setOpen(vid);
    if (sim[vid]) return;
    try {
      const d = await get<Similar>(`/api/vacancy/${encodeURIComponent(vid)}/similar`, { per_page: 10 });
      setSim((m) => ({ ...m, [vid]: d }));
    } catch {
      setSim((m) => ({ ...m, [vid]: 'err' }));
    }
  };
  const remove = async (vid: string) => {
    if (!confirm(`Удалить вакансию ${vid} из базы?`)) return;
    try {
      const r = await del<{ ok?: boolean }>(`/api/vacancy/${vid}`);
      if (r.ok) setRemoved((x) => new Set(x).add(vid));
    } catch { /* оставляем строку */ }
  };
  const Th = ({ f, children }: { f: string; children: string }) => (
    <th className={s.sortable} onClick={() => onSort(f)}>{children}{sort.field === f ? (sort.dir === -1 ? ' ↓' : ' ↑') : <span style={{ opacity: .35 }}> ↕</span>}</th>
  );

  return (
    <div className={s.page}>
      <div className={s.head}>
        <h2 className={s.title}>{t('db_title')} <span className={s.count}>({rows.length} из {all.length})</span></h2>
        <span className={s.grow} />
        <button className={s.btn} onClick={() => downloadCsv('vacancies.csv', ['Статус', 'Дата', 'ID', 'Вакансия', 'Компания', 'Аккаунты', 'URL'], rows.map((i) => [i.status, i.at, i.vacancy_id, i.title, i.company, (i.applied_by || []).join('; '), i.url]))}><Icon name="arrow-down" size={13} />CSV</button>
        <button className={s.btn} onClick={() => { setRemoved(new Set()); void reload(); }} disabled={loading}><Icon name="refresh-cw" size={13} />Обновить</button>
      </div>
      <div className={s.filters}>
        <input className={`${s.input} ${s.search}`} placeholder={t('db_search_ph')} value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
        <select className={s.select} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('db_all_statuses')}</option>
          <option value="sent">Отклик отправлен</option>
          <option value="test_passed">Тест пройден</option>
          <option value="test_pending">Тест не пройден</option>
        </select>
        <select className={s.select} value={acc} onChange={(e) => setAcc(e.target.value)}>
          <option value="">{t('db_all_accs')}</option>
          {accs.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {error && <div className={`${s.state} ${s.bad}`}>{error}</div>}
      {!error && !data && <div className={s.state}>Загрузка…</div>}
      {data && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><Th f="status">{t('col_status')}</Th><Th f="at">{t('col_date')}</Th><Th f="title">{t('col_vacancy')}</Th><Th f="company">{t('col_company')}</Th><th>{t('col_accounts')}</th><th style={{ width: 36 }} /></tr></thead>
            <tbody>
              {rows.slice(0, shown).map((i) => {
                const [ic, label, cls] = ST[i.status] ?? ['circle-help' as IconName, i.status, s.dim];
                const sm = sim[i.vacancy_id];
                return (
                  <Fragment key={i.vacancy_id}>
                    <tr>
                      <td className={`${cls} ${s.nowrap}`}><Icon name={ic} size={12} /> {label}</td>
                      <td className={`${s.dim} ${s.nowrap}`}>{fmtDate(i.at)}</td>
                      <td>
                        <a href={safeHref(i.url)} target="_blank" rel="noopener noreferrer" style={i.title ? undefined : { color: 'var(--dim)' }}>{i.title || `hh.ru/vacancy/${i.vacancy_id}`}</a>{' '}
                        <button className={`${s.btn} ${s.btnSm}`} title="Похожие вакансии" onClick={() => void toggleSimilar(i.vacancy_id)}><Icon name="sparkles" size={11} /></button>
                      </td>
                      <td>{i.company}</td>
                      <td>{(i.applied_by || []).length ? i.applied_by.map((a) => <span key={a} className={s.tag}>{shortAcc(a)}</span>) : <span className={s.dim}>—</span>}</td>
                      <td><button className={`${s.btn} ${s.btnSm} ${s.btnDanger}`} title="Удалить из базы" onClick={() => void remove(i.vacancy_id)}><Icon name="x" size={11} /></button></td>
                    </tr>
                    {open === i.vacancy_id && (
                      <tr><td colSpan={6} style={{ background: 'var(--card2)' }}>
                        {!sm && <span className={s.dim}>Загружаю похожие…</span>}
                        {sm === 'err' && <span className={s.bad}>Ошибка загрузки</span>}
                        {sm && sm !== 'err' && (
                          <>
                            <div className={s.dim} style={{ marginBottom: 6 }}>HH знает {(sm.found || 0).toLocaleString('ru')} похожих · показано {sm.items?.length ?? 0}</div>
                            {(sm.items ?? []).map((v, n) => (
                              <div key={n} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr auto', gap: 12, padding: '3px 0', fontSize: 12 }}>
                                <span><a href={safeHref(v.alternate_url)} target="_blank" rel="noopener noreferrer">{(v.name || '?').slice(0, 60)}</a>{v.has_test && <span className={s.warn}> · тест</span>}{v.response_letter_required && <span className={s.warn}> · письмо</span>}</span>
                                <span>{(v.employer_name || '').slice(0, 28)}</span>
                                <span className={s.dim}>{[v.area_name, v.schedule, v.experience].filter(Boolean).join(' · ')}</span>
                                <span className={s.ok}>{v.salary_from || v.salary_to ? `${v.salary_from?.toLocaleString('ru') ?? '?'} — ${v.salary_to?.toLocaleString('ru') ?? '?'} ${v.salary_currency ?? ''}` : ''}</span>
                              </div>
                            ))}
                            {!sm.items?.length && <span className={s.dim}>похожих не найдено</span>}
                          </>
                        )}
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && (
        <div className={s.more}><button className={s.btn} onClick={() => setShown((v) => v + PAGE)}>{t('btn_show_more')}</button><span style={{ marginLeft: 8 }}>{shown} из {rows.length}</span></div>
      )}
    </div>
  );
}

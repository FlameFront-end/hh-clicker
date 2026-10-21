import { Fragment, useMemo, useState } from 'react';
import { Select } from '@/ui/radix';
import { confirmDialog } from '@/ui/dialog';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import { useAliasOf, useApp, useT } from '@/store/app';
import { del, get } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { fmtDate, safeHref } from '@/lib/safe';
import { sortRows } from '@/ui/Table';
import { useSort } from '@/ui/useSort';
import { downloadCsv } from '@/ui/csv';
import { Tip } from '@/ui/radix';
import { AccChip, Empty, JobCell, PageHead, Pill, Search, Seg, Skeleton } from '@/ui/Kit';
import s from '@/ui/Ui.module.css';

interface Vac { status: string; at: string; vacancy_id: string; title: string; company: string; applied_by: string[]; url: string }
interface Similar { found?: number; items?: { name?: string; employer_name?: string; alternate_url?: string; area_name?: string; schedule?: string; experience?: string; salary_from?: number; salary_to?: number; salary_currency?: string; has_test?: boolean; response_letter_required?: boolean }[] }
const PAGE = 100;
const ST: Record<string, [IconName, string, 'ok' | 'accent' | 'warn']> = {
  sent: ['check', 'Отклик отправлен', 'ok'],
  test_passed: ['file-pen-line', 'Тест пройден', 'accent'],
  test_pending: ['flask-conical', 'Тест не пройден', 'warn'],
};

export function DbTab() {
  const t = useT();
  const names = useApp((x) => x.snapshot?.accounts);
  const alias = useAliasOf();
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
  const active = useMemo(() => new Set((names ?? []).flatMap((a) => [a.hh_name ?? a.name, a.hh_short ?? a.short]).filter(Boolean)), [names]);
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
    if (!(await confirmDialog(`Удалить вакансию ${vid} из базы?`, { danger: true }))) return;
    try {
      const r = await del<{ ok?: boolean }>(`/api/vacancy/${vid}`);
      if (r.ok) setRemoved((x) => new Set(x).add(vid));
    } catch { /* оставляем строку */ }
  };
  const Th = ({ f, children }: { f: string; children: string }) => (
    <th className={s.sortable} onClick={() => onSort(f)}>{children}{sort.field === f ? (sort.dir === -1 ? ' ↓' : ' ↑') : <span style={{ opacity: .35 }}> ↕</span>}</th>
  );

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of all) c[v.status] = (c[v.status] ?? 0) + 1;
    return c;
  }, [all]);

  return (
    <div className={s.page}>
      <PageHead title={t('db_title')} count={rows.length === all.length ? all.length.toLocaleString('ru') : `${rows.length.toLocaleString('ru')} из ${all.length.toLocaleString('ru')}`} sub="Все вакансии, которые бот нашёл и обработал. Раскройте «похожие», чтобы увидеть что ещё есть на HH.">
        <button className={s.btn} onClick={() => downloadCsv('vacancies.csv', ['Статус', 'Дата', 'ID', 'Вакансия', 'Компания', 'Аккаунты', 'URL'], rows.map((i) => [i.status, i.at, i.vacancy_id, i.title, i.company, (i.applied_by || []).join('; '), i.url]))} disabled={!rows.length}><Icon name="arrow-down" size={13} />Скачать CSV</button>
        <button className={s.btn} onClick={() => { setRemoved(new Set()); void reload(); }} disabled={loading}><Icon name="refresh-cw" size={13} />Обновить</button>
      </PageHead>
      <div className={s.filters}>
        <Search value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder={t('db_search_ph')} />
        <Select value={acc} onChange={(e) => setAcc(e.target.value)}>
          <option value="">{t('db_all_accs')}</option>
          {accs.map((a) => <option key={a} value={a}>{alias(a)}</option>)}
        </Select>
      </div>
      <div><Seg value={status} onChange={setStatus} options={[
        { id: '', label: 'Все', count: all.length },
        { id: 'sent', label: 'Отклик отправлен', count: statusCounts.sent ?? 0, tone: 'ok' },
        { id: 'test_passed', label: 'Тест пройден', count: statusCounts.test_passed ?? 0, tone: 'accent' },
        { id: 'test_pending', label: 'Тест не пройден', count: statusCounts.test_pending ?? 0, tone: 'warn' },
      ]} /></div>
      {error && <Empty icon="triangle-alert" title="Не удалось загрузить базу" hint={error}><button className={s.btn} onClick={() => void reload()}>Повторить</button></Empty>}
      {!error && !data && <Skeleton />}
      {data && rows.length === 0 && <Empty icon="database" title={all.length ? 'Ничего не найдено' : 'База пока пуста'} hint={all.length ? 'Измените поиск или фильтры.' : 'Вакансии появятся после первого цикла поиска.'} />}
      {data && rows.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><Th f="title">{t('col_vacancy')}</Th><Th f="status">{t('col_status')}</Th><th>{t('col_accounts')}</th><Th f="at">{t('col_date')}</Th><th style={{ width: 84 }} /></tr></thead>
            <tbody>
              {rows.slice(0, shown).map((i) => {
                const [ic, label, tone] = ST[i.status] ?? ['circle-help' as IconName, i.status, 'accent' as const];
                const sm = sim[i.vacancy_id];
                return (
                  <Fragment key={i.vacancy_id}>
                    <tr>
                      <td><JobCell title={i.title} company={i.company} href={safeHref(i.url)} fallback={`hh.ru/vacancy/${i.vacancy_id}`} /></td>
                      <td className={s.nowrap}><Pill tone={tone} icon={ic}>{label}</Pill></td>
                      <td>{(i.applied_by || []).length ? <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{i.applied_by.map((a) => <AccChip key={a} name={a} />)}</div> : <span className={s.dim}>—</span>}</td>
                      <td className={`${s.dim} ${s.nowrap} ${s.mono}`}>{fmtDate(i.at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <Tip text="Похожие вакансии на HH"><button className={`${s.btn} ${s.btnSm} ${open === i.vacancy_id ? s.btnOn : ''}`} aria-label="Похожие вакансии" onClick={() => void toggleSimilar(i.vacancy_id)}><Icon name="sparkles" size={12} /></button></Tip>
                          <Tip text="Удалить из базы"><button className={`${s.btn} ${s.btnSm} ${s.btnDanger}`} aria-label="Удалить из базы" onClick={() => void remove(i.vacancy_id)}><Icon name="trash-2" size={12} /></button></Tip>
                        </div>
                      </td>
                    </tr>
                    {open === i.vacancy_id && (
                      <tr><td colSpan={5} style={{ background: 'var(--bg)', padding: '14px 16px 16px' }}>
                        {!sm && <span className={s.dim}>Загружаю похожие…</span>}
                        {sm === 'err' && <span className={s.bad}>Не удалось загрузить</span>}
                        {sm && sm !== 'err' && (
                          <>
                            <div className={s.dim} style={{ marginBottom: 10, fontSize: 12 }}>На HH найдено {(sm.found || 0).toLocaleString('ru')} похожих · показаны первые {sm.items?.length ?? 0}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {(sm.items ?? []).map((v, n) => (
                                <div key={n} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1.4fr) auto', gap: 14, padding: '9px 12px', fontSize: 12.5, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, alignItems: 'center' }}>
                                  <span style={{ minWidth: 0 }}><a href={safeHref(v.alternate_url)} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 500 }}>{(v.name || '?').slice(0, 70)}</a>{v.has_test && <> <Pill tone="warn">тест</Pill></>}{v.response_letter_required && <> <Pill tone="dim">письмо</Pill></>}</span>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.employer_name}</span>
                                  <span className={s.dim}>{[v.area_name, v.schedule, v.experience].filter(Boolean).join(' · ')}</span>
                                  <span className={`${s.ok} ${s.mono}`}>{v.salary_from || v.salary_to ? `${v.salary_from?.toLocaleString('ru') ?? '?'} — ${v.salary_to?.toLocaleString('ru') ?? '?'} ${v.salary_currency ?? ''}` : ''}</span>
                                </div>
                              ))}
                            </div>
                            {!sm.items?.length && <span className={s.dim}>Похожих вакансий не найдено</span>}
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

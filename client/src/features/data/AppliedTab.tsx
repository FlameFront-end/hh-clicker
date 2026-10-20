import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useApp, useT } from '@/store/app';
import { useFetch } from '@/lib/useFetch';
import { fmtDate, safeHref, shortAcc } from '@/lib/safe';
import { SortTable, sortRows, type Col } from '@/ui/Table';
import { useSort } from '@/ui/useSort';
import { downloadCsv } from '@/ui/csv';
import s from '@/ui/Ui.module.css';

interface Applied { at: string; account: string; vacancy_id: string; title: string; company: string; salary_from: number | null; salary_to: number | null; url: string }
const PAGE = 100;

const sal = (i: Applied) => (i.salary_from || i.salary_to ? `${i.salary_from ? i.salary_from.toLocaleString('ru') : '?'} — ${i.salary_to ? i.salary_to.toLocaleString('ru') : '?'}` : '');

export function AppliedTab() {
  const t = useT();
  const names = useApp((x) => x.snapshot?.accounts);
  const { data, error, loading, reload } = useFetch<Applied[]>('/api/applied', { limit: 2000 });
  const [q, setQ] = useState('');
  const [acc, setAcc] = useState('');
  const [named, setNamed] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const { sort, onSort } = useSort('at');

  const items = Array.isArray(data) ? data : [];
  const active = useMemo(() => new Set((names ?? []).flatMap((a) => [a.name, a.short]).filter(Boolean)), [names]);
  const accs = useMemo(() => [...new Set(items.map((i) => i.account).filter((a) => a && active.has(a)))].sort(), [items, active]);
  const rows = useMemo(() => {
    const n = q.toLowerCase();
    const f = items.filter((i) => (!acc || i.account === acc) && (!named || i.title || i.company) && (!n || (i.title || '').toLowerCase().includes(n) || (i.company || '').toLowerCase().includes(n) || (i.vacancy_id || '').includes(n)));
    return sortRows(f, sort);
  }, [items, q, acc, named, sort]);

  const cols: Col<Applied>[] = [
    { key: 'at', label: t('col_date'), sort: true, nowrap: true, render: (i) => <span className={s.dim}>{fmtDate(i.at)}</span> },
    { key: 'account', label: t('col_account'), sort: true, nowrap: true, render: (i) => shortAcc(i.account || '') },
    { key: 'title', label: t('col_vacancy'), sort: true, render: (i) => <a href={safeHref(i.url)} target="_blank" rel="noopener noreferrer" style={i.title ? undefined : { color: 'var(--dim)' }}>{i.title || `hh.ru/vacancy/${i.vacancy_id}`}</a> },
    { key: 'company', label: t('col_company'), sort: true, render: (i) => i.company || '' },
    { key: 'salary_from', label: t('col_salary'), sort: true, nowrap: true, render: (i) => <span className={s.ok}>{sal(i)}</span> },
  ];

  return (
    <div className={s.page}>
      <div className={s.head}>
        <h2 className={s.title}>{t('applied_title')} <span className={s.count}>({rows.length})</span></h2>
        <span className={s.grow} />
        <button className={s.btn} onClick={() => downloadCsv('applied.csv', ['Дата', 'Аккаунт', 'Вакансия', 'Компания', 'Зарплата', 'URL'], rows.map((i) => [i.at, i.account, i.title, i.company, sal(i), i.url]))}><Icon name="arrow-down" size={13} />CSV</button>
        <button className={s.btn} onClick={() => void reload()} disabled={loading}><Icon name="refresh-cw" size={13} />Обновить</button>
      </div>
      <div className={s.filters}>
        <input className={`${s.input} ${s.search}`} placeholder={t('applied_search_ph')} value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
        <select className={s.select} value={acc} onChange={(e) => setAcc(e.target.value)}>
          <option value="">{t('applied_all_accs')}</option>
          {accs.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className={s.checkLbl}><input type="checkbox" checked={named} onChange={(e) => setNamed(e.target.checked)} />{t('applied_only_named')}</label>
      </div>
      {error && <div className={`${s.state} ${s.bad}`}>{error}</div>}
      {!error && !data && <div className={s.state}>Загрузка…</div>}
      {data && <SortTable cols={cols} rows={rows.slice(0, shown)} sort={sort} onSort={onSort} rowKey={(i, n) => `${i.vacancy_id}-${i.at}-${n}`} />}
      {rows.length > shown && (
        <div className={s.more}>
          <button className={s.btn} onClick={() => setShown((v) => v + PAGE)}>{t('btn_show_more')}</button>
          <span style={{ marginLeft: 8 }}>{shown} из {rows.length}</span>
        </div>
      )}
    </div>
  );
}

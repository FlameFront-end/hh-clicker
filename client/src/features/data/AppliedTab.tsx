import { useMemo, useState } from 'react';
import { Select } from '@/ui/radix';
import { Icon } from '@/components/Icon';
import { useAliasOf, useApp, useT } from '@/store/app';
import { useFetch } from '@/lib/useFetch';
import { fmtDate, safeHref } from '@/lib/safe';
import { SortTable, sortRows, type Col } from '@/ui/Table';
import { useSort } from '@/ui/useSort';
import { downloadCsv } from '@/ui/csv';
import { AccChip, CheckPill, Empty, JobCell, PageHead, Search, Skeleton, Stats } from '@/ui/Kit';
import s from '@/ui/Ui.module.css';

interface Applied { at: string; account: string; vacancy_id: string; title: string; company: string; salary_from: number | null; salary_to: number | null; url: string }
const PAGE = 100;

const fmtN = (n: number) => n.toLocaleString('ru');
const sal = (i: Applied) => (i.salary_from && i.salary_to ? `${fmtN(i.salary_from)} — ${fmtN(i.salary_to)}` : i.salary_from ? `от ${fmtN(i.salary_from)}` : i.salary_to ? `до ${fmtN(i.salary_to)}` : '');

export function AppliedTab() {
  const t = useT();
  const names = useApp((x) => x.snapshot?.accounts);
  const alias = useAliasOf();
  const { data, error, loading, reload } = useFetch<Applied[]>('/api/applied', { limit: 2000 });
  const [q, setQ] = useState('');
  const [acc, setAcc] = useState('');
  const [named, setNamed] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const { sort, onSort } = useSort('at');

  const items = Array.isArray(data) ? data : [];
  const active = useMemo(() => new Set((names ?? []).flatMap((a) => [a.hh_name ?? a.name, a.hh_short ?? a.short]).filter(Boolean)), [names]);
  const accs = useMemo(() => [...new Set(items.map((i) => i.account).filter((a) => a && active.has(a)))].sort(), [items, active]);
  const rows = useMemo(() => {
    const n = q.toLowerCase();
    const f = items.filter((i) => (!acc || i.account === acc) && (!named || i.title || i.company) && (!n || (i.title || '').toLowerCase().includes(n) || (i.company || '').toLowerCase().includes(n) || (i.vacancy_id || '').includes(n)));
    return sortRows(f, sort);
  }, [items, q, acc, named, sort]);

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    return {
      today: items.filter((i) => new Date(i.at).toDateString() === today).length,
      salary: items.filter((i) => i.salary_from || i.salary_to).length,
      companies: new Set(items.map((i) => i.company).filter(Boolean)).size,
    };
  }, [items]);

  const cols: Col<Applied>[] = [
    { key: 'title', label: t('col_vacancy'), sort: true, render: (i) => <JobCell title={i.title} company={i.company} href={safeHref(i.url)} fallback={`hh.ru/vacancy/${i.vacancy_id}`} /> },
    { key: 'account', label: t('col_account'), sort: true, nowrap: true, render: (i) => <AccChip name={i.account || ''} /> },
    { key: 'salary_from', label: t('col_salary'), sort: true, nowrap: true, render: (i) => (sal(i) ? <span className={`${s.ok} ${s.mono}`}>{sal(i)}</span> : <span className={s.dim}>—</span>) },
    { key: 'at', label: t('col_date'), sort: true, nowrap: true, render: (i) => <span className={`${s.dim} ${s.mono}`}>{fmtDate(i.at)}</span> },
  ];

  return (
    <div className={s.page}>
      <PageHead title={t('applied_title')} count={rows.length.toLocaleString('ru')} sub="Все вакансии, на которые бот отправил отклик.">
        <button className={s.btn} onClick={() => downloadCsv('applied.csv', ['Дата', 'Аккаунт', 'Вакансия', 'Компания', 'Зарплата', 'URL'], rows.map((i) => [i.at, i.account, i.title, i.company, sal(i), i.url]))} disabled={!rows.length}><Icon name="arrow-down" size={13} />Скачать CSV</button>
        <button className={s.btn} onClick={() => void reload()} disabled={loading}><Icon name="refresh-cw" size={13} />Обновить</button>
      </PageHead>
      {data && items.length > 0 && (
        <Stats items={[
          { label: 'всего откликов', value: items.length.toLocaleString('ru') },
          { label: 'сегодня', value: stats.today, tone: stats.today ? 'ok' : undefined },
          { label: 'с указанной зарплатой', value: stats.salary.toLocaleString('ru') },
          { label: 'разных компаний', value: stats.companies.toLocaleString('ru') },
        ]} />
      )}
      <div className={s.filters}>
        <Search value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder={t('applied_search_ph')} />
        <Select value={acc} onChange={(e) => setAcc(e.target.value)}>
          <option value="">{t('applied_all_accs')}</option>
          {accs.map((a) => <option key={a} value={a}>{alias(a)}</option>)}
        </Select>
        <CheckPill checked={named} onChange={setNamed}>{t('applied_only_named')}</CheckPill>
      </div>
      {error && <Empty icon="triangle-alert" title="Не удалось загрузить отклики" hint={error}><button className={s.btn} onClick={() => void reload()}>Повторить</button></Empty>}
      {!error && !data && <Skeleton />}
      {data && rows.length === 0 && <Empty icon="check" title={items.length ? 'Ничего не найдено' : 'Откликов пока не было'} hint={items.length ? 'Измените поиск или фильтры.' : 'Когда бот откликнется на вакансию, она появится здесь.'} />}
      {data && rows.length > 0 && <SortTable cols={cols} rows={rows.slice(0, shown)} sort={sort} onSort={onSort} rowKey={(i, n) => `${i.vacancy_id}-${i.at}-${n}`} />}
      {rows.length > shown && (
        <div className={s.more}>
          <button className={s.btn} onClick={() => setShown((v) => v + PAGE)}>{t('btn_show_more')}</button>
          <span style={{ marginLeft: 8 }}>{shown} из {rows.length}</span>
        </div>
      )}
    </div>
  );
}

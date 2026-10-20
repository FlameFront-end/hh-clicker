import { Icon } from '@/components/Icon';
import { useT } from '@/store/app';
import { useFetch } from '@/lib/useFetch';
import { fmtDate, safeHref, shortAcc } from '@/lib/safe';
import { SortTable, type Col } from '@/ui/Table';
import s from '@/ui/Ui.module.css';

interface TestItem { at: string; vacancy_id: string; title: string; company: string; account_name: string; resume_hash: string; applied_by: string[]; url: string }

export function TestsTab() {
  const t = useT();
  const { data, error, loading, reload } = useFetch<TestItem[]>('/api/tests', { limit: 300 });
  const items = Array.isArray(data) ? data : [];
  const cols: Col<TestItem>[] = [
    { key: 'at', label: t('col_date'), nowrap: true, render: (i) => <span className={s.dim}>{fmtDate(i.at)}</span> },
    { key: 'title', label: t('col_vacancy'), render: (i) => i.title || i.vacancy_id },
    { key: 'company', label: t('col_company'), render: (i) => i.company },
    { key: 'acc', label: t('col_account'), render: (i) => {
      const n = shortAcc(i.account_name || '');
      return i.resume_hash ? <a href={`https://hh.ru/resume/${encodeURIComponent(i.resume_hash)}`} target="_blank" rel="noopener noreferrer">{n}</a> : <span className={s.dim}>{n || '—'}</span>;
    } },
    { key: 'applied', label: t('col_applied_yn'), render: (i) => i.applied_by?.length ? <span className={s.ok}><Icon name="check" size={12} /> {i.applied_by.map(shortAcc).join(', ')}</span> : <span className={s.dim}>—</span> },
    { key: 'url', label: t('col_link'), render: (i) => <a href={safeHref(i.url)} target="_blank" rel="noopener noreferrer">hh.ru/vacancy/{i.vacancy_id}</a> },
  ];
  return (
    <div className={s.page}>
      <div className={s.head}>
        <h2 className={s.title}>{t('tests_title')} <span className={s.count}>({items.length})</span></h2>
        <span className={s.grow} />
        <button className={s.btn} onClick={() => void reload()} disabled={loading}><Icon name="refresh-cw" size={13} />Обновить</button>
      </div>
      {error && <div className={`${s.state} ${s.bad}`}>{error}</div>}
      {!error && !data && <div className={s.state}>Загрузка…</div>}
      {data && <SortTable cols={cols} rows={items} sort={{ field: '', dir: -1 }} onSort={() => undefined} rowKey={(i, n) => `${i.vacancy_id}-${n}`} />}
    </div>
  );
}

import { Icon } from '@/components/Icon';
import { useT } from '@/store/app';
import { useFetch } from '@/lib/useFetch';
import { fmtDate, safeHref } from '@/lib/safe';
import { SortTable, type Col } from '@/ui/Table';
import { AccChip, Empty, JobCell, PageHead, Pill, Skeleton, Stats } from '@/ui/Kit';
import s from '@/ui/Ui.module.css';

interface TestItem { at: string; vacancy_id: string; title: string; company: string; account_name: string; resume_hash: string; applied_by: string[]; url: string }

export function TestsTab() {
  const t = useT();
  const { data, error, loading, reload } = useFetch<TestItem[]>('/api/tests', { limit: 300 });
  const items = Array.isArray(data) ? data : [];
  const done = items.filter((i) => i.applied_by?.length).length;
  const cols: Col<TestItem>[] = [
    { key: 'title', label: t('col_vacancy'), render: (i) => <JobCell title={i.title} company={i.company} href={safeHref(i.url)} fallback={`hh.ru/vacancy/${i.vacancy_id}`} /> },
    { key: 'acc', label: t('col_account'), nowrap: true, render: (i) => {
      const chip = <AccChip name={i.account_name || ''} />;
      return i.resume_hash ? <a href={`https://hh.ru/resume/${encodeURIComponent(i.resume_hash)}`} target="_blank" rel="noopener noreferrer" title="Открыть резюме">{chip}</a> : chip;
    } },
    { key: 'applied', label: 'Статус', nowrap: true, render: (i) => i.applied_by?.length
      ? <Pill tone="ok" icon="check">Откликнулись · {i.applied_by.length}</Pill>
      : <Pill tone="warn" icon="flask-conical">Ждёт теста</Pill> },
    { key: 'at', label: t('col_date'), nowrap: true, render: (i) => <span className={`${s.dim} ${s.mono}`}>{fmtDate(i.at)}</span> },
  ];
  return (
    <div className={s.page}>
      <PageHead title={t('tests_title')} count={items.length.toLocaleString('ru')} sub="Вакансии, где работодатель просит пройти тест перед откликом.">
        <button className={s.btn} onClick={() => void reload()} disabled={loading}><Icon name="refresh-cw" size={13} />Обновить</button>
      </PageHead>
      {data && items.length > 0 && (
        <Stats items={[
          { label: 'вакансий с тестом', value: items.length.toLocaleString('ru') },
          { label: 'уже откликнулись', value: done.toLocaleString('ru'), tone: done ? 'ok' : undefined },
          { label: 'ждут прохождения', value: (items.length - done).toLocaleString('ru'), tone: items.length - done ? 'warn' : undefined, hint: 'Включите «Откликаться на вакансии с тестом» в настройках аккаунта' },
        ]} />
      )}
      {error && <Empty icon="triangle-alert" title="Не удалось загрузить список" hint={error}><button className={s.btn} onClick={() => void reload()}>Повторить</button></Empty>}
      {!error && !data && <Skeleton />}
      {data && items.length === 0 && <Empty icon="flask-conical" title="Вакансий с тестами пока нет" hint="Если бот встретит вакансию с тестом, она появится здесь." />}
      {data && items.length > 0 && <SortTable cols={cols} rows={items} sort={{ field: '', dir: -1 }} onSort={() => undefined} rowKey={(i, n) => `${i.vacancy_id}-${n}`} />}
    </div>
  );
}

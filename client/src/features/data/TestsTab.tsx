import { Icon } from '@/components/Icon';
import { useState } from 'react';
import { post } from '@/lib/api';
import { useT } from '@/store/app';
import { useFetch } from '@/lib/useFetch';
import { fmtDate, safeHref } from '@/lib/safe';
import { SortTable, type Col } from '@/ui/Table';
import { AccChip, Empty, JobCell, PageHead, Pill, Skeleton, Stats } from '@/ui/Kit';
import s from '@/ui/Ui.module.css';

interface TestItem { at: string; vacancy_id: string; title: string; company: string; account_name: string; resume_hash: string; applied_by: string[]; url: string; status?: string }

function ResolveReview({ item, reload }: { item: TestItem; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const resolve = async () => {
    if (busy || !window.confirm(`Вы проверили на HH, что отклика на «${item.title || item.vacancy_id}» от ${item.account_name} действительно нет? Бот сможет отправить его в следующем цикле. Пауза профиля останется включена.`)) return;
    setBusy(true);
    try {
      const result = await post<{ ok?: boolean; error?: string }>(`/api/tests/${encodeURIComponent(item.vacancy_id)}/resolve`, { account_name: item.account_name, resume_hash: item.resume_hash, expected_at: item.at, confirmed_not_sent: true });
      if (!result.ok) throw new Error(result.error || 'Не удалось сохранить');
      setMessage('Повтор разрешён. Если профиль на паузе — включите его отдельно.');
      await reload();
    } catch (error) { setMessage(`Решение не подтверждено: ${error instanceof Error ? error.message : String(error)}. Обновите список перед повтором.`); }
    finally { setBusy(false); }
  };
  return <div><button className={s.btn} disabled={busy} onClick={() => void resolve()}>{busy ? 'Сохраняю…' : 'Проверил HH: отклика нет'}</button>{message && <p role="status">{message}</p>}</div>;
}

export function TestsTab() {
  const t = useT();
  const { data, error, loading, reload } = useFetch<TestItem[]>('/api/tests', { limit: 300 }, 15000);
  const items = Array.isArray(data) ? data : [];
  const done = items.filter((i) => i.status === 'sent').length;
  const pending = items.filter((i) => i.status === 'pending' || i.status === 'retry').length;
  const review = items.length - done - pending;
  const cols: Col<TestItem>[] = [
    { key: 'title', label: t('col_vacancy'), render: (i) => <JobCell title={i.title} company={i.company} href={safeHref(i.url)} fallback={`hh.ru/vacancy/${i.vacancy_id}`} /> },
    { key: 'acc', label: t('col_account'), nowrap: true, render: (i) => {
      const chip = <AccChip name={i.account_name || ''} />;
      return i.resume_hash ? <a href={`https://hh.ru/resume/${encodeURIComponent(i.resume_hash)}`} target="_blank" rel="noopener noreferrer" title="Открыть резюме">{chip}</a> : chip;
    } },
    { key: 'applied', label: 'Статус', render: (i) => i.status === 'sent'
      ? <Pill tone="ok" icon="check">Отклик подтверждён</Pill>
      : i.status === 'retry' ? <Pill tone="warn" icon="refresh-cw">Повтор разрешён пользователем</Pill>
      : i.status === 'pending' ? <Pill tone="warn" icon="flask-conical">Нужен тест / анкета</Pill>
      : <a href="https://hh.ru/applicant/negotiations" target="_blank" rel="noopener noreferrer"><Pill tone="warn" icon="triangle-alert">{i.status === 'review' ? 'Отправка не подтверждена — проверить HH' : 'Старый статус неизвестен — проверить HH'}</Pill></a> },
    { key: 'at', label: t('col_date'), nowrap: true, render: (i) => <span className={`${s.dim} ${s.mono}`}>{fmtDate(i.at)}</span> },
    { key: 'resolve', label: 'После проверки HH', render: (i) => (i.status === 'review' || i.status === 'unknown') && i.account_name && i.resume_hash ? <ResolveReview item={i} reload={reload} /> : null },
  ];
  return (
    <div className={s.page}>
      <PageHead title={t('tests_title')} count={items.length.toLocaleString('ru')} sub="Тесты, анкеты и отправки, результат которых требует проверки. До 300 последних записей; автообновление каждые 15 секунд.">
        <button className={s.btn} onClick={() => void reload()} disabled={loading}><Icon name="refresh-cw" size={13} />Обновить</button>
      </PageHead>
      {data && items.length > 0 && (
        <Stats items={[
          { label: 'вакансий с тестом', value: items.length.toLocaleString('ru') },
          { label: 'уже откликнулись', value: done.toLocaleString('ru'), tone: done ? 'ok' : undefined },
          { label: 'нужен тест / анкета', value: pending, tone: pending ? 'warn' : undefined },
          { label: 'проверить на HH', value: review, tone: review ? 'warn' : undefined, hint: 'Не отправляйте повторно, пока не проверите результат на HH.' },
        ]} />
      )}
      {error && <Empty icon="triangle-alert" title="Не удалось загрузить список" hint={error}><button className={s.btn} onClick={() => void reload()}>Повторить</button></Empty>}
      {!error && !data && <Skeleton />}
      {data && items.length === 0 && <Empty icon="flask-conical" title="Вакансий с тестами пока нет" hint="Если бот встретит вакансию с тестом, она появится здесь." />}
      {data && items.length > 0 && <SortTable cols={cols} rows={items} sort={{ field: '', dir: -1 }} onSort={() => undefined} rowKey={(i, n) => `${i.vacancy_id}-${n}`} />}
    </div>
  );
}

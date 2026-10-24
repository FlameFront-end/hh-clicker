import type { Account } from '@/types/snapshot';
import { eventTime } from './metrics';
import { applyErrorCount, applyErrorReason } from './metrics';
import s from './AccountCard.module.css';

export function ApplyErrors({ acc, en }: { acc: Account; en: boolean }) {
  const entries = acc.apply_errors ?? [];
  return <details className={s.errorDetails}>
    <summary>{applyErrorCount(acc.errors, en)}</summary>
    <div className={s.errorBody}>
      <p>{en ? 'Failures during this run, not necessarily a current problem. Kept separately from the recent journal.' : 'Неудачные попытки за этот запуск — не обязательно текущая проблема. Хранятся отдельно от последних событий журнала.'}</p>
      {!entries.length && <p>{en ? 'Details were not recorded by the previous version. The count alone does not identify the cause.' : 'Предыдущая версия не сохранила подробности. По одному счётчику причину определить нельзя.'}</p>}
      {entries.map((e, i) => <div className={s.errorEntry} key={`${e.time}-${i}`}>
        <time dateTime={e.time}>{eventTime(e.time, en)}</time>
        <span>{applyErrorReason(e.reason, en)}</span>
        {(e.http_status || e.error_code) && <small>{[e.http_status ? `HTTP ${e.http_status}` : '', e.error_code].filter(Boolean).join(' · ')}</small>}
        {/^\d+$/.test(e.vacancy_id) && <a href={`https://hh.ru/vacancy/${e.vacancy_id}`} target="_blank" rel="noopener noreferrer">{e.title || `${en ? 'Vacancy' : 'Вакансия'} №${e.vacancy_id}`}</a>}
      </div>)}
      {entries.length > 0 && acc.errors > entries.length && <p>{en ? `Showing the latest ${entries.length} failures.` : `Показаны последние ${entries.length} неудачных попыток.`}</p>}
    </div>
  </details>;
}

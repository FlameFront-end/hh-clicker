import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, stripEmoji } from '@/components/Icon';
import { useAliasOf, useApp } from '@/store/app';
import { mainCopy } from './copy';
import { eventTime, applyErrorReason } from './metrics';
import s from './Recent.module.css';

export function Recent() {
  const list = useApp((x) => x.snapshot?.recent_responses) ?? [];
  const en = useApp((x) => x.lang) === 'en';
  const c = mainCopy(en);
  const alias = useAliasOf();
  const [filter, setFilter] = useState('all');
  const labels: Record<string, string> = { sent: c.sent, test: c.test, already: c.already, error: c.error, limit: c.limit, captcha: c.attention };
  const rows = list.filter((r) => filter === 'all' || (filter === 'sent' ? r.result === 'sent' : ['error', 'limit', 'captcha'].includes(r.result))).slice(0, 40);
  return <section className={s.card} aria-labelledby="activity-title">
    <header className={s.heading}><h2 id="activity-title">{c.actions}</h2><Link to="/applied">{en ? 'History' : 'История'}<Icon name="chevron-right" size={13} /></Link></header>
    <div className={s.filters} role="group" aria-label={c.actions}>
      {(['all', 'sent', 'issues'] as const).map((key) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{c[key]}</button>)}
    </div>
    <div className={s.list}>
      {!rows.length && <div className={s.none}><Icon name="inbox" size={22} /><p>{list.length ? c.noMatches : c.noActions}</p></div>}
      {rows.map((r, i) => <article key={[r.id, r.time, r.result, i].join('-')} className={s.item}>
        <div className={s.row1}>
          <time dateTime={/^\d{4}-/.test(r.time) ? r.time : undefined}>{eventTime(r.time, en)}</time>
          <span className={s.acc}>{stripEmoji(alias(r.account_name || r.acc))}</span>
          <span className={[s.result, r.result === 'sent' ? s.ok : ['error', 'limit', 'captcha'].includes(r.result) ? s.bad : s.warn].join(' ')} title={labels[r.result] || r.result}>
            <Icon name={r.result === 'sent' ? 'check' : r.result === 'test' ? 'flask-conical' : r.result === 'already' ? 'clock' : 'triangle-alert'} size={12} />{r.result !== 'sent' && (labels[r.result] || r.result)}
          </span>
        </div>
        {/^\d+$/.test(r.id) ? <a className={s.vac} href={'https://hh.ru/vacancy/' + r.id} target="_blank" rel="noopener noreferrer" aria-label={c.open + ': ' + (r.title || r.id)}>{r.title || c.vacancy + ' №' + r.id}<Icon name="external-link" size={12} /></a> : <div className={s.vac}>{r.title || c.vacancy}</div>}
        {r.company && <div className={s.meta}>{r.company}{r.salary ? ' · ' + r.salary : ''}</div>}
        {r.result === 'error' && <details className={s.failure}><summary>{en ? 'Why it was not confirmed' : 'Почему отправка не подтверждена'}</summary><p>{applyErrorReason(r.error_detail?.reason, en)}</p>{r.error_detail?.http_status && <small>HTTP {r.error_detail.http_status}</small>}{r.error_detail?.error_code && <small> · {r.error_detail.error_code}</small>}<p><a href="https://hh.ru/applicant/negotiations" target="_blank" rel="noopener noreferrer">{en ? 'Check applications on HH' : 'Проверить отклики на HH'}</a></p></details>}
      </article>)}
    </div>
    <p className={s.zone}>{en ? 'Up to 40 recent events. Open History for all saved applications.' : 'До 40 последних событий. Все сохранённые отклики — в истории.'}</p>
  </section>;
}

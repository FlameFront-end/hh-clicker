import { useState } from 'react';
import { get, post } from '@/lib/api';
import { safeHref } from '@/lib/safe';
import s from '@/ui/Ui.module.css';
import v from './Views.module.css';
import { Err, Item, Section, useLoader, type Json } from './bits';

const hhVac = (id: string) => `https://hh.ru/vacancy/${encodeURIComponent(id)}`;

export function HotLeads({ idx }: { idx: string }) {
  const l = useLoader(() => get<Json>(`/api/account/${idx}/hot_leads`), idx || undefined);
  const offers: Json[] = l.data?.offers ?? [];
  return (
    <Section icon="flame" title="Горячие лиды" desc="Работодатели, которые проявили к вам интерес" tone={s.warn}
      actions={<button className={s.btn} disabled={l.busy || !idx} onClick={l.run}>Обновить</button>}
      status={l.busy ? 'Загружаю…' : l.data ? `${l.data.total ?? 0} работодателей` : <Err text={l.err} />}>
      {l.data && !offers.length && <span className={s.dim}>Нет горячих лидов</span>}
      {offers.map((o, i) => (
        <Item key={i} title={<>{o.employer}{o.has_invitation && <span className={`${s.tag} ${s.ok}`} style={{ marginLeft: 8 }}>приглашение</span>}{o.vacancy_id && <a style={{ marginLeft: 8, fontSize: 11 }} href={hhVac(o.vacancy_id)} target="_blank" rel="noopener noreferrer">→ вакансия</a>}</>}
          sub={(o.vacancies ?? []).slice(0, 2).join(', ')} />
      ))}
    </Section>
  );
}

export function HrContacts() {
  const l = useLoader(() => get<Json>('/api/hr_contacts'), 'hr');
  const rows: Json[] = (l.data?.contacts ?? []).slice().reverse();
  return (
    <Section icon="contact" title="Контакты HR" desc="Собираются автоматически при откликах"
      actions={<button className={s.btn} disabled={l.busy} onClick={l.run}>Обновить</button>}
      status={l.busy ? 'Загружаю…' : l.data ? `${l.data.total ?? 0} контактов` : <Err text={l.err} />}>
      {l.data && !rows.length && <span className={s.dim}>Нет собранных контактов — они собираются автоматически при откликах.</span>}
      {rows.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Время</th><th>Вакансия</th><th>Компания</th><th>ФИО</th><th>Email</th><th>Телефон</th></tr></thead>
            <tbody>{rows.map((c, i) => (
              <tr key={i}>
                <td className={`${s.dim} ${s.nowrap}`}>{c.time}</td>
                <td>{c.vacancy_id ? <a href={hhVac(c.vacancy_id)} target="_blank" rel="noopener noreferrer">{c.title || c.vacancy_id}</a> : c.title}</td>
                <td className={s.dim}>{c.company}</td><td>{c.fio}</td>
                <td>{c.email && <a href={`mailto:${encodeURIComponent(c.email)}`}>{c.email}</a>}</td><td>{c.phone}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function Remindable({ idx }: { idx: string }) {
  const l = useLoader(() => get<Json>(`/api/account/${idx}/remindable`), idx || undefined);
  const items: Json[] = l.data?.remindable ?? [];
  return (
    <Section icon="bell" title="Можно напомнить" desc="Переговоры, где можно отправить напоминание работодателю"
      actions={<button className={s.btn} disabled={l.busy || !idx} onClick={l.run}>Обновить</button>}
      status={l.busy ? 'Проверяю…' : l.data ? `${l.data.total ?? 0} переговоров` : <Err text={l.err} />}>
      {l.data && !items.length && <span className={s.dim}>Нет переговоров, где можно отправить напоминание.</span>}
      {items.map((it, i) => <Item key={i} title={it.employer || '?'} sub={it.vacancy} />)}
    </Section>
  );
}

export function OAuthBox({ idx }: { idx: string }) {
  const [st, setSt] = useState<{ text: string; kind: 'ok' | 'warn' | 'bad' | 'dim' }>({ text: '', kind: 'dim' });
  const [busy, setBusy] = useState(false);
  const act = async (path: string, fmt: (d: Json) => [string, 'ok' | 'warn' | 'bad']) => {
    setBusy(true); setSt({ text: 'Выполняю…', kind: 'dim' });
    try {
      const d = await post<Json>(`/api/account/${idx}/${path}`);
      const [text, kind] = fmt(d);
      setSt({ text, kind });
    } catch (e) { setSt({ text: String(e), kind: 'bad' }); }
    finally { setBusy(false); }
  };
  return (
    <Section icon="key-round" title="Доступ через API HH" desc="Токен для откликов и подъёма резюме без браузерной сессии" tone={s.ok}
      actions={<>
        <button className={s.btn} disabled={busy || !idx} onClick={() => void act('oauth_token', (d) => d.ok ? [`Токен получен · ${Math.round(d.expires_in / 3600)}ч · refresh: ${d.has_refresh ? 'да' : 'нет'}`, 'ok'] : [d.error || 'Ошибка', 'bad'])}>Получить токен</button>
        <button className={s.btn} disabled={busy || !idx} onClick={() => void act('oauth_touch', (d) => d.ok ? [d.message, 'ok'] : [d.message || d.error, 'warn'])}>Поднять резюме</button>
      </>}
      status={st.text ? <span className={s[st.kind]}>{st.text}</span> : undefined} />
  );
}

export { safeHref, v };

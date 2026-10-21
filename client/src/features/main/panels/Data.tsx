import { useState } from 'react';
import { Select } from '@/ui/radix';
import { del, post, put } from '@/lib/api';
import { alertDialog, confirmDialog, promptDialog } from '@/ui/dialog';
import s from '@/ui/Ui.module.css';
import { Fold } from './Fold';
import p from './Panels.module.css';
import { useLoad } from './useLoad';

type Obj = Record<string, unknown>;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const label = (it: unknown): string => {
  if (!it || typeof it !== 'object') return '—';
  const o = it as Obj; const emp = o.employer as Obj | undefined;
  return String(o.name || o.title || o.employer_name || emp?.name || emp?.id || o.text || o.id || '—');
};

function State({ loading, error, children }: { loading: boolean; error: string; children: React.ReactNode }) {
  if (loading) return <span className={p.dim}>Загружаю…</span>;
  if (error) return <span className={p.bad}>{error}</span>;
  return <>{children}</>;
}
const Refresh = ({ onClick }: { onClick: () => void }) => <div><button className={`${s.btn} ${p.sm}`} onClick={onClick}>Обновить</button></div>;

/* Карьерный радар */
function Bars({ items, k, suffix = '' }: { items: unknown; k: string; suffix?: string }) {
  const rows = (Array.isArray(items) ? items : []).filter((x): x is Obj => !!x && Number.isFinite(Number((x as Obj)[k])));
  if (!rows.length) return <span className={p.dim}>Нет данных</span>;
  const max = Math.max(...rows.map((x) => Number(x[k])), 1);
  return <>{rows.map((x, i) => (
    <div key={i} className={p.bar}>
      <span>{String(x.year ?? '—')}</span>
      <span className={p.track}><i style={{ width: `${Math.max(4, Math.round((Number(x[k]) / max) * 100))}%` }} /></span>
      <b>{Number(x[k]).toLocaleString('ru')}{suffix}</b>
    </div>
  ))}</>;
}
function RadarBody({ idx }: { idx: number }) {
  const { data: d, error, loading, reload } = useLoad<Obj & { ok?: boolean }>(`/api/account/${idx}/career_radar`);
  return (
    <State loading={loading} error={error}>
      <b className={p.accent}>{String(d?.profession || 'Профессия')} · {String(d?.grade || 'грейд не указан')}</b>
      <span className={p.dim}>Средняя зарплата по годам</span><Bars items={d?.salary} k="salary" suffix=" ₽" />
      <span className={p.dim}>Количество вакансий</span><Bars items={d?.vacancies} k="vacancy_count" />
      <Refresh onClick={() => void reload()} />
    </State>
  );
}
export const CareerRadar = ({ idx }: { idx: number }) => <Fold icon="trending-up" title="Карьерный радар" desc="Какие вакансии и зарплаты сейчас в вашей нише"><RadarBody idx={idx} /></Fold>;

/* Видимость резюме */
function VisibilityBody({ idx }: { idx: number }) {
  const { data: d, error, loading, reload } = useLoad<Obj & { ok?: boolean }>(`/api/account/${idx}/resume_visibility`);
  const active = (d?.active ?? {}) as Obj;
  const warn = !!d?.warning;
  const types = (Array.isArray(d?.access_types) ? d.access_types : []) as Obj[];
  return (
    <State loading={loading} error={error}>
      <b className={warn ? p.bad : p.ok}>{warn ? 'Проверьте ограничения: ' : 'Активная видимость: '}{String(active.name || active.id || 'не определена')}</b>
      {types.map((x, i) => <div key={i} className={`${p.opt} ${x.active ? p.optOn : ''}`}>{x.active ? '● ' : '○ '}{String(x.name || x.id || '')}</div>)}
      <span className={p.dim}>Чёрный список: <b>{Number(d?.blacklist_total || 0)}</b> · Белый список: <b>{Number(d?.whitelist_total || 0)}</b></span>
      <span className={p.warn}>Изменение видимости выполняйте осознанно в HH; панель только проверяет состояние.</span>
      <Refresh onClick={() => void reload()} />
    </State>
  );
}
export const Visibility = ({ idx }: { idx: number }) => <Fold icon="eye" title="Видимость резюме" desc="Кто видит ваше резюме и можно ли его скрыть от компаний"><VisibilityBody idx={idx} /></Fold>;

/* Автопоиски */
function AutosearchBody({ idx }: { idx: number }) {
  const { data: d, error, loading, reload } = useLoad<{ ok?: boolean; items?: Obj[] }>(`/api/account/${idx}/autosearches`);
  const call = async (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    try { const r = await fn(); if (!r.ok) return void alertDialog(r.error || 'Ошибка HH'); void reload(); } catch (e) { void alertDialog(errMsg(e)); }
  };
  const base = (id: unknown) => `/api/account/${idx}/autosearches/${encodeURIComponent(String(id ?? ''))}`;
  const items = d?.items ?? [];
  return (
    <State loading={loading} error={error}>
      {items.length === 0 && <span className={p.dim}>Сохранённых поисков нет.</span>}
      {items.map((x, i) => (
        <div key={i} className={p.item}>
          <span><b>{String(x.name || 'Без названия')}</b> <span className={p.ok}>+{Number(x.new_count) || 0} новых</span></span>
          <span className={p.row}>
            <button className={`${s.btn} ${p.sm}`} onClick={async () => { const name = await promptDialog('Новое название автопоиска:'); if (name) void call(() => put(base(x.id), { name })); }}>Имя</button>
            <button className={`${s.btn} ${p.sm}`} onClick={async () => { const on = x.email_subscription !== false; if (await confirmDialog(`${on ? 'Отключить' : 'Включить'} email-подписку этого автопоиска?`)) void call(() => put(base(x.id), { email_subscription: !on })); }}>Подписка</button>
            <button className={`${s.btn} ${s.btnDanger} ${p.sm}`} onClick={async () => { if (await confirmDialog('Удалить этот автопоиск из HH? Отменить автоматически нельзя.', { danger: true })) void call(() => del(base(x.id))); }}>Удалить</button>
          </span>
        </div>
      ))}
    </State>
  );
}
export const Autosearches = ({ idx }: { idx: number }) => <Fold icon="search" title="Автопоиски HH" desc="Сохранённые поиски на hh.ru и уведомления по ним"><AutosearchBody idx={idx} /></Fold>;

/* Скрытые вакансии и работодатели */
function HiddenBody({ idx }: { idx: number }) {
  const { data: d, error, loading, reload } = useLoad<Obj & { ok?: boolean }>(`/api/account/${idx}/hidden`);
  const restore = async (kind: string, id: string) => {
    if (!id || !(await confirmDialog('Вернуть этот объект из скрытого списка HH?'))) return;
    try { const r = await del<{ ok?: boolean; error?: string }>(`/api/account/${idx}/hidden/${kind}/${encodeURIComponent(id)}`); if (!r.ok) return void alertDialog(r.error || 'Ошибка HH'); void reload(); } catch (e) { void alertDialog(errMsg(e)); }
  };
  const section = (title: string, kind: string, items: unknown, total: unknown) => (
    <div>
      <div className={p.accent}>{title}: {String(total ?? 0)}</div>
      {((Array.isArray(items) ? items : []) as Obj[]).map((x, i) => (
        <div key={i} className={p.item}><span>{label(x)}</span><button className={`${s.btn} ${p.sm}`} onClick={() => void restore(kind, String(x.id || x.vacancy_id || x.employer_id || ''))}>Вернуть</button></div>
      ))}
      {!(Array.isArray(items) && items.length) && <span className={p.dim}>Список пуст</span>}
    </div>
  );
  return <State loading={loading} error={error}>{section('Вакансии', 'vacancy', d?.vacancies, d?.vacancies_total)}{section('Работодатели', 'employer', d?.employers, d?.employers_total)}</State>;
}
export const Hidden = ({ idx }: { idx: number }) => <Fold icon="ban" title="Скрытые вакансии и работодатели" desc="Что вы убрали из выдачи — можно вернуть обратно"><HiddenBody idx={idx} /></Fold>;

/* Уведомления HH */
function BellBody({ idx }: { idx: number }) {
  const { data: d, error, loading } = useLoad<{ ok?: boolean; notifications?: Obj[] }>(`/api/account/${idx}/bell_notifications`);
  const items = (d?.notifications ?? []).slice(0, 30);
  return (
    <State loading={loading} error={error}>
      {items.length === 0 && <span className={p.dim}>Новых уведомлений нет.</span>}
      {items.map((x, i) => <div key={i} className={p.item} style={{ color: x.viewed ? 'var(--dim)' : 'var(--text)' }}>{label(x)}</div>)}
    </State>
  );
}
export const Bell = ({ idx }: { idx: number }) => <Fold icon="bell" title="Уведомления HH" desc="Последние уведомления с hh.ru: приглашения, просмотры, сообщения"><BellBody idx={idx} /></Fold>;

/* Конверсия */
function ConversionBody({ idx }: { idx: number }) {
  const { data: d, error, loading } = useLoad<{ ok?: boolean; conversion_percent?: number; applied?: number; interviews?: number }>(`/api/account/${idx}/conversion`);
  return (
    <State loading={loading} error={error}>
      <div className={p.kpis}>
        <div><span className={p.big}>{d?.conversion_percent}%</span><span className={p.dim}>конверсия</span></div>
        <div><b>{d?.applied}</b><span className={p.dim}>откликов</span></div>
        <div><b className={p.ok}>{d?.interviews}</b><span className={p.dim}>интервью</span></div>
      </div>
    </State>
  );
}
export const Conversion = ({ idx }: { idx: number }) => <Fold icon="target" title="Конверсия откликов" desc="Сколько откликов дошло до просмотра и приглашения"><ConversionBody idx={idx} /></Fold>;

/* Нативный автоотклик HH Pro */
interface ArData { ok?: boolean; error?: string; rules?: Obj[]; statistics?: Record<string, { counters?: Obj }> }
function AutoResponseBody({ idx, resumeHash }: { idx: number; resumeHash: string }) {
  const { data: d, error, loading, reload } = useLoad<ArData>(`/api/account/${idx}/auto_response`);
  const [roles, setRoles] = useState(''); const [exp, setExp] = useState(''); const [salary, setSalary] = useState(''); const [only, setOnly] = useState(false);
  const rules = d?.rules ?? [];
  const create = async () => {
    if (!resumeHash) return void alertDialog('Сначала выберите резюме в карточке аккаунта');
    if (!(await confirmDialog('Создать серверное правило автоотклика HH для выбранного резюме?'))) return;
    const filters: Obj = {};
    const ids = roles.split(',').map((v) => v.trim()).filter(Boolean);
    if (ids.length) filters.professional_roles = ids;
    if (exp) filters.experience = exp;
    if (parseInt(salary, 10) > 0) filters.salary = { currency_code: 'RUR', from: parseInt(salary, 10) };
    if (only) filters.only_with_salary = true;
    try {
      const r = await post<{ ok?: boolean; error?: string }>(`/api/account/${idx}/auto_response`, { confirm: true, resume_id: resumeHash, filters } as never);
      if (!r.ok) throw new Error(r.error);
      void reload();
    } catch (e) { void alertDialog(`Не удалось создать правило: ${errMsg(e)}`); }
  };
  const toggle = async (id: string, enabled: boolean) => {
    const action = enabled ? 'включить' : 'выключить';
    if (!(await confirmDialog(`Точно ${action} серверный автоотклик HH?`))) return;
    try {
      const r = await put<{ ok?: boolean; error?: string }>(`/api/account/${idx}/auto_response/${encodeURIComponent(id)}`, { confirm: true, resume_id: resumeHash, enabled });
      if (!r.ok) throw new Error(r.error);
      void reload();
    } catch (e) { void alertDialog(`Не удалось ${action} автоотклик: ${errMsg(e)}`); }
  };
  return (
    <>
      <State loading={loading} error={error}>
        <span className={p.dim}>{rules.length ? `Найдено правил: ${rules.length}` : 'Правил пока нет. Создание может требовать подписку HH Pro.'}</span>
        {rules.map((r, i) => {
          const id = String(r.auto_response_id || r.id || '');
          const on = r.enabled === true;
          const c = (d?.statistics?.[id]?.counters ?? {}) as Obj;
          return (
            <div key={i} className={p.rule}>
              <div className={p.item} style={{ border: 0, padding: 0 }}>
                <b className={on ? p.ok : p.dim}>{on ? '● Включён' : '○ Выключен'}</b>
                <button className={`${s.btn} ${p.sm}`} onClick={() => void toggle(id, !on)}>{on ? 'Выключить' : 'Включить'}</button>
              </div>
              <span className={p.dim}>За 7 дней: откликов <b>{Number(c.total || 0)}</b> · приглашений <b>{Number(c.invitation || 0)}</b> · вакансий <b>{Number(c.vacancy_from_search_count || 0)}</b></span>
            </div>
          );
        })}
      </State>
      <div className={p.dim}>Фильтры нового правила</div>
      <div className={p.row}>
        <input className={`${s.input} ${p.grow}`} placeholder="ID профессий: 96, 10" value={roles} onChange={(e) => setRoles(e.target.value)} />
        <Select value={exp} onChange={(e) => setExp(e.target.value)}>
          <option value="">Любой опыт</option><option value="noExperience">Нет опыта</option><option value="between1And3">1–3 года</option><option value="between3And6">3–6 лет</option><option value="moreThan6">Более 6 лет</option>
        </Select>
        <input className={s.input} type="number" min={0} style={{ width: 120 }} placeholder="Зарплата от" value={salary} onChange={(e) => setSalary(e.target.value)} />
      </div>
      <label className={p.row} style={{ cursor: 'pointer' }}><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Только вакансии с зарплатой</label>
      <div className={p.row}>
        <button className={s.btn} onClick={() => void create()}>Создать правило</button>
        <button className={s.btn} onClick={() => void reload()}>Обновить</button>
        <span className={p.warn}>Изменения выполняются на сервере HH</span>
      </div>
    </>
  );
}
export const AutoResponse = ({ idx, resumeHash }: { idx: number; resumeHash: string }) => <Fold icon="bot" title="Автоотклик HH Pro" desc="Встроенные автоотклики самого hh.ru: статус и правила"><AutoResponseBody idx={idx} resumeHash={resumeHash} /></Fold>;

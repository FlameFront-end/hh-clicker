import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Select, Toggle } from '@/ui/radix';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/icons';
import { useApp } from '@/store/app';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { useUnsavedChanges } from '@/lib/unsaved';

export const Group = ({ children }: { children: ReactNode }) => <div className={m.group}>{children}</div>;

const DESC: Record<string, string> = {
  'Настройки бота': 'Скорость, паузы и лимиты откликов',
  'Статус поиска работы': 'Что видят работодатели: ищете работу или рассматриваете предложения',
  'Навыки и верификации': 'Навыки в профиле и подтверждённые проверки',
  'Анализ резюме': 'Разбор резюме и советы по улучшению',
  'Обновить куки аккаунтов': 'Если сессия устарела — вставьте свежие куки',
  'Браузерные сессии': 'Добавление и проверка аккаунтов по браузерной сессии',
  'WebSocket (realtime)': 'Живое обновление данных на странице',
  'Фильтры и автоматизация': 'Какие вакансии пропускать и что делать автоматически',
  'JSON и бэкап': 'Выгрузка и загрузка всех настроек',
  'Диагностика': 'Технические проверки и состояние сервисов',
  'LLM Авто-ответы': 'ИИ отвечает работодателям в чатах',
  'Авторизация по телефону / email': 'Вход в аккаунт HH по одноразовому коду',
  'Прокси': 'Через какой прокси ходить на hh.ru',
  'Шаблоны писем': 'Сопроводительные письма для откликов',
  'Шаблонные ответы на опросы': 'Готовые ответы на вопросы работодателей',
  'Пул поисковых запросов': 'Ссылки поиска на hh.ru, по которым бот ищет вакансии',
};

export function Sect({ icon, title, desc, open = true, children }: { icon: IconName; title: string; desc?: string; open?: boolean; children: ReactNode }) {
  const d = desc ?? DESC[title];
  return (
    <details className={m.sect} open={open}>
      <summary>
        <span className={m.ico}><Icon name={icon} size={15} /></span>
        <span className={m.ttl}><b>{title}</b>{d && <small>{d}</small>}</span>
        <Icon name="chevron-down" size={15} className={m.chev} />
      </summary>
      <div className={m.body}>{children}</div>
    </details>
  );
}

export const Sub = ({ children }: { children: ReactNode }) => <h4 className={m.sub}>{children}</h4>;
export const Hint = ({ children }: { children: ReactNode }) => <div className={m.hint}>{children}</div>;
export const Hr = () => <div className={m.hr} />;

export function CfgCheck({ k, children, hint, invert }: { k: string; children: ReactNode; hint?: ReactNode; invert?: boolean }) {
  const v = useApp((x) => x.snapshot?.config?.[k]);
  const send = useApp((x) => x.sendCmd);
  const checked = invert ? v === false : !!v;
  return (
    <div>
      <label className={s.checkLbl} style={{ color: 'var(--text)' }}>
        <input type="checkbox" checked={checked} onChange={(e) => send({ type: 'set_config', key: k, value: invert ? !e.target.checked : e.target.checked })} />{children}
      </label>
      {hint && <Hint>{hint}</Hint>}
    </div>
  );
}

/** Числовое поле: показывает значение конфига, пока не в фокусе; шлёт при change. */
export function CfgNumber({ k, min, max, fallback = 0, width = 70, map }: { k: string; min?: number; max?: number; fallback?: number; width?: number; map?: (n: number) => number }) {
  const cfgV = useApp((x) => x.snapshot?.config?.[k]);
  const send = useApp((x) => x.sendCmd);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(cfgV ?? fallback);
  return (
    <input className={s.input} type="number" min={min} max={max} style={{ width, minWidth: 0 }} value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const n = parseInt(draft, 10);
        send({ type: 'set_config', key: k, value: map ? map(Number.isFinite(n) ? n : fallback) : Number.isFinite(n) ? n : 0 });
        setDraft(null);
      }} />
  );
}

export function CfgSelect({ k, options, number }: { k: string; options: [string, string][]; number?: boolean }) {
  const v = useApp((x) => x.snapshot?.config?.[k]);
  const send = useApp((x) => x.sendCmd);
  return (
    <Select value={String(v ?? '')} onChange={(e) => send({ type: 'set_config', key: k, value: number ? parseInt(e.target.value, 10) : e.target.value })}>
      {options.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
    </Select>
  );
}

export function TagInput({ tags, onChange, tone, placeholder, label }: { tags: string[]; onChange: (t: string[]) => void; tone: 'ok' | 'bad'; placeholder: string; label?: string }) {
  const [v, setV] = useState('');
  useUnsavedChanges(!!v.trim());
  const commit = (raw: string) => {
    const add = raw.split(/[,;\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean).filter((x) => !tags.includes(x));
    if (add.length) onChange([...tags, ...add]);
    setV('');
  };
  return (
    <div>
      <div className={m.tags}>
        {tags.map((t) => <span key={t} className={`${m.tag} ${tone === 'ok' ? m.tagOk : m.tagBad}`}>{t}<button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Убрать ${t}`}><Icon name="x" size={11} /></button></span>)}
      </div>
      <input aria-label={label ?? placeholder} className={s.input} style={{ width: '100%' }} value={v} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && commit(v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(v); } }} />
    </div>
  );
}

/** Статус «сохранено» на несколько секунд. */
export function useFlash(ms = 3000) {
  const [t, setT] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [t, (msg: string) => { setT(msg); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setT(''), ms); }] as const;
}

/** Блок внутри панели: заголовок + пояснение + содержимое. */
export function Block({ title, desc, aside, children }: { title: string; desc?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={m.block}>
      <header className={m.blockHead}>
        <div><h4>{title}</h4>{desc && <p>{desc}</p>}</div>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** Группа строк настроек с разделителями. */
export const Rows = ({ children }: { children: ReactNode }) => <div className={m.rows}>{children}</div>;

/** Строка настройки: слева название и пояснение, справа контрол. */
export function Row({ title, hint, children, off }: { title: ReactNode; hint?: ReactNode; children: ReactNode; off?: boolean }) {
  return (
    <div className={`${m.row} ${off ? m.rowOff : ''}`}>
      <div className={m.rowText}><span className={m.rowTitle}>{title}</span>{hint && <span className={m.rowHint}>{hint}</span>}</div>
      <div className={m.rowCtl}>{children}</div>
    </div>
  );
}

/** Переключатель, привязанный к ключу конфига. */
/** unavailable — причина, по которой настройка сейчас не действует (показываем серым). */
export function CfgSwitch({ k, title, hint, invert, unavailable }: { k: string; title: ReactNode; hint?: ReactNode; invert?: boolean; unavailable?: string }) {
  const v = useApp((x) => x.snapshot?.config?.[k]);
  const send = useApp((x) => x.sendCmd);
  const checked = invert ? v === false : !!v;
  return (
    <Row title={title} hint={unavailable || hint} off={!!unavailable}>
      <Toggle checked={checked && !unavailable} disabled={!!unavailable} label={typeof title === 'string' ? title : k} onChange={(on) => send({ type: 'set_config', key: k, value: invert ? !on : on })} />
    </Row>
  );
}

/** Поле «подпись сверху». */
export function Field({ label, hint, tone, children }: { label: ReactNode; hint?: ReactNode; tone?: 'ok' | 'bad' | 'warn'; children: ReactNode }) {
  return (
    <div className={m.field}>
      <span className={`${m.fieldLbl} ${tone ? m['t_' + tone] : ''}`}>{label}</span>
      {children}
      {hint && <span className={m.rowHint}>{hint}</span>}
    </div>
  );
}

/** Множественный выбор в виде плашек. */
export function ChipSet({ options, value, onChange }: { options: [string, string][]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className={m.chipSet}>
      {options.map(([id, label]) => {
        const on = value.includes(id);
        return <button key={id} type="button" aria-pressed={on} className={`${m.cs} ${on ? m.csOn : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== id) : [...value, id])}>{on && <Icon name="check" size={12} />}{label}</button>;
      })}
    </div>
  );
}

/** Ряд действий: кнопки + статус. */
export const Actions = ({ children, status, tone }: { children: ReactNode; status?: ReactNode; tone?: 'ok' | 'bad' | 'warn' }) => (
  <div className={m.actions}>{children}{status ? <span role="status" className={`${m.status} ${tone ? s[tone] : s.dim}`}>{status}</span> : null}</div>
);

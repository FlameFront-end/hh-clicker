import { useState } from 'react';
import { Select } from '@/ui/radix';
import { get, post, put } from '@/lib/api';
import { useApp, useT } from '@/store/app';
import type { Account } from '@/types/snapshot';
import { CfgCheck, CfgNumber, CfgSelect } from '@/features/settings/kit';
import s from '@/ui/Ui.module.css';
import { Fold } from './Fold';
import p from './Panels.module.css';

type Tone = 'ok' | 'bad' | 'warn';
type Msg = { t: string; tone?: Tone } | null;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const Status = ({ m }: { m: Msg }) => (m ? <span className={m.tone ? p[m.tone] : p.dim}>{m.t}</span> : null);

/** Заголовок резюме: HH отдаёт строку или список {string}. */
export function normTitle(t: unknown): string {
  if (!t) return '—';
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.map((x) => (x && typeof x === 'object' ? (x as { string?: string }).string : x)).filter(Boolean).join(' ') || '—';
  if (typeof t === 'object' && (t as { string?: string }).string) return (t as { string: string }).string;
  return '—';
}

/* Письмо */
function LetterBody({ acc }: { acc: Account }) {
  const t = useT();
  const templates = useApp((x) => x.snapshot?.config?.letter_templates) ?? [];
  const [text, setText] = useState(acc.letter ?? '');
  const [msg, setMsg] = useState<Msg>(null);
  const matched = templates.findIndex((x) => x.text === text);
  const sel = text === '' ? '' : matched >= 0 ? String(matched) : '__custom__';
  const save = async () => {
    setMsg({ t: '…' });
    try {
      const r = await post<{ ok?: boolean; error?: string }>(`/api/account/${acc.idx}/set_letter`, { letter: text });
      setMsg(r.ok ? { t: 'Сохранено', tone: 'ok' } : { t: r.error || 'Ошибка', tone: 'bad' });
    } catch (e) { setMsg({ t: errMsg(e), tone: 'bad' }); }
    window.setTimeout(() => setMsg(null), 4000);
  };
  return (
    <>
      <Select value={sel} onChange={(e) => { const v = e.target.value; if (v === '') setText(''); else if (v !== '__custom__') setText(templates[Number(v)]?.text ?? ''); }}>
        <option value="">— пусто —</option>
        {templates.map((x, i) => <option key={i} value={i}>{x.name}</option>)}
        <option value="__custom__">Своё</option>
      </Select>
      <textarea className={s.input} style={{ height: 'auto', padding: '9px 11px' }} rows={4} placeholder="Сопроводительное письмо…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className={p.row}><button className={s.btn} onClick={() => void save()}>{t('btn_save')}</button><Status m={msg} /></div>
    </>
  );
}
export const Letter = ({ acc }: { acc: Account }) => <Fold icon="mail" title="Сопроводительное письмо" desc="Текст, который уходит вместе с откликом"><LetterBody acc={acc} /></Fold>;

/* URL поиска: читаемое описание вместо %D0%A1… */
const EXP: Record<string, string> = { noExperience: 'без опыта', between1And3: 'опыт 1–3 года', between3And6: 'опыт 3–6 лет', moreThan6: 'опыт 6+ лет' };
const SCHED: Record<string, string> = { remote: 'удалёнка', fullDay: 'полный день', flexible: 'гибкий график', shift: 'сменный', flyInFlyOut: 'вахта' };
export function urlLabel(url: string): { title: string; meta: string } {
  try {
    const q = new URL(url).searchParams;
    const dec = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
    const title = dec(q.get('text') ?? '').trim() || 'Все вакансии';
    const meta: string[] = [];
    for (const v of q.getAll('experience')) meta.push(EXP[v] ?? v);
    for (const v of q.getAll('schedule')) meta.push(SCHED[v] ?? v);
    for (const v of q.getAll('work_format')) meta.push(v === 'REMOTE' ? 'удалёнка' : v.toLowerCase());
    const sal = q.get('salary'); if (sal) meta.push(`от ${sal} ₽`);
    const per = q.get('search_period'); if (per) meta.push(`за ${per} дн.`);
    return { title, meta: [...new Set(meta)].join(' · ') };
  } catch { return { title: url, meta: '' }; }
}

/* URL поиска */
function UrlBody({ acc }: { acc: Account }) {
  const cfg = useApp((x) => x.snapshot?.config);
  const pool = (cfg?.url_pool ?? []) as ({ url: string; pages?: number } | string)[];
  const globalPages = Number(cfg?.pages_per_url ?? 40);
  const [sel, setSel] = useState<Set<string>>(new Set(acc.urls ?? []));
  const [pages, setPages] = useState<Record<string, string>>(Object.fromEntries(Object.entries(acc.url_pages ?? {}).map(([k, v]) => [k, String(v)])));
  const [extra, setExtra] = useState<string[]>([]);
  const [fresh, setFresh] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [quick, setQuick] = useState<Msg>(null);
  const items = [...pool.map((it) => (typeof it === 'string' ? { url: it, pages: globalPages } : { url: it.url, pages: it.pages ?? globalPages })), ...extra.filter((u) => !pool.some((it) => (typeof it === 'string' ? it : it.url) === u)).map((u) => ({ url: u, pages: globalPages }))];

  const body = (urls: string[]) => {
    const url_pages: Record<string, number> = {};
    for (const [u, v] of Object.entries(pages)) if (parseInt(v, 10) > 0 && urls.includes(u)) url_pages[u] = parseInt(v, 10);
    return { urls, url_pages, short: acc.hh_short ?? acc.short ?? '', name: acc.hh_name ?? acc.name ?? '' };
  };
  const save = async () => {
    setMsg({ t: '…' });
    try {
      const r = await post<{ ok?: boolean; count?: number; error?: string; hint?: string }>(`/api/account/${acc.idx}/set_urls`, body([...sel]) as never);
      setMsg(r.ok ? { t: `${r.count} URL`, tone: 'ok' } : { t: `${r.error || 'Ошибка'}${r.hint ? ` (${r.hint})` : ''}`, tone: 'bad' });
    } catch (e) { setMsg({ t: errMsg(e), tone: 'bad' }); }
    window.setTimeout(() => setMsg(null), 4000);
  };
  const quickAdd = async () => {
    let url = fresh.trim();
    if (!url) return setQuick({ t: 'Введи URL', tone: 'warn' });
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (!/^https:\/\/(?:[a-z0-9-]+\.)?hh\.ru\/search\//i.test(url)) return setQuick({ t: 'Должен быть hh.ru/search/vacancy?…', tone: 'bad' });
    setQuick({ t: 'Добавляю…' });
    try {
      const raw = await get<{ url_pool?: ({ url: string; pages?: number } | string)[]; pages_per_url?: number }>('/api/raw/config');
      const cur = Array.isArray(raw.url_pool) ? raw.url_pool.slice() : [];
      const exists = cur.some((x) => (typeof x === 'string' ? x : x?.url) === url);
      if (!exists) cur.push({ url, pages: raw.pages_per_url || 40 });
      const saved = await post<{ ok?: boolean; error?: string; errors?: unknown }>('/api/raw/config', { url_pool: cur } as never);
      if (!saved.ok) return setQuick({ t: `Не сохранилось: ${saved.error || JSON.stringify(saved.errors ?? {})}`, tone: 'bad' });
      const next = new Set(sel); next.add(url);
      const r = await post<{ ok?: boolean; count?: number; error?: string; hint?: string }>(`/api/account/${acc.idx}/set_urls`, body([...next]) as never);
      if (r.ok) { setSel(next); setExtra((e) => [...e, url]); setFresh(''); setQuick({ t: exists ? `Уже в пуле — включён (${r.count} URL)` : `Добавлено в пул и включено (${r.count} URL)`, tone: 'ok' }); }
      else setQuick({ t: `В пул сохранён, но включить не вышло: ${r.error || 'ошибка'}${r.hint ? ` (${r.hint})` : ''}`, tone: 'warn' });
    } catch (e) { setQuick({ t: errMsg(e), tone: 'bad' }); }
    window.setTimeout(() => setQuick(null), 6000);
  };
  return (
    <>
      {items.length === 0 && <span className={p.dim}>Пул пустой — добавьте URL в Настройках или прямо ниже.</span>}
      {items.map((it) => (
        <div key={it.url} className={p.row} style={{ flexWrap: 'nowrap' }}>
          <label className={p.row} style={{ flex: 1, minWidth: 0, flexWrap: 'nowrap', cursor: 'pointer' }} title={it.url}>
            <input type="checkbox" checked={sel.has(it.url)} onChange={(e) => setSel((o) => { const n = new Set(o); if (e.target.checked) n.add(it.url); else n.delete(it.url); return n; })} />
            <span className={p.dim} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <b className={p.urlTitle}>{urlLabel(it.url).title}</b>{urlLabel(it.url).meta && <small className={p.urlMeta}>{urlLabel(it.url).meta}</small>}
              {acc.url_stats?.[it.url] != null && <span className={p.ok}> →{acc.url_stats[it.url]}</span>}
            </span>
          </label>
          <input className={`${s.input} ${p.num}`} type="number" min={1} max={200} placeholder={String(it.pages)} title={`Глубина для этого URL (пусто = ${it.pages} стр. из пула)`} value={pages[it.url] ?? ''} onChange={(e) => setPages((o) => ({ ...o, [it.url]: e.target.value }))} />
        </div>
      ))}
      <div className={p.row}><button className={s.btn} onClick={() => void save()}>Применить</button><Status m={msg} /></div>
      <div className={p.dim}>Добавить новый URL в пул и сразу включить:</div>
      <div className={p.row}>
        <input className={`${s.input} ${p.grow}`} placeholder="https://hh.ru/search/vacancy?text=…" value={fresh} onChange={(e) => setFresh(e.target.value)} />
        <button className={s.btn} onClick={() => void quickAdd()}>Добавить</button>
        <Status m={quick} />
      </div>
    </>
  );
}
export const UrlPanel = ({ acc }: { acc: Account }) => <Fold icon="link" title="Ссылки поиска" desc="По каким поискам на hh.ru бот ищет вакансии"><UrlBody acc={acc} /></Fold>;

/* Умные фильтры */
function SmartBody({ acc }: { acc: Account }) {
  const t = useT();
  const cfg = useApp((x) => x.snapshot?.config);
  const [safety, setSafety] = useState<boolean | undefined>(undefined);
  const safe = safety ?? !!acc.safety_enabled;
  const hours = Math.max(parseInt(String(cfg?.fresh_vacancy_hours)) || 24, 1);
  const reserve = Math.max(parseInt(String(cfg?.fresh_apply_reserve)) || 0, 0);
  const ceiling = Math.min(...[parseInt(String(cfg?.daily_apply_limit)), parseInt(String(cfg?.hh_daily_limit)) || 200].filter((v) => v > 0));
  const used = Math.max(parseInt(String(acc.daily_sent)) || 0, parseInt(String(acc.hh_today_applies)) || 0);
  const flipSafety = async () => {
    setSafety(!safe);
    try { const r = await post<{ ok?: boolean }>(`/api/account/${acc.idx}/safety_toggle`); if (!r.ok) setSafety(safe); } catch { setSafety(safe); }
  };
  return (
    <>
      <div className={p.chk}>
        <CfgCheck k="filter_low_competition">{t('smart_filter_low_comp')}</CfgCheck>
        <CfgCheck k="filter_agencies">{t('smart_filter_no_agency')}</CfgCheck>
        <label className={p.row} style={{ cursor: 'pointer' }} title="Настройка только этого аккаунта: HH выбирает подходящее резюме; обязательные поля проверяются заранее">
          <input type="checkbox" checked={safe} onChange={() => void flipSafety()} />{t('smart_filter_pre_check')}
        </label>
        <CfgCheck k="auto_apply_tests">{t('smart_filter_auto_tests')}</CfgCheck>
        <CfgCheck k="skip_auto_response_vacancies">{t('smart_filter_skip_auto_resp')}</CfgCheck>
        <CfgCheck k="prefer_quick_responses">{t('smart_filter_quick_resp')}</CfgCheck>
        <CfgCheck k="accredited_it_only">{t('smart_filter_it_only')}</CfgCheck>
        <CfgCheck k="fresh_vacancies_mode">{t('smart_filter_fresh_reserve')}</CfgCheck>
      </div>
      <div className={p.row}>
        <label className={p.row}>{t('smart_filter_freshness')} <CfgSelect k="search_period_days" number options={[['0', 'Все'], ['1', '1д'], ['3', '3д'], ['7', '7д']]} /></label>
        <label className={p.row}>{t('smart_filter_llm_interval')} <CfgSelect k="llm_check_interval" number options={[['2', '2м'], ['5', '5м'], ['10', '10м'], ['15', '15м'], ['30', '30м']]} /></label>
        <label className={p.row}>{t('smart_filter_daily_limit')} <CfgNumber k="daily_apply_limit" min={0} max={500} width={64} /></label>
        <label className={p.row}>Свежая ≤ <CfgNumber k="fresh_vacancy_hours" min={1} max={168} fallback={24} width={56} />ч</label>
        <label className={p.row}>Резерв <CfgNumber k="fresh_apply_reserve" min={0} max={200} fallback={50} width={56} /></label>
      </div>
      {cfg?.fresh_vacancies_mode && <div className={p.fresh}>Свежие ≤{hours}ч идут первыми · резерв {reserve} · использовано {used}/{Number.isFinite(ceiling) ? ceiling : '∞'}</div>}
      {safe && acc.safety_last_reason && (
        <div className={p.dim}>Пре-чек: пропущено {acc.safety_inconsistent_skipped + acc.safety_misleading_skipped + acc.safety_redirect_skipped} · {acc.safety_last_reason}</div>
      )}
      <div className={p.dim}>Из анализа 14К переговоров: удалёнка 74%, junior 78%, аналитик 100%, IT-аккред. только 17% интервью.</div>
    </>
  );
}
export const SmartFilters = ({ acc }: { acc: Account }) => <Fold icon="brain" title="Умные фильтры" desc="Пропускать вакансии по словам, зарплате и работодателю"><SmartBody acc={acc} /></Fold>;

/* Выбор резюме для браузерной сессии */
function ResumeBody({ acc }: { acc: Account }) {
  const [hash, setHash] = useState(acc.resume_hash);
  const [msg, setMsg] = useState<Msg>(null);
  const flash = (m: Msg) => { setMsg(m); window.setTimeout(() => setMsg(null), 4000); };
  const change = async (h: string) => {
    if (!h) return;
    setHash(h); setMsg({ t: 'переключаю…' });
    try {
      const r = await put<{ status?: string; ok?: boolean; message?: string; error?: string }>(`/api/account/${acc.idx}/active_resume`, { resume_hash: h });
      flash(r.status === 'ok' || r.ok ? { t: 'Резюме переключено', tone: 'ok' } : { t: r.message || r.error || 'Ошибка', tone: 'bad' });
    } catch (e) { flash({ t: errMsg(e), tone: 'bad' }); }
  };
  const refresh = async () => {
    setMsg({ t: 'обновляю…' });
    try { const r = await post<{ ok?: boolean; error?: string; message?: string }>(`/api/session/${acc.idx}/refresh`); flash(r.ok === false ? { t: r.error || r.message || 'Ошибка', tone: 'bad' } : { t: 'Обновлено', tone: 'ok' }); } catch (e) { flash({ t: errMsg(e), tone: 'bad' }); }
  };
  const list = acc.all_resumes ?? [];
  return (
    <>
      <span className={p.dim}>С каким резюме бот откликается. У аккаунта: <b>{list.length}</b> шт.</span>
      <Select value={hash} onChange={(e) => void change(e.target.value)}>
        {list.length === 0 && <option value="">— пусто, обнови сессию —</option>}
        {list.map((r) => <option key={r.hash} value={r.hash}>{normTitle(r.title)} · {(r.hash || '').slice(0, 10)}…</option>)}
      </Select>
      <div className={p.row}><button className={s.btn} onClick={() => void refresh()}>Обновить список</button><Status m={msg} /></div>
    </>
  );
}
export const ResumePicker = ({ acc }: { acc: Account }) => <Fold icon="file-text" title="Резюме для откликов" desc="С каким резюме откликаться на вакансии"><ResumeBody acc={acc} /></Fold>;

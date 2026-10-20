import { useEffect, useMemo, useRef, useState } from 'react';
import { Emoji, Icon, stripEmoji } from '@/components/Icon';
import { get, post } from '@/lib/api';
import { num } from '@/lib/format';
import { colorVar, safeHref } from '@/lib/safe';
import { useApp } from '@/store/app';
import { useAction } from '../main/useAction';
import s from '@/ui/Ui.module.css';
import styles from './LlmTab.module.css';

interface Row { neg_id?: string; acc?: string; acc_color?: string; employer?: string; vacancy_id?: string; vacancy_title?: string; employer_last_msg?: string; llm_reply?: string; status?: string; chat_status?: string; first_seen?: string; last_seen?: string }
interface Rating { total?: number; recommend_pct?: number }
const STATUS: Record<string, [string, string]> = { replied: ['Отправлено', s.ok], draft: ['Черновик', s.warn], pending_reply: ['Ждёт ответа', s.warn], chat_closed: ['Закрыт', s.dim] };
const CHAT: Record<string, [string, string]> = { robot: ['Робот', s.accent], locked: ['Закрыт', s.dim], waiting_hr: ['Ждём HR', s.accent], replied: ['Ответили', s.ok] };
const ts = (r: Row) => Date.parse(r.last_seen || r.first_seen || '') || 0;
const URL_RE = /https?:\/\/[^\s<>"')]+/g;
const kind = (u: string) => { try { const h = new URL(u).hostname; return h.replace(/^www\./, ''); } catch { return 'ссылка'; } };

function loadDone(): Record<string, boolean> { try { return JSON.parse(localStorage.getItem('hh-llm-links-done') || '{}'); } catch { return {}; } }

export function LlmTab() {
  const snap = useApp((x) => x.snapshot);
  const sendCmd = useApp((x) => x.sendCmd);
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [acc, setAcc] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('date_desc');
  const [q, setQ] = useState('');
  const [done, setDone] = useState(loadDone);
  const [ratings, setRatings] = useState<Record<string, Rating | null>>({});
  const inflight = useRef(new Set<string>());
  const cfg = snap?.config;
  const accs = snap?.accounts ?? [];

  const load = async () => {
    try {
      const d = await get<Row[]>('/api/interviews', { limit: 10000, acc, status });
      setRows(Array.isArray(d) ? d : []);
    } catch { /* оставляем прежние */ }
    setLoaded(true);
  };
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30000); return () => clearInterval(t); }, [acc, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGlobal = useAction(() => post('/api/llm_toggle'));
  const runNow = useAction(async () => {
    const r = await post<{ started?: boolean; accounts?: number; error?: string }>('/api/llm_run_now');
    if (!r.started) throw new Error(r.error || 'Не запустилось');
    setTimeout(() => void load(), 8000);
    return `Запущено (${r.accounts ?? '?'})`;
  });
  const reset = useAction(async () => {
    if (!confirm('Сбросить историю «уже отвечали» для всех аккаунтов?\n\nБот повторно обработает все чаты работодателей.')) return null;
    const r = await post<{ skipped_busy?: string[] }>('/api/llm_reset_replied');
    return r.skipped_busy?.length ? `Пропущены занятые: ${r.skipped_busy.join(', ')}` : 'Сброшено';
  }, 6000);

  const view = useMemo(() => {
    const n = q.trim().toLowerCase();
    let r = rows.filter((x) => !n || `${x.employer ?? ''} ${x.vacancy_title ?? ''} ${x.employer_last_msg ?? ''} ${x.llm_reply ?? ''}`.toLowerCase().includes(n));
    const pri = (x: Row) => (x.status === 'pending_reply' ? 0 : x.status === 'draft' ? 1 : x.status === 'replied' ? 2 : 3);
    const isP = (x: Row) => x.status === 'pending_reply' || x.status === 'draft';
    r = [...r].sort((a, b) =>
      sort === 'date_asc' ? ts(a) - ts(b)
      : sort === 'pending_first' ? pri(a) - pri(b) || ts(b) - ts(a)
      : sort === 'oldest_pending' ? Number(isP(b)) - Number(isP(a)) || ts(a) - ts(b)
      : sort === 'employer' ? (a.employer ?? '').localeCompare(b.employer ?? '', 'ru')
      : ts(b) - ts(a));
    return r;
  }, [rows, q, sort]);

  const byAcc = useMemo(() => {
    const m: Record<string, { color: string; pending: number; draft: number; replied: number }> = {};
    for (const r of rows) {
      const k = r.acc || '?';
      m[k] ??= { color: r.acc_color || '', pending: 0, draft: 0, replied: 0 };
      if (r.status === 'pending_reply') m[k].pending++; else if (r.status === 'draft') m[k].draft++; else if (r.status === 'replied') m[k].replied++;
    }
    return m;
  }, [rows]);
  const fullByShort = useMemo(() => Object.fromEntries(accs.filter((a) => a.short).map((a) => [a.short, a.name])), [accs]);
  const accFilterOpts = useMemo(() => [...new Set(rows.map((r) => r.acc).filter((a): a is string => !!a && accs.some((x) => x.short === a)))], [rows, accs]);

  // Рейтинги работодателей — лениво, только для видимой части.
  const shown = view.slice(0, 150);
  const firstAcc = accs.find((a) => !a.cookies_expired)?.idx;
  useEffect(() => {
    if (firstAcc === undefined) return;
    for (const r of shown) {
      const vid = r.vacancy_id;
      if (!vid || vid in ratings || inflight.current.has(vid) || inflight.current.size > 4) continue;
      inflight.current.add(vid);
      void get<{ ok?: boolean } & Rating>(`/api/account/${firstAcc}/rating_by_vacancy/${encodeURIComponent(vid)}`)
        .then((d) => setRatings((m) => ({ ...m, [vid]: d?.ok ? { total: d.total, recommend_pct: d.recommend_pct } : null })))
        .catch(() => setRatings((m) => ({ ...m, [vid]: null })))
        .finally(() => inflight.current.delete(vid));
    }
  }, [shown, firstAcc, ratings]);

  const links = useMemo(() => {
    const out: { neg: string; url: string; employer: string; host: string }[] = [];
    const seen = new Set<string>();
    for (const r of rows) for (const u of (r.employer_last_msg ?? '').match(URL_RE) ?? []) {
      const url = u.replace(/[.,;:!?]+$/, '');
      const key = `${r.neg_id}|${url}`;
      if (!r.neg_id || /hh\.ru/.test(url) || seen.has(key)) continue;
      seen.add(key);
      out.push({ neg: r.neg_id, url, employer: r.employer ?? '', host: kind(url) });
    }
    return out.sort((a, b) => Number(!!done[`${a.neg}|${a.url}`]) - Number(!!done[`${b.neg}|${b.url}`]));
  }, [rows, done]);
  const toggleDone = (k: string) => setDone((d) => { const n = { ...d, [k]: !d[k] }; try { localStorage.setItem('hh-llm-links-done', JSON.stringify(n)); } catch { /* ignore */ } return n; });

  // Статусная строка
  const hasKey = cfg?.llm_api_key_set || (cfg?.llm_profiles ?? []).some((p) => (p as { key_set?: boolean }).key_set) || cfg?.llm_status_summary?.configured_provider === 'openclaw';
  const paused = snap?.paused || (accs.length > 0 && accs.every((a) => a.paused));
  let state: [string, string];
  if (!hasKey) state = ['Нет API-ключа', s.bad];
  else if (!cfg?.llm_enabled) state = ['Тумблер LLM выключен', s.dim];
  else if (paused) state = ['Все аккаунты на паузе', s.warn];
  else if (!accs.some((a) => a.llm_enabled !== false)) state = ['Ни один аккаунт не включён для LLM', s.warn];
  else if (!cfg?.llm_auto_send) state = ['Режим черновиков — включи «Автоотправку»', s.warn];
  else state = ['Работает — авто-ответы идут', s.ok];
  const llmLog = (snap?.llm_log ?? []) as { time?: string; sent?: boolean; source?: string }[];
  const sent = llmLog.filter((l) => l.sent).length;
  const interviews = accs.reduce((n, a) => n + num(a.hh_interviews), 0);
  const pending = accs.reduce((n, a) => n + num(a.llm_pending_chats), 0);
  const dbg = (snap?.log ?? []).filter((e) => (e.message || '').includes('🤖') || (e.message || '').includes('LLM'));
  const src = llmLog.reduce<Record<string, number>>((m, r) => { const k = r.source || 'other'; m[k] = (m[k] || 0) + 1; return m; }, {});

  const feat = (key: string, label: string, title: string) => (
    <label className={s.checkLbl} title={title} style={{ color: 'var(--text)' }}>
      <input type="checkbox" checked={!!cfg?.[key]} onChange={(e) => sendCmd({ type: 'set_config', key, value: e.target.checked })} />{label}
    </label>
  );

  return (
    <div className={s.page}>
      <div className={s.filters}>
        <h2 className={s.title}>LLM авто-ответы</h2>
        <button className={`${styles.toggleBtn} ${cfg?.llm_enabled ? styles.toggleOn : ''}`} disabled={toggleGlobal.busy} onClick={toggleGlobal.run}>
          <Icon name={cfg?.llm_enabled ? 'play' : 'pause'} size={12} />{cfg?.llm_enabled ? 'ВКЛ' : 'ВЫКЛ'}
        </button>
        <select className={s.select} value={acc} onChange={(e) => setAcc(e.target.value)}>
          <option value="">Все аккаунты</option>
          {accFilterOpts.map((a) => <option key={a} value={a}>{fullByShort[a] ?? a}</option>)}
        </select>
        <select className={s.select} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option><option value="pending_reply">Ждёт ответа</option><option value="draft">Черновик</option><option value="replied">Отправлено</option>
          <option value="no_reply_needed">Ответ не нужен</option><option value="chat_closed">Чат закрыт</option><option value="robot">Робот-рекрутер</option><option value="waiting_hr">Ждём HR</option>
        </select>
        <select className={s.select} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="date_desc">Недавние сверху</option><option value="date_asc">Старые сверху</option><option value="pending_first">Ждут ответа сверху</option>
          <option value="oldest_pending">Дольше всех без ответа</option><option value="employer">По работодателю A–Z</option>
        </select>
        <input className={`${s.input} ${s.search}`} placeholder="Поиск: компания / вакансия / сообщение" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={s.btn} onClick={() => void load()}><Icon name="refresh-cw" size={13} />Обновить</button>
        <button className={s.btn} disabled={runNow.busy} onClick={runNow.run}><Icon name="play" size={13} />{runNow.msg ?? runNow.error ?? 'Запустить сейчас'}</button>
        <button className={s.btn} disabled={reset.busy} onClick={reset.run} title="Бот повторно обработает все чаты"><Icon name="repeat" size={13} />{reset.msg ?? reset.error ?? 'Сбросить «отвечали»'}</button>
        <span className={s.dim}>{view.length === rows.length ? `${rows.length} записей` : `${view.length} из ${rows.length}`}</span>
      </div>

      <div className={styles.bar}>
        <b className={state[1]}>{state[0]}</b>
        <span className={s.dim}>каждые {Math.max(num(cfg?.llm_check_interval) || 5, 2)}м · последний: {llmLog[0]?.time ?? '—'}</span>
        <span className={s.accent}>{interviews} интервью{pending ? ` · ${pending} в обработке` : ''}</span>
        <span className={s.ok}>{sent} отправлено · {llmLog.length - sent} черновиков</span>
        <span className={s.grow} />
        <span className={s.dim} title="Источники ответов из последних записей">
          {src.quick_reply ? `quick ${src.quick_reply} · ` : ''}{src.ai_letter ? `ai-letter ${src.ai_letter} · ` : ''}{src.llm ? `llm ${src.llm} · ` : ''}{src.cached ? `кэш ${src.cached}` : ''}
        </span>
      </div>

      <div className={styles.feat}>
        {feat('llm_use_quick_replies', 'HH quick_replies (вместо своего LLM)', 'HH сам генерит варианты ответа')}
        {feat('hh_ai_letter_first_try', 'HH AI-letter (перед шаблоном)', '1 бесплатное AI-письмо на пару резюме×вакансия')}
        {feat('related_vacancies_enabled', 'related_vacancies (доп. источник)', 'HH-рекомендательный фид как доп. источник')}
      </div>

      <div className={styles.accs}>
        {accs.map((a) => {
          const on = a.llm_enabled !== false;
          return <button key={a.idx} className={`${styles.accBtn} ${on ? styles.on : ''}`} onClick={() => sendCmd({ type: 'account_llm', idx: a.idx })}>
            <Icon name="dot" size={9} tone={on ? 'ok' : 'mute'} />{stripEmoji(a.name)}
          </button>;
        })}
      </div>
      <div className={styles.accs}>
        {Object.entries(byAcc).map(([k, v]) => (
          <div key={k} className={styles.stat}>
            <b style={{ color: colorVar(v.color) }}>{fullByShort[k] ?? k}</b>
            <div className={styles.counts}><span title="Ждёт ответа" className={s.bad}>{v.pending} ждёт</span><span title="Черновик" className={s.warn}>{v.draft} чернов.</span><span title="Отправлено" className={s.ok}>{v.replied} отпр.</span></div>
          </div>
        ))}
      </div>

      {links.length > 0 && (
        <details className={styles.details}>
          <summary className={s.warn}>{links.filter((l) => !done[`${l.neg}|${l.url}`]).length} ссылок от HR <span className={s.dim}>— формы, анкеты, тесты из чатов</span></summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
            {links.map((l) => {
              const k = `${l.neg}|${l.url}`;
              return (
                <div key={k} className={`${styles.link} ${done[k] ? styles.done : ''}`}>
                  <a href={safeHref(l.url)} target="_blank" rel="noopener noreferrer">{l.host}</a>
                  <a href={`https://hh.ru/chat/${encodeURIComponent(l.neg)}`} target="_blank" rel="noopener noreferrer" className={s.dim}>{l.employer}</a>
                  <span className={s.grow} />
                  <button className={`${s.btn} ${s.btnSm}`} onClick={() => toggleDone(k)}>{done[k] ? 'Пройдено' : 'Пройти'}</button>
                </div>
              );
            })}
          </div>
        </details>
      )}

      <details className={styles.details}>
        <summary>Отладочный лог LLM {dbg.length ? `(${dbg.length})` : ''}</summary>
        <div className={styles.dbg}>
          {dbg.length === 0 && <span className={s.dim}>Пусто</span>}
          {dbg.map((e, i) => <div key={i}><span className={s.dim}>{e.time}</span> <Emoji text={e.message} size={11} /></div>)}
        </div>
      </details>

      {!loaded && <div className={s.state}>Загрузка…</div>}
      {loaded && rows.length === 0 && <div className={s.state}>Нет данных. Переговоры появятся после первого опроса HH-статистики (~15 мин).</div>}
      {shown.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Обнаружен</th><th>Аккаунт</th><th>Работодатель</th><th>Вакансия</th><th>Сообщение работодателя</th><th>Ответ LLM</th><th>Статус</th><th>Чат</th></tr></thead>
            <tbody>
              {shown.map((r, i) => {
                const [sl, sc] = STATUS[r.status ?? ''] ?? ['—', s.dim];
                const ch = CHAT[r.chat_status ?? ''];
                const rt = r.vacancy_id ? ratings[r.vacancy_id] : null;
                const rowCls = r.status === 'replied' ? styles.rowReplied : r.status === 'draft' ? styles.rowDraft : r.status === 'pending_reply' ? styles.rowPending : r.status === 'chat_closed' ? styles.rowClosed : '';
                return (
                  <tr key={`${r.neg_id}-${i}`} className={rowCls}>
                    <td className={`${s.dim} ${s.nowrap}`}>{(r.last_seen || r.first_seen || '').replace('T', ' ').slice(0, 16)}</td>
                    <td style={{ color: colorVar(r.acc_color || '') }}>{r.acc}</td>
                    <td>{r.employer} {r.neg_id && <a href={`https://hh.ru/chat/${encodeURIComponent(r.neg_id)}`} target="_blank" rel="noopener noreferrer"><Icon name="link" size={11} /></a>}
                      {rt?.total ? <span className={rt.total >= 4.3 ? s.ok : rt.total >= 3.8 ? s.warn : s.bad} style={{ marginLeft: 6, fontSize: 11 }}><Icon name="star" size={10} /> {Number(rt.total).toFixed(1)}{rt.recommend_pct != null ? ` ${rt.recommend_pct}%` : ''}</span> : null}
                    </td>
                    <td className={s.dim}>{r.vacancy_title}</td>
                    <td className={styles.msg}>{r.employer_last_msg || '—'}</td>
                    <td className={styles.msg}>{r.llm_reply}</td>
                    <td className={`${sc} ${s.nowrap}`}>{sl}</td>
                    <td className={ch?.[1]}>{ch?.[0]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {view.length > shown.length && <div className={s.more}>Показано {shown.length} из {view.length} — уточните фильтр или поиск</div>}
    </div>
  );
}

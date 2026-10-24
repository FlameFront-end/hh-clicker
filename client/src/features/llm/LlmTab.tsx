import { useEffect, useMemo, useRef, useState } from 'react';
import { Select, Toggle } from '@/ui/radix';
import { confirmDialog } from '@/ui/dialog';
import { Emoji, Icon, stripEmoji } from '@/components/Icon';
import { get, post } from '@/lib/api';
import { num } from '@/lib/format';
import { safeHref } from '@/lib/safe';
import { useApp } from '@/store/app';
import { useAction } from '../main/useAction';
import { AccChip, Avatar, Empty, PageHead, Pill, Search, Skeleton, Stats } from '@/ui/Kit';
import s from '@/ui/Ui.module.css';
import styles from './LlmTab.module.css';

interface Row { neg_id?: string; acc?: string; acc_color?: string; employer?: string; vacancy_id?: string; vacancy_title?: string; employer_last_msg?: string; llm_reply?: string; status?: string; chat_status?: string; first_seen?: string; last_seen?: string }
interface Rating { total?: number; recommend_pct?: number }
type Tone = 'ok' | 'warn' | 'bad' | 'accent' | 'dim';
const STATUS: Record<string, [string, Tone]> = { replied: ['Отправлено', 'ok'], draft: ['Черновик', 'warn'], pending_reply: ['Ждёт ответа', 'bad'], chat_closed: ['Чат закрыт', 'dim'] };
const CHAT: Record<string, [string, Tone]> = { robot: ['Робот-рекрутер', 'accent'], locked: ['Закрыт', 'dim'], waiting_hr: ['Ждём HR', 'accent'], replied: ['Ответили', 'ok'] };
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
    if (!(await confirmDialog('Сбросить историю «уже отвечали» для всех аккаунтов?\n\nБот повторно обработает все чаты работодателей.', { danger: true }))) return null;
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
  const fullByShort = useMemo(() => Object.fromEntries(accs.filter((a) => a.short).map((a) => [a.hh_short ?? a.short, a.name])), [accs]);
  const accFilterOpts = useMemo(() => [...new Set(rows.map((r) => r.acc).filter((a): a is string => !!a && accs.some((x) => (x.hh_short ?? x.short) === a)))], [rows, accs]);

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
  let state: [string, 'ok' | 'bad' | 'warn' | 'dim'];
  if (!hasKey) state = ['Нет API-ключа — добавьте его в Настройки → ИИ', 'bad'];
  else if (!cfg?.llm_enabled) state = ['ИИ-ответы выключены', 'dim'];
  else if (paused) state = ['Все аккаунты на паузе', 'warn'];
  else if (!accs.some((a) => a.llm_enabled !== false)) state = ['Ни один аккаунт не включён для ИИ-ответов', 'warn'];
  else if (!cfg?.llm_auto_send) state = ['Режим черновиков — включите «Автоотправку» в настройках ИИ', 'warn'];
  else state = ['Работает — ответы отправляются автоматически', 'ok'];
  const llmLog = (snap?.llm_log ?? []) as { time?: string; sent?: boolean; source?: string }[];
  const sent = llmLog.filter((l) => l.sent).length;
  const interviews = accs.reduce((n, a) => n + num(a.hh_interviews), 0);
  const pending = accs.reduce((n, a) => n + num(a.llm_pending_chats), 0);
  const dbg = (snap?.log ?? []).filter((e) => (e.message || '').includes('🤖') || (e.message || '').includes('LLM'));
  const src = llmLog.reduce<Record<string, number>>((m, r) => { const k = r.source || 'other'; m[k] = (m[k] || 0) + 1; return m; }, {});

  const feat = (key: string, label: string, title: string, off?: string) => (
    <div className={styles.feat} style={off ? { opacity: 0.5 } : undefined} title={off}>
      <div><div>{label}</div><div className={styles.hint}>{off || title}</div></div>
      <Toggle checked={!!cfg?.[key] && !off} disabled={!!off} onChange={(v) => sendCmd({ type: 'set_config', key, value: v })} label={label} />
    </div>
  );
  // AI-письмо HH работает только при отклике через сайт (не через API).
  const webApply = !cfg?.use_oauth_apply && accs.some((a) => !a.use_oauth);

  const sentCount = sent, drafts = llmLog.length - sent;
  const nPending = rows.filter((r) => r.status === 'pending_reply').length;
  return (
    <div className={s.page}>
      <PageHead title="ИИ-ответы работодателям" count={view.length === rows.length ? rows.length.toLocaleString('ru') : `${view.length} из ${rows.length}`} sub="Бот читает чаты с HR и отвечает от вашего имени. Здесь видно, что написал работодатель и что ответил ИИ.">
        <button className={s.btn} onClick={() => void load()}><Icon name="refresh-cw" size={13} />Обновить</button>
        <button className={s.btn} disabled={runNow.busy} onClick={runNow.run}><Icon name="play" size={13} />{runNow.msg ?? runNow.error ?? 'Запустить сейчас'}</button>
        <button className={s.btn} disabled={reset.busy} onClick={reset.run} title="Бот повторно обработает все чаты"><Icon name="repeat" size={13} />{reset.msg ?? reset.error ?? 'Сбросить «отвечали»'}</button>
      </PageHead>

      <div className={`${styles.banner} ${styles['b_' + state[1]]}`}>
        <span className={styles.bannerDot} />
        <div className={styles.bannerTxt}>
          <b>{state[0]}</b>
          <span>проверка каждые {Math.max(num(cfg?.llm_check_interval) || 5, 2)} мин · последний ответ: {llmLog[0]?.time ?? '—'}{(src.quick_reply || src.ai_letter || src.llm || src.cached) ? ` · источники: ${[src.quick_reply && `быстрые ответы HH ${src.quick_reply}`, src.ai_letter && `AI-письмо ${src.ai_letter}`, src.llm && `своя модель ${src.llm}`, src.cached && `кэш ${src.cached}`].filter(Boolean).join(', ')}` : ''}</span>
        </div>
        <label className={styles.master}>{cfg?.llm_enabled ? 'Включено' : 'Выключено'}<Toggle checked={!!cfg?.llm_enabled} disabled={toggleGlobal.busy} onChange={() => toggleGlobal.run()} label="ИИ-ответы" /></label>
      </div>

      <Stats items={[
        { label: 'приглашений на интервью', value: interviews.toLocaleString('ru'), tone: interviews ? 'ok' : undefined },
        { label: 'ждут ответа', value: nPending, tone: nPending ? 'bad' : undefined, hint: pending ? `${pending} сейчас в обработке` : undefined },
        { label: 'отправлено ответов', value: sentCount.toLocaleString('ru'), tone: sentCount ? 'accent' : undefined },
        { label: 'черновиков', value: drafts.toLocaleString('ru'), tone: drafts ? 'warn' : undefined },
      ]} />

      <div className={styles.cols}>
        <section className={styles.panel}>
          <h3>Аккаунты</h3>
          {accs.length === 0 && <span className={s.dim}>Нет аккаунтов</span>}
          {accs.map((a) => {
            const on = a.llm_enabled !== false;
            const c = byAcc[a.hh_short ?? a.short] ?? { pending: 0, draft: 0, replied: 0 };
            return (
              <div key={a.idx} className={`${styles.accRow} ${on ? '' : styles.off}`}>
                <Avatar name={stripEmoji(a.name)} size={30} />
                <div className={styles.accTxt}>
                  <b>{stripEmoji(a.name)}</b>
                  <span><i className={s.bad}>{c.pending} ждёт</i> · <i className={s.warn}>{c.draft} черн.</i> · <i className={s.ok}>{c.replied} отпр.</i></span>
                </div>
                <Toggle checked={on} onChange={() => sendCmd({ type: 'account_llm', idx: a.idx })} label={`ИИ-ответы: ${stripEmoji(a.name)}`} />
              </div>
            );
          })}
        </section>
        <section className={styles.panel}>
          <h3>Откуда брать ответы</h3>
          {feat('llm_use_quick_replies', 'Быстрые ответы HH', 'HH сам предлагает варианты, вместо вашей модели')}
          {feat('hh_ai_letter_first_try', 'AI-письмо HH', 'Бесплатное AI-письмо на пару «резюме × вакансия», до шаблона', webApply ? undefined : 'Недоступно: все профили откликаются через API HH, а AI-письмо есть только при отклике через сайт')}
          {feat('related_vacancies_enabled', 'Похожие вакансии', 'Дополнительный источник вакансий из рекомендаций HH')}
        </section>
      </div>

      <div className={s.filters}>
        <Search value={q} onChange={setQ} placeholder="Поиск: компания, вакансия, сообщение" />
        <Select value={acc} onChange={(e) => setAcc(e.target.value)}>
          <option value="">Все аккаунты</option>
          {accFilterOpts.map((a) => <option key={a} value={a}>{fullByShort[a] ?? a}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option><option value="pending_reply">Ждёт ответа</option><option value="draft">Черновик</option><option value="replied">Отправлено</option>
          <option value="no_reply_needed">Ответ не нужен</option><option value="chat_closed">Чат закрыт</option><option value="robot">Робот-рекрутер</option><option value="waiting_hr">Ждём HR</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="date_desc">Недавние сверху</option><option value="date_asc">Старые сверху</option><option value="pending_first">Ждут ответа сверху</option>
          <option value="oldest_pending">Дольше всех без ответа</option><option value="employer">По работодателю A–Z</option>
        </Select>
      </div>

      {links.length > 0 && (
        <details className={styles.details}>
          <summary><Icon name="link" size={14} /><span className={s.warn}>{links.filter((l) => !done[`${l.neg}|${l.url}`]).length} ссылок от HR</span><span className={s.dim}>формы, анкеты и тесты из чатов</span><Icon name="chevron-down" size={14} className="chev" /></summary>
          <div className={styles.linkList}>
            {links.map((l) => {
              const k = `${l.neg}|${l.url}`;
              return (
                <div key={k} className={`${styles.link} ${done[k] ? styles.done : ''}`}>
                  <a href={safeHref(l.url)} target="_blank" rel="noopener noreferrer">{l.host}</a>
                  <a href={`https://hh.ru/chat/${encodeURIComponent(l.neg)}`} target="_blank" rel="noopener noreferrer" className={s.dim}>{l.employer}</a>
                  <span className={s.grow} />
                  <button className={`${s.btn} ${s.btnSm}`} onClick={() => toggleDone(k)}>{done[k] ? 'Пройдено' : 'Отметить пройденным'}</button>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {!loaded && <Skeleton />}
      {loaded && rows.length === 0 && <Empty icon="bot" title="Пока нет переговоров" hint="Они появятся после первого опроса HH (примерно через 15 минут после запуска)." />}
      {loaded && rows.length > 0 && shown.length === 0 && <Empty icon="search" title="Ничего не найдено" hint="Измените поиск или фильтры." />}
      {shown.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Работодатель</th><th>Сообщение HR</th><th>Ответ ИИ</th><th>Статус</th><th>Когда</th></tr></thead>
            <tbody>
              {shown.map((r, i) => {
                const [sl, st] = STATUS[r.status ?? ''] ?? ['—', 'dim' as Tone];
                const ch = CHAT[r.chat_status ?? ''];
                const rt = r.vacancy_id ? ratings[r.vacancy_id] : null;
                const rowCls = r.status === 'replied' ? styles.rowReplied : r.status === 'draft' ? styles.rowDraft : r.status === 'pending_reply' ? styles.rowPending : r.status === 'chat_closed' ? styles.rowClosed : '';
                return (
                  <tr key={`${r.neg_id}-${i}`} className={rowCls}>
                    <td className={styles.emp}>
                      <div className={styles.empName}>
                        {r.employer}
                        {r.neg_id && <a href={`https://hh.ru/chat/${encodeURIComponent(r.neg_id)}`} target="_blank" rel="noopener noreferrer" title="Открыть чат на HH"><Icon name="arrow-up-right" size={12} /></a>}
                        {rt?.total ? <span className={rt.total >= 4.3 ? s.ok : rt.total >= 3.8 ? s.warn : s.bad} style={{ fontSize: 11 }} title="Рейтинг работодателя"><Icon name="star" size={10} /> {Number(rt.total).toFixed(1)}{rt.recommend_pct != null ? ` · ${rt.recommend_pct}%` : ''}</span> : null}
                      </div>
                      {r.vacancy_title && <div className={styles.empSub}>{r.vacancy_title}</div>}
                      <div style={{ marginTop: 6 }}><AccChip name={r.acc || ''} /></div>
                    </td>
                    <td className={styles.msg}><div className={styles.clamp}>{r.employer_last_msg || '—'}</div></td>
                    <td className={styles.msg}><div className={styles.clamp}>{r.llm_reply || <span className={s.dim}>—</span>}</div></td>
                    <td className={s.nowrap}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                        <Pill tone={st}>{sl}</Pill>
                        {ch && <Pill tone={ch[1]}>{ch[0]}</Pill>}
                      </div>
                    </td>
                    <td className={`${s.dim} ${s.nowrap}`}>{(r.last_seen || r.first_seen || '').replace('T', ' ').slice(5, 16).replace('-', '.')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {view.length > shown.length && <div className={s.more}>Показано {shown.length} из {view.length} — уточните фильтр или поиск</div>}

      <details className={styles.details}>
        <summary><Icon name="scroll-text" size={14} /><span>Отладочный лог ИИ</span><span className={s.dim}>{dbg.length ? `${dbg.length} записей` : 'пусто'}</span><Icon name="chevron-down" size={14} className="chev" /></summary>
        <div className={styles.dbg}>
          {dbg.length === 0 && <span className={s.dim}>Пусто</span>}
          {dbg.map((e, i) => <div key={i}><span className={s.dim}>{e.time}</span> <Emoji text={e.message} size={11} /></div>)}
        </div>
      </details>
    </div>
  );
}

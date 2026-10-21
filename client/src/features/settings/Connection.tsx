import { useEffect, useState } from 'react';
import { get, post } from '@/lib/api';
import { useApp } from '@/store/app';
import { Toggle } from '@/ui/radix';
import { stripEmoji } from '@/components/Icon';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { Actions, Block, Field, Hint, Row, Rows, Sect } from './kit';

interface Msg { t: string; tone?: 'ok' | 'bad' | 'warn' }
const toneCls = (x?: Msg['tone']) => (x === 'ok' ? s.ok : x === 'bad' ? s.bad : x === 'warn' ? s.warn : s.dim);
const Status = ({ msg }: { msg: Msg | null }) => (msg ? <span className={`${m.status} ${toneCls(msg.tone)}`}>{msg.t}</span> : null);

/** Обновить куки существующего аккаунта (cURL или строка cookie). */
export function Cookies() {
  const accounts = useApp((x) => x.snapshot?.accounts) ?? [];
  const [vals, setVals] = useState<Record<number, string>>({});
  const [msgs, setMsgs] = useState<Record<number, Msg>>({});
  const say = (i: number, x: Msg) => setMsgs((p) => ({ ...p, [i]: x }));
  const update = async (idx: number) => {
    const v = (vals[idx] ?? '').trim();
    if (!v) return say(idx, { t: 'Пусто', tone: 'bad' });
    say(idx, { t: 'Обновляю…' });
    try {
      const r = await post<{ ok?: boolean; keys?: string[]; error?: string }>(`/api/account/${idx}/update_cookies`, { cookies: v });
      if (r.ok) { setVals((p) => ({ ...p, [idx]: '' })); say(idx, { t: `Обновлено (${(r.keys ?? []).length} ключей)`, tone: 'ok' }); }
      else say(idx, { t: r.error ?? 'Ошибка', tone: 'bad' });
    } catch (e) { say(idx, { t: String(e), tone: 'bad' }); }
  };
  return (
    <Sect icon="key-round" title="Обновить куки аккаунтов">
      <Hint>Вставьте новый cURL или строку <b>cookie: hhtoken=…</b> — куки обновятся сразу, без перезапуска. Получить: F12 → Network → любой запрос к hh.ru → Copy as cURL.</Hint>
      {accounts.map((a) => (
        <Block key={a.idx} title={stripEmoji(a.name)}>
          <textarea className={m.ta} rows={2} placeholder="curl 'https://hh.ru/…' -H 'cookie: hhtoken=…' — или: hhtoken=xxx; _xsrf=yyy" value={vals[a.idx] ?? ''} onChange={(e) => setVals((p) => ({ ...p, [a.idx]: e.target.value }))} />
          <Actions status={msgs[a.idx]?.t} tone={msgs[a.idx]?.tone}><button className={s.btn} onClick={() => void update(a.idx)}>Обновить куки</button></Actions>
        </Block>
      ))}
    </Sect>
  );
}

/** Добавить сессию из браузера. */
export function AddSession() {
  const [mode, setMode] = useState<'curl' | 'manual'>('curl');
  const [curl, setCurl] = useState('');
  const [k, setK] = useState({ hhtoken: '', xsrf: '', hhul: '', crypted: '' });
  const [name, setName] = useState('');
  const [letter, setLetter] = useState('');
  const [msg, setMsg] = useState<Msg | null>(null);
  const [force, setForce] = useState(false);

  const cookieStr = () => {
    if (mode === 'curl') return curl.trim();
    const parts = [`hhtoken=${k.hhtoken.trim()}`, `_xsrf=${k.xsrf.trim()}`];
    if (k.hhul.trim()) parts.push(`hhul=${k.hhul.trim()}`);
    if (k.crypted.trim()) parts.push(`crypted_id=${k.crypted.trim()}`);
    return parts.join('; ');
  };
  const submit = async (f: boolean) => {
    if (mode === 'curl' && !curl.trim()) return setMsg({ t: 'Вставьте строку cookies', tone: 'bad' });
    if (mode === 'manual' && (!k.hhtoken.trim() || !k.xsrf.trim())) return setMsg({ t: 'hhtoken и _xsrf обязательны', tone: 'bad' });
    setMsg({ t: f ? 'Добавляю без проверки…' : 'Проверяю сессию…' });
    setForce(false);
    try {
      const r = await post<{ status?: string; message?: string; can_force?: boolean }>('/api/session/add', { cookies: cookieStr(), name: name.trim(), letter, force: f });
      if (r.status === 'ok') {
        setMsg({ t: r.message ?? 'Сессия добавлена', tone: 'ok' });
        setCurl(''); setK({ hhtoken: '', xsrf: '', hhul: '', crypted: '' }); setName(''); setLetter('');
      } else {
        setMsg({ t: r.message ?? 'Ошибка', tone: r.can_force ? 'warn' : 'bad' });
        setForce(!!r.can_force && !f);
      }
    } catch (e) { setMsg({ t: String(e), tone: 'bad' }); }
  };
  return (
    <Sect icon="plug" title="Браузерные сессии">
      <Hint>Самый простой способ: открыть hh.ru под нужным аккаунтом → F12 → Network → любой запрос → Copy as cURL → вставить сюда. Бот сам вытащит cookies.</Hint>
      <div className={m.chipSet}>
        <button type="button" aria-pressed={mode === 'curl'} className={`${m.cs} ${mode === 'curl' ? m.csOn : ''}`} onClick={() => setMode('curl')}>cURL / строка</button>
        <button type="button" aria-pressed={mode === 'manual'} className={`${m.cs} ${mode === 'manual' ? m.csOn : ''}`} onClick={() => setMode('manual')}>Вручную</button>
      </div>
      {mode === 'curl' ? (
        <Field label="Cookies"><textarea className={m.ta} rows={4} placeholder="curl 'https://hh.ru/…' -H 'cookie: hhtoken=…' — или строка: hhtoken=xxx; _xsrf=yyy; …" value={curl} onChange={(e) => setCurl(e.target.value)} /></Field>
      ) : (
        <div className={m.cols2}>
          <Field label="hhtoken *"><input className={s.input} value={k.hhtoken} onChange={(e) => setK({ ...k, hhtoken: e.target.value })} /></Field>
          <Field label="_xsrf *"><input className={s.input} value={k.xsrf} onChange={(e) => setK({ ...k, xsrf: e.target.value })} /></Field>
          <Field label="hhul"><input className={s.input} value={k.hhul} onChange={(e) => setK({ ...k, hhul: e.target.value })} /></Field>
          <Field label="crypted_id"><input className={s.input} value={k.crypted} onChange={(e) => setK({ ...k, crypted: e.target.value })} /></Field>
        </div>
      )}
      <Field label="Имя" hint="Необязательно — определится автоматически"><input className={s.input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Сопроводительное письмо" hint="Необязательно"><textarea className={m.ta} rows={3} value={letter} onChange={(e) => setLetter(e.target.value)} /></Field>
      <Actions status={msg?.t} tone={msg?.tone}>
        <button className={`${s.btn} ${s.btnOn}`} onClick={() => void submit(false)}>Подключить сессию</button>
        {force && <button className={s.btn} onClick={() => void submit(true)}>Добавить всё равно</button>}
      </Actions>
    </Sect>
  );
}

interface WsStatus { ok?: boolean; use_websocket_realtime?: boolean; accounts?: Record<string, unknown> }

/** WebSocket realtime: per-account слушатель websocket.hh.ru. */
export function WsRealtime() {
  const accounts = useApp((x) => x.snapshot?.accounts) ?? [];
  const [st, setSt] = useState<WsStatus | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const load = async () => {
    try { setSt(await get<WsStatus>('/api/ws/status')); setMsg(null); } catch (e) { setMsg({ t: String(e), tone: 'bad' }); }
  };
  useEffect(() => { void load(); }, []);
  const toggle = async (idx: number, on: boolean) => {
    try { await post(`/api/ws/${idx}/${on ? 'enable' : 'disable'}`); await load(); } catch (e) { setMsg({ t: String(e), tone: 'bad' }); }
  };
  const label = (v: unknown): string => {
    if (v == null) return 'выключен';
    if (typeof v === 'string') return v;
    const o = v as Record<string, unknown>;
    return String(o.status ?? o.state ?? JSON.stringify(v));
  };
  const global = st?.use_websocket_realtime;
  return (
    <Sect icon="radio" title="WebSocket (realtime)">
      <Hint>Read-only слушатель websocket.hh.ru: пуш-события HH (просмотры резюме, приглашения, сообщения) без лишнего опроса. Глобальный флаг <code>use_websocket_realtime</code> задаётся в config.json.</Hint>
      <Rows>
        <Row title="Глобальный флаг" hint={global === false ? 'Пока он выключен, слушатели не стартуют даже для включённых аккаунтов.' : undefined}>
          <b className={global ? s.ok : s.dim}>{global === undefined ? '—' : global ? 'включён' : 'выключен'}</b>
          <button className={s.btn} onClick={() => void load()}>Обновить</button>
        </Row>
        {accounts.map((a) => {
          const v = st?.accounts?.[String(a.idx)];
          const on = v != null && label(v) !== 'disabled';
          return (
            <Row key={a.idx} title={stripEmoji(a.name)} hint={label(v)}>
              <Toggle checked={on} label={`Слушатель ${stripEmoji(a.name)}`} onChange={(x) => void toggle(a.idx, x)} />
            </Row>
          );
        })}
      </Rows>
      <Status msg={msg} />
    </Sect>
  );
}

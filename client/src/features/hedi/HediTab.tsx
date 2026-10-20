import { stripEmoji } from '@/components/Icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, ApiError, post } from '@/lib/api';
import { useApp } from '@/store/app';
import s from '@/ui/Ui.module.css';
import styles from './HediTab.module.css';

interface Msg { sender?: string; text?: string; timestamp?: string; created_at?: string }
const time = (v?: string) => { if (!v) return ''; const d = new Date(v); return isNaN(d.getTime()) ? v : d.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function HediTab() {
  const accounts = useApp((x) => x.snapshot?.accounts) ?? [];
  const [idx, setIdx] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [status, setStatus] = useState<{ t: string; err: boolean }>({ t: 'Выберите mobile-аккаунт для начала чата.', err: false });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const cur = idx ?? accounts[0]?.idx ?? null;

  const load = useCallback(async (show: boolean) => {
    if (cur === null || loading.current) return;
    loading.current = true;
    if (show) setStatus({ t: 'Загружаю историю…', err: false });
    try {
      const path = `/api/account/${cur}/hedi/history?limit=50`;
      let d: { messages?: Msg[] };
      try { d = await api(path); }
      catch (e) {
        if (e instanceof ApiError && e.status === 409) { await post(`/api/account/${cur}/hedi/start`); d = await api(path); } else throw e;
      }
      setMsgs(d.messages ?? []);
      setStatus({ t: 'История обновлена', err: false });
    } catch (e) { setStatus({ t: errText(e) || 'Не удалось загрузить историю', err: true }); }
    finally { loading.current = false; }
  }, [cur]);

  useEffect(() => { void load(true); const t = setInterval(() => void load(false), 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs]);

  const send = async () => {
    const v = text.trim();
    if (cur === null) return setStatus({ t: 'Сначала выберите аккаунт.', err: true });
    if (!v || busy) return;
    setBusy(true); setStatus({ t: 'Отправляю…', err: false });
    try { await post(`/api/account/${cur}/hedi/send`, { text: v }); setText(''); await load(false); setStatus({ t: 'Сообщение отправлено', err: false }); }
    catch (e) { setStatus({ t: errText(e) || 'Не удалось отправить сообщение', err: true }); }
    finally { setBusy(false); }
  };

  return (
    <div className={styles.shell}>
      <div className={styles.bar}>
        <div><h2 className={s.title}>HH Хэдди</h2><div className={s.dim} style={{ fontSize: 11 }}>Bot: Хэдди · powered by HH.ru AI</div></div>
        <span className={s.grow} />
        <select className={s.select} value={cur ?? ''} onChange={(e) => setIdx(Number(e.target.value))}>
          {accounts.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name || a.short)}</option>)}
        </select>
        <button className={s.btn} onClick={() => void load(true)}><Icon name="refresh-cw" size={13} />Обновить историю</button>
      </div>
      <div className={`${styles.status} ${status.err ? s.bad : ''}`}>{status.t}</div>
      <div className={styles.msgs} ref={box}>
        {msgs.length === 0 && <div className={styles.empty}>История пуста. Спросите Хэдди о подходящих вакансиях.</div>}
        {msgs.map((m, i) => {
          const user = m.sender === 'applicant';
          return (
            <div key={i} className={`${styles.msg} ${user ? styles.user : ''}`}>
              <div className={styles.avatar}><Icon name={user ? 'user' : 'bot'} size={14} /></div>
              <div className={styles.bubble}><div>{m.text}</div><div className={styles.time}>{time(m.timestamp || m.created_at)}</div></div>
            </div>
          );
        })}
      </div>
      <div className={styles.compose}>
        <textarea className={styles.ta} rows={3} maxLength={4000} placeholder="Напишите Хэдди…" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className={styles.send} disabled={busy} onClick={() => void send()}><Icon name="send" size={14} />Отправить</button>
      </div>
    </div>
  );
}

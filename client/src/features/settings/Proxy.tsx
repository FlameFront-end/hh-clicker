import { useEffect, useState } from 'react';
import { get, post } from '@/lib/api';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { Hint, Sect } from './kit';

interface ProxyInfo { proxy?: string; ip?: string; impersonate?: string; error?: string; ok?: boolean; reverted_to?: string }

export function Proxy() {
  const [info, setInfo] = useState<ProxyInfo | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const check = async () => {
    setBusy(true);
    setMsg({ text: 'Проверяю…' });
    try {
      const r = await get<ProxyInfo>('/api/proxy/info');
      setInfo(r);
      setUrl((u) => u || r.proxy || '');
      setMsg(r.error ? { text: r.error, bad: true } : null);
    } catch (e) { setMsg({ text: String(e), bad: true }); }
    setBusy(false);
  };
  useEffect(() => { void check(); }, []);

  const save = async () => {
    setBusy(true);
    setMsg({ text: 'Сохраняю и проверяю…' });
    try {
      const r = await post<ProxyInfo>('/api/proxy/set', { url: url.trim() });
      setInfo(r);
      if (r.ok === false || r.error) setMsg({ text: `${r.error ?? 'Ошибка'}${r.reverted_to ? ` · возвращён: ${r.reverted_to}` : ''}`, bad: true });
      else setMsg({ text: 'Сохранено' });
    } catch (e) { setMsg({ text: String(e), bad: true }); }
    setBusy(false);
  };

  return (
    <Sect icon="globe" title="Прокси">
      <Hint>Прокси для запросов к hh.ru. Пустое поле — прямое соединение. После сохранения выполняется проверка; при ошибке прежнее значение возвращается.</Hint>
      <div className={m.inline}>
        <input className={s.input} style={{ flex: 1, minWidth: 220 }} placeholder="http://user:pass@host:port" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className={s.btn} disabled={busy} onClick={() => void save()}>Сохранить</button>
        <button className={s.btn} disabled={busy} onClick={() => void check()}>Проверить</button>
      </div>
      {info && (
        <div className={m.hint}>
          IP: <b style={{ color: 'var(--text)' }}>{info.ip || '—'}</b>
          {info.impersonate && <> · TLS: {info.impersonate}</>}
          {info.proxy ? <> · прокси: {info.proxy.replace(/\/\/[^@]*@/, '//***@')}</> : <> · прямое соединение</>}
        </div>
      )}
      {msg && <div className={`${m.status} ${msg.bad ? s.bad : s.dim}`}>{msg.text}</div>}
    </Sect>
  );
}

import { useEffect, useState } from 'react';
import { get, post } from '@/lib/api';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { Actions, Field, Row, Rows, Sect } from './kit';

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
      <Field label="Адрес прокси" hint="Для запросов к hh.ru. Пусто — прямое соединение. После сохранения идёт проверка; при ошибке вернётся прежнее значение.">
        <input className={s.input} style={{ width: '100%' }} placeholder="http://user:pass@host:port" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Actions status={msg?.text} tone={msg?.bad ? 'bad' : undefined}>
        <button className={`${s.btn} ${s.btnOn}`} disabled={busy} onClick={() => void save()}>Сохранить</button>
        <button className={s.btn} disabled={busy} onClick={() => void check()}>Проверить</button>
      </Actions>
      {info && (
        <Rows>
          <Row title="Внешний IP"><b>{info.ip || '—'}</b></Row>
          <Row title="Соединение">{info.proxy ? <span className={m.mono}>{info.proxy.replace(/\/\/[^@]*@/, '//***@')}</span> : <span className={s.dim}>прямое</span>}</Row>
          {info.impersonate && <Row title="TLS-отпечаток"><span className={m.mono}>{info.impersonate}</span></Row>}
        </Rows>
      )}
    </Sect>
  );
}

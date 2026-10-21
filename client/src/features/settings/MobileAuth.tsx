import { useEffect, useRef, useState } from 'react';
import { confirmDialog } from '@/ui/dialog';
import { get, post, put } from '@/lib/api';
import { safeHref } from '@/lib/safe';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { Hint, Sect } from './kit';

const FIELDS: [key: string, label: string, secret?: boolean][] = [
  ['app_package', 'APP_PACKAGE'], ['app_version_name', 'APP_VERSION_NAME'],
  ['app_version_code', 'APP_VERSION_CODE'], ['device_model', 'Device model'],
  ['android_release', 'Android release'], ['device_uuid', 'Device UUID'],
  ['user_agent_template', 'DEFAULT_USER_AGENT'], ['base_url', 'API base URL'],
  ['app_client_token', 'APP_CLIENT_TOKEN', true], ['oauth_client_id', 'OAUTH_CLIENT_ID'],
  ['oauth_client_secret', 'OAUTH_CLIENT_SECRET', true],
];

interface Cfg { ok?: boolean; values?: Record<string, string | number>; sources?: Record<string, string>; user_agent?: string; error?: string; device_uuid?: string }
interface Auth { ok?: boolean; error?: string; captcha_url?: string; login_masked?: string; can_request_code_again_in?: number; retry_after?: number; resumes?: number; vacancies_count?: number; browser_session_note?: string; user?: { id?: string | number; first_name?: string; last_name?: string } }
interface Msg { t: string; tone?: 'ok' | 'bad'; captcha?: string }

export function MobileAuth() {
  const [kind, setKind] = useState<'email' | 'phone'>('email');
  const [login, setLogin] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [left, setLeft] = useState(0);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const userId = useRef('');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [ua, setUa] = useState('—');
  const [cfgMsg, setCfgMsg] = useState<Msg | null>(null);

  const applyCfg = (c: Cfg) => {
    setCfg(c);
    setVals(Object.fromEntries(FIELDS.map(([k]) => [k, String(c.values?.[k] ?? '')])));
    setUa(c.user_agent || '—');
  };
  useEffect(() => {
    void (async () => {
      try {
        const [c, st] = await Promise.all([
          get<Cfg>('/api/mobile-auth/settings'),
          get<{ stage?: string; login_type?: 'email' | 'phone'; login_masked?: string; retry_after?: number; requested_at?: number }>('/api/mobile-auth/status'),
        ]);
        if (c.ok) applyCfg(c);
        if (st.stage === 'code_requested') {
          setKind(st.login_type || 'phone'); setCodeSent(true);
          setMsg({ t: `Код отправлен: ${st.login_masked}` });
          setLeft(Math.max(0, Number(st.retry_after || 0) - Math.floor(Date.now() / 1000 - Number(st.requested_at || 0))));
        }
      } catch { setCfgMsg({ t: 'Не удалось загрузить настройки авторизации', tone: 'bad' }); }
    })();
  }, []);
  useEffect(() => {
    if (left <= 0) return;
    const id = window.setTimeout(() => setLeft((x) => x - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left]);

  const fail = (d: Auth | null, fallback: string) => setMsg({ t: d?.error || fallback, tone: 'bad', captcha: d?.captcha_url });

  const request = async () => {
    if (!login.trim()) return setMsg({ t: 'Введите телефон или email', tone: 'bad' });
    setBusy(true); setMsg({ t: 'Отправка кода…' });
    try {
      const d = await post<Auth>('/api/mobile-auth/request-code', { login: login.trim(), login_type: kind });
      if (!d.ok) return fail(d, 'Не удалось отправить код');
      setCodeSent(true); setMsg({ t: `Код отправлен: ${d.login_masked}`, tone: 'ok' });
      setLeft(d.can_request_code_again_in || d.retry_after || 0);
    } catch (e) { fail(null, String(e)); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setMsg({ t: 'Проверка кода и загрузка данных…' });
    try {
      const d = await post<Auth>('/api/mobile-auth/verify', { code: code.trim() });
      if (!d.ok) return fail(d, 'Авторизация не удалась');
      const who = [d.user?.first_name, d.user?.last_name].filter(Boolean).join(' ');
      userId.current = String(d.user?.id || '');
      setMsg({ t: `Авторизация успешна${who ? `: ${who}` : ''}\nРезюме: ${d.resumes}; вакансии: ${d.vacancies_count}. ${d.browser_session_note ?? ''}`, tone: 'ok' });
      setCodeSent(false); setCode('');
    } catch (e) { fail(null, String(e)); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    await post('/api/mobile-auth/logout', { mobile_user_id: userId.current }).catch(() => undefined);
    userId.current = ''; setCodeSent(false); setCode(''); setMsg({ t: 'Локальное состояние входа очищено' });
  };

  const preview = async (next: Record<string, string>) => {
    try {
      const d = await post<Cfg>('/api/mobile-auth/settings/validate', { values: payload(next) });
      if (d.ok) { setUa(d.user_agent || '—'); setCfgMsg(null); } else setCfgMsg({ t: d.error ?? 'Ошибка', tone: 'bad' });
    } catch { /* превью необязательно */ }
  };
  const payload = (v: Record<string, string>) => ({ ...v, app_version_code: Number(v.app_version_code) });
  const edit = (k: string, v: string) => { const next = { ...vals, [k]: v }; setVals(next); void preview(next); };
  const saveCfg = async () => {
    try {
      const d = await put<Cfg>('/api/mobile-auth/settings', { values: payload(vals) });
      if (!d.ok) throw new Error(d.error || 'Ошибка сохранения');
      applyCfg(d); setCfgMsg({ t: 'Настройки сохранены и применятся к новым запросам', tone: 'ok' });
    } catch (e) { setCfgMsg({ t: (e as Error).message, tone: 'bad' }); }
  };
  const newUuid = async () => {
    const d = await post<Cfg>('/api/mobile-auth/settings/uuid');
    if (d.ok && d.device_uuid) edit('device_uuid', d.device_uuid);
  };
  const reset = async () => {
    if (!(await confirmDialog('Восстановить штатные настройки мобильного клиента?'))) return;
    const d = await post<Cfg>('/api/mobile-auth/settings/reset');
    if (d.ok) { applyCfg(d); setCfgMsg({ t: 'Значения восстановлены', tone: 'ok' }); }
  };

  const tone = (x?: 'ok' | 'bad') => (x === 'ok' ? s.ok : x === 'bad' ? s.bad : s.dim);
  return (
    <Sect icon="smartphone" title="Авторизация по телефону / email" open>
      <Hint>Штатный OTP-поток Android-приложения. Код отправляется только после нажатия кнопки. OAuth-токены сохраняются для каждого найденного резюме.</Hint>
      <div className={m.inline}>
        <button className={`${s.btn} ${kind === 'email' ? s.btnOn : ''}`} onClick={() => setKind('email')}>Email</button>
        <button className={`${s.btn} ${kind === 'phone' ? s.btnOn : ''}`} onClick={() => setKind('phone')}>Телефон</button>
      </div>
      <div className={m.inline}>
        <input className={s.input} style={{ minWidth: 280 }} type={kind === 'email' ? 'email' : 'tel'} autoComplete="username" placeholder={kind === 'email' ? 'name@example.com' : '+79991234567'} value={login} onChange={(e) => setLogin(e.target.value)} />
        <button className={s.btn} disabled={busy || left > 0} onClick={() => void request()}>{codeSent ? 'Отправить повторно' : 'Отправить код'}</button>
        {left > 0 && <span className={s.dim}>Повтор через {left} с</span>}
      </div>
      {codeSent && (
        <div className={m.inline}>
          <input className={s.input} style={{ width: 180 }} inputMode="numeric" autoComplete="one-time-code" placeholder="Код из SMS / письма" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className={s.btn} disabled={busy || !code.trim()} onClick={() => void verify()}>Подтвердить</button>
          <button className={`${s.btn} ${s.btnDanger}`} onClick={() => void logout()}>Выйти / сбросить</button>
        </div>
      )}
      {msg && (
        <div className={`${m.status} ${tone(msg.tone)}`} style={{ whiteSpace: 'pre-wrap' }}>
          {msg.t}
          {msg.captcha && <> <a className={s.btn} href={safeHref(msg.captcha)} target="_blank" rel="noopener noreferrer">Пройти CAPTCHA</a></>}
        </div>
      )}
      <details>
        <summary style={{ cursor: 'pointer', color: 'var(--dim)' }}>Расширенные параметры мобильного клиента</summary>
        <div className={m.body} style={{ padding: '12px 0 0' }}>
          <div className={m.grid} style={{ gap: 10 }}>
            {FIELDS.map(([k, label, secret]) => (
              <label key={k} className={m.rowS}>
                <span className={s.dim}>{label} <small className={s.warn}>[{cfg?.sources?.[k] || 'default'}]</small></span>
                <input className={s.input} autoComplete="off" type={secret ? 'password' : k === 'app_version_code' ? 'number' : 'text'} value={vals[k] ?? ''} onChange={(e) => edit(k, e.target.value)} />
              </label>
            ))}
          </div>
          <div><div className={s.dim}>Итоговый User-Agent:</div><code style={{ wordBreak: 'break-all', color: 'var(--accent)' }}>{ua}</code></div>
          <Hint>Приоритет: web → environment → file → default. Источник показан рядом с каждым полем.</Hint>
          <div className={m.inline}>
            <button className={s.btn} onClick={() => void saveCfg()}>Сохранить настройки</button>
            <button className={s.btn} onClick={() => void preview(vals).then(() => setCfgMsg((c) => c ?? { t: 'Настройки корректны; запрос к HH не выполнялся', tone: 'ok' }))}>Проверить</button>
            <button className={s.btn} onClick={() => void newUuid()}>Новый UUID</button>
            <button className={s.btn} onClick={() => void reset()}>По умолчанию</button>
          </div>
          {cfgMsg && <div className={`${m.status} ${tone(cfgMsg.tone)}`}>{cfgMsg.t}</div>}
        </div>
      </details>
    </Sect>
  );
}

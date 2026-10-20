import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { get, post } from '@/lib/api';
import { useApp } from '@/store/app';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { CfgCheck, Hint, Sect } from './kit';
import { stripEmoji } from '@/components/Icon';

interface Profile { name: string; api_key: string; base_url: string; model: string; enabled: boolean; key_set?: boolean; key_fingerprint?: string }
const KEY_RE = /^(sk-|gsk_|gemini-|AIza|hf_|tk-|pk_|st-)[A-Za-z0-9_-]{15,}$/;

function detectProvider(k: string) {
  if (k.startsWith('sk-or-')) return { name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' };
  if (k.startsWith('sk-ant-')) return { name: 'Anthropic', base_url: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5-20251001' };
  if (k.startsWith('sk-proj-')) return { name: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };
  if (k.startsWith('gsk_')) return { name: 'Groq', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' };
  if (k.startsWith('AIza')) return { name: 'Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' };
  if (k.startsWith('hf_')) return { name: 'HuggingFace', base_url: 'https://api-inference.huggingface.co/v1', model: 'meta-llama/Llama-3.3-70B-Instruct' };
  if (k.startsWith('sk-') && k.length < 45) return { name: 'DeepSeek', base_url: 'https://api.deepseek.com', model: 'deepseek-chat' };
  if (k.startsWith('sk-')) return { name: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };
  return { name: 'Custom', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };
}

export function LlmSettings() {
  const cfg = useApp((x) => x.snapshot?.config);
  const accs = useApp((x) => x.snapshot?.accounts) ?? [];
  const send = useApp((x) => x.sendCmd);
  const srv = (cfg?.llm_profiles as Profile[] | undefined) ?? [];
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [status, setStatus] = useState<{ t: string; c: string }>({ t: '', c: s.dim });
  const [quick, setQuick] = useState('');
  const [qs, setQs] = useState<{ t: string; c: string }>({ t: '', c: s.dim });
  const [detect, setDetect] = useState<Record<number, { t: string; models?: string[] }>>({});
  const [resAcc, setResAcc] = useState('');
  const [resText, setResText] = useState<{ t: string; c: string; text?: string }>({ t: '', c: s.dim });
  const timer = useRef<number | undefined>(undefined);

  const list: Profile[] = profiles ?? srv.map((p) => ({ name: p.name ?? '', api_key: '', base_url: p.base_url ?? '', model: p.model ?? '', enabled: p.enabled !== false, key_set: p.key_set, key_fingerprint: p.key_fingerprint }));
  const curMode = mode ?? String(cfg?.llm_profile_mode ?? 'fallback');
  const curPrompt = prompt ?? String(cfg?.llm_system_prompt ?? '');
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const save = async (ls = list, md = curMode, pr = curPrompt) => {
    setStatus({ t: 'Сохраняю…', c: s.dim });
    try {
      const prepared = ls.map((p) => {
        let { name, api_key } = p;
        if (!api_key && (KEY_RE.test(name) || (name.length >= 32 && !name.includes(' ')))) { api_key = name; name = ''; } // ключ вставили в «Название»
        return { name, api_key, base_url: p.base_url.trim(), model: p.model.trim(), enabled: p.enabled };
      });
      const r1 = await post<{ ok?: boolean; error?: string }>('/api/llm_profiles', { profiles: prepared, mode: md });
      if (r1?.ok === false) throw new Error(r1.error || 'profiles rejected');
      const r2 = await post<{ ok?: boolean; error?: string }>('/api/llm_config', {
        system_prompt: pr, auto_send: !!cfg?.llm_auto_send, use_cover_letter: cfg?.llm_use_cover_letter ?? true, use_resume: cfg?.llm_use_resume ?? true,
        api_key: prepared[0]?.api_key ?? '', base_url: prepared[0]?.base_url ?? '', model: prepared[0]?.model ?? '',
      });
      if (r2?.ok === false) throw new Error(r2.error || 'config rejected');
      setStatus({ t: `Сохранено в ${new Date().toLocaleTimeString('ru')} · профилей: ${prepared.length} (с ключом: ${prepared.filter((p) => p.api_key).length}) · промпт: ${pr.length} симв.`, c: s.ok });
      setProfiles(null); setMode(null); setPrompt(null);
    } catch (e) { setStatus({ t: e instanceof Error ? e.message : String(e), c: s.bad }); }
  };
  const edit = (f: (a: Profile[]) => Profile[]) => { setProfiles(f(list)); };

  const quickSetup = async () => {
    const key = quick.trim();
    if (!key) return setQs({ t: 'Вставь ключ в поле выше', c: s.warn });
    if (key.length < 20) return setQs({ t: 'Ключ слишком короткий — проверь, что скопировал целиком', c: s.warn });
    const prov = detectProvider(key);
    setQs({ t: `Сохраняю профиль ${prov.name}…`, c: s.accent });
    try {
      let existing: Profile[] = [];
      try { existing = ((await get<{ llm_profiles?: Profile[] }>('/api/raw/config')).llm_profiles) ?? []; } catch { /* ignore */ }
      const np = { name: prov.name, api_key: key, base_url: prov.base_url, model: prov.model, enabled: true };
      const i = existing.findIndex((p) => (p.base_url || '').trim() === prov.base_url);
      const merged = i >= 0 ? existing.map((p, n) => (n === i ? { ...p, ...np } : p)) : [np, ...existing];
      await post('/api/llm_profiles', { profiles: merged, mode: 'fallback' });
      await post('/api/llm_config', { api_key: key, base_url: prov.base_url, model: prov.model, enabled: true, auto_send: true });
      send({ type: 'set_config', key: 'llm_enabled', value: true });
      send({ type: 'set_config', key: 'llm_auto_send', value: true });
      setQuick(''); setProfiles(null);
      setQs({ t: `${prov.name} сохранён · ${key.slice(0, 4)}…${key.slice(-4)} (${key.length} симв.) · модель: ${prov.model} · LLM включён`, c: s.ok });
    } catch (e) { setQs({ t: e instanceof Error ? e.message : String(e), c: s.bad }); }
  };

  const doDetect = async (i: number) => {
    const p = list[i]; if (!p || p.api_key.trim().length < 8) return;
    setDetect((d) => ({ ...d, [i]: { t: '…' } }));
    try {
      const d = await post<{ ok?: boolean; error?: string; base_url?: string; models?: string[] }>('/api/llm_detect', { api_key: p.api_key.trim(), base_url: p.base_url.trim() });
      if (!d.ok) return setDetect((x) => ({ ...x, [i]: { t: (d.error || 'ошибка').slice(0, 40) } }));
      edit((a) => a.map((x, n) => (n === i ? { ...x, base_url: x.base_url || d.base_url || '', model: x.model || d.models?.[0] || '' } : x)));
      setDetect((x) => ({ ...x, [i]: { t: d.models?.length ? `${d.models.length} моделей` : 'нет моделей', models: d.models } }));
    } catch (e) { setDetect((x) => ({ ...x, [i]: { t: String(e) } })); }
  };

  const preview = async () => {
    const idx = resAcc || String(accs[0]?.idx ?? '');
    if (!idx) return;
    setResText({ t: 'Загружаю…', c: s.dim });
    try {
      const d = await get<{ ok?: boolean; text?: string; length?: number }>(`/api/account/${idx}/resume_text`);
      if (d.ok && d.text) setResText({ t: `${d.length} симв.`, c: s.ok, text: d.text });
      else setResText({ t: 'Резюме не удалось извлечь (пустой результат). Проверь куки.', c: s.warn });
    } catch (e) { setResText({ t: String(e), c: s.bad }); }
  };

  return (
    <Sect icon="bot" title="LLM Авто-ответы" open>
      <Hint>Бот отвечает на сообщения работодателей в переговорах со статусом «Интервью». Используется OpenAI-совместимый API (GPT-4o-mini, DeepSeek и др.). Включить/выключить — кнопка во вкладке «LLM Ответы».</Hint>
      <div className={m.inline}>
        <CfgCheck k="llm_auto_send">Отправлять автоматически (иначе только в лог)</CfgCheck>
        <CfgCheck k="llm_use_cover_letter">Учитывать сопроводительное письмо</CfgCheck>
        <CfgCheck k="llm_use_resume">Учитывать резюме</CfgCheck>
        <CfgCheck k="llm_use_quick_replies">HH quick_replies вместо своего LLM</CfgCheck>
        <CfgCheck k="hh_ai_letter_first_try">HH-AI-письмо перед шаблоном</CfgCheck>
        <CfgCheck k="related_vacancies_enabled">Расширять пул через related_vacancies</CfgCheck>
      </div>
      <CfgCheck k="llm_fill_questionnaire" hint="LLM сам отвечает на вопросы работодателя при отклике. Шаблоны используются как запасной вариант.">Заполнять опросники нейронкой (textarea + radio + checkbox)</CfgCheck>

      <div>
        <Hint>Предпросмотр резюме — убедись, что парсинг работает корректно:</Hint>
        <div className={m.inline} style={{ marginTop: 6 }}>
          <select className={s.select} value={resAcc || String(accs[0]?.idx ?? '')} onChange={(e) => setResAcc(e.target.value)}>{accs.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name)}</option>)}</select>
          <button className={s.btn} onClick={() => void preview()}>Загрузить резюме</button><span className={`${m.status} ${resText.c}`}>{resText.t}</span>
        </div>
        {resText.text && <pre className={m.ta} style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', marginTop: 8 }}>{resText.text}</pre>}
      </div>

      <div>
        <div className={m.inline} style={{ justifyContent: 'space-between' }}>
          <b>API профили</b>
          <label className={s.dim}>Режим: <select className={s.select} value={curMode} onChange={(e) => setMode(e.target.value)}><option value="fallback">Резерв (первый рабочий)</option><option value="roundrobin">По очереди</option></select></label>
        </div>
        <Hint>Ключи не отображаются — введите повторно при изменении. Пустое поле ключа = оставить сохранённый.</Hint>
        <div style={{ margin: '10px 0', padding: 10, border: '1px dashed var(--border-hi)', borderRadius: 'var(--r-sm)' }}>
          <b className={s.accent}>Быстрая настройка — вставь ключ и жми Enter</b>
          <div className={m.inline} style={{ marginTop: 6 }}>
            <input className={s.input} type="password" autoComplete="off" style={{ flex: 1, minWidth: 260 }} placeholder="sk-… / gsk_… / AIza… / hf_…" value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void quickSetup(); } }} />
            <button className={s.btn} onClick={() => void quickSetup()}>Сохранить и включить</button>
          </div>
          <div className={`${m.status} ${qs.c}`} style={{ marginTop: 6 }}>{qs.t}</div>
          <Hint>Провайдер определяется по префиксу ключа (OpenAI / DeepSeek / Anthropic / Groq / Gemini / HuggingFace / OpenRouter).</Hint>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((p, i) => (
            <div key={i} className={m.tpl}>
              <div>
                <div className={m.two}>
                  <input className={s.input} placeholder="Название" value={p.name} onChange={(e) => edit((a) => a.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))} />
                  <input className={s.input} type="password" autoComplete="off" placeholder="API Key" value={p.api_key} onChange={(e) => edit((a) => a.map((x, n) => (n === i ? { ...x, api_key: e.target.value } : x)))} />
                </div>
                <div className={s.dim} style={{ fontSize: 11 }}>
                  {p.api_key ? <span className={s.ok}>новый ключ: {p.api_key.length <= 12 ? `••• (${p.api_key.length})` : `${p.api_key.slice(0, 4)}…${p.api_key.slice(-4)} (${p.api_key.length} симв.)`}</span>
                    : p.key_set ? <span className={s.accent}>на сервере: {p.key_fingerprint || 'есть'}</span> : <span className={s.bad}>ключ не задан</span>}
                </div>
                <div className={m.two}>
                  <input className={s.input} placeholder="Модель" value={p.model} onChange={(e) => edit((a) => a.map((x, n) => (n === i ? { ...x, model: e.target.value } : x)))} />
                  <input className={s.input} placeholder="https://api.openai.com/v1" value={p.base_url} onChange={(e) => edit((a) => a.map((x, n) => (n === i ? { ...x, base_url: e.target.value } : x)))} />
                </div>
                {detect[i]?.models && (
                  <select className={s.select} value="" onChange={(e) => { const v = e.target.value; if (v) { edit((a) => a.map((x, n) => (n === i ? { ...x, model: v } : x))); setDetect((d) => ({ ...d, [i]: { t: d[i]?.t ?? '' } })); } }}>
                    <option value="">— выбрать из найденных —</option>{detect[i]?.models?.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                )}
                <div className={m.inline}>
                  <label className={s.checkLbl}><input type="checkbox" checked={p.enabled} onChange={(e) => edit((a) => a.map((x, n) => (n === i ? { ...x, enabled: e.target.checked } : x)))} />Включён</label>
                  <button className={s.btn} onClick={() => void doDetect(i)}><Icon name="search" size={12} />Определить</button>
                  <span className={s.dim}>{detect[i]?.t}</span>
                </div>
              </div>
              <button className={`${s.btn} ${s.btnDanger} ${s.btnSm}`} onClick={() => edit((a) => a.filter((_, n) => n !== i))}><Icon name="x" size={12} /></button>
            </div>
          ))}
        </div>
        <button className={s.btn} style={{ marginTop: 8 }} onClick={() => edit((a) => [...a, { name: '', api_key: '', base_url: '', model: '', enabled: true }])}><Icon name="plus" size={13} />Добавить профиль вручную</button>
      </div>

      <label><span className={s.dim}>Системный промпт</span><textarea className={m.ta} rows={4} value={curPrompt} onChange={(e) => setPrompt(e.target.value)} /></label>
      <div className={m.inline}>
        <button className={s.btn} onClick={() => { window.clearTimeout(timer.current); void save(); }}>Сохранить</button>
        <span className={m.status}><span className={status.c}>{status.t}</span></span>
      </div>
    </Sect>
  );
}

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Select } from '@/ui/radix';
import { Icon, stripEmoji } from '@/components/Icon';
import { get, post } from '@/lib/api';
import { useApp } from '@/store/app';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { Row, Rows, Sect } from './kit';

/** Выбор аккаунта: возвращает [idx, select]. */
function useAccountSelect() {
  const accounts = useApp((x) => x.snapshot?.accounts) ?? [];
  const [idx, setIdx] = useState<number | null>(null);
  const cur = idx ?? accounts[0]?.idx ?? null;
  const el: ReactNode = (
    <Select style={{ minWidth: 200 }} value={cur ?? ''} onChange={(e) => setIdx(Number(e.target.value))}>
      {accounts.length === 0 && <option value="">Нет аккаунтов</option>}
      {accounts.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name)}</option>)}
    </Select>
  );
  return [cur, el] as const;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ── Статус поиска работы ── */
interface Diag { ok?: boolean; error?: string; status?: string; status_label?: string; available_statuses?: Record<string, string> }

export function JobStatus() {
  const [idx, pick] = useAccountSelect();
  const [d, setD] = useState<Diag | null>(null);
  const [sel, setSel] = useState('');
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (idx === null) return;
    let alive = true;
    setLoading(true); setMsg(null); setD(null);
    get<Diag>(`/api/account/${idx}/diagnostics`)
      .then((r) => { if (!alive) return; if (r.ok === false) throw new Error(r.error); setD(r); setSel(r.status ?? ''); })
      .catch((e) => alive && setMsg({ t: errText(e) || 'Не удалось загрузить диагностику', bad: true }))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [idx]);

  const avail = d?.available_statuses ?? {};
  const keys = Object.keys(avail);
  const apply = async () => {
    if (idx === null || !sel) return setMsg({ t: 'Выберите аккаунт и статус', bad: true });
    try {
      const r = await post<{ ok?: boolean; error?: string; label?: string }>(`/api/account/${idx}/job_status`, { status: sel });
      if (r.ok === false) throw new Error(r.error);
      const label = r.label || avail[sel] || sel;
      setD((p) => (p ? { ...p, status: sel, status_label: label } : p));
      setMsg({ t: label });
    } catch (e) { setMsg({ t: errText(e) || 'Не удалось сменить статус', bad: true }); }
  };
  return (
    <Sect icon="compass" title="Статус поиска работы" open>
      <Rows>
        <Row title="Аккаунт">{pick}</Row>
        <Row title="Сейчас на HH" hint="Так вас видят работодатели"><b>{loading ? 'Загрузка…' : d?.status_label || d?.status || '—'}</b></Row>
        <Row title="Новый статус">
          <Select style={{ minWidth: 220 }} disabled={!keys.length} value={sel} onChange={(e) => setSel(e.target.value)}>
            {keys.map((k) => <option key={k} value={k}>{avail[k]}</option>)}
          </Select>
          <button className={`${s.btn} ${s.btnOn}`} disabled={!keys.length} onClick={() => void apply()}>Применить</button>
        </Row>
      </Rows>
      {msg && <div className={`${m.status} ${msg.bad ? s.bad : s.ok}`}>{msg.t}</div>}
    </Sect>
  );
}

/* ── Навыки и верификации ── */
interface MethodItem { name?: string; verification_objects?: { id?: string | number; name?: string; level?: { name?: string } }[]; kak_dela_quiz?: { task_number?: number; estimated_time?: number }; availability?: { status?: string } }
interface SkillItem { name?: string; verified?: boolean; category?: string }
interface Syllabus { ok?: boolean; error?: string; name?: string; levels?: { name?: string; theory?: { content?: string; task_number?: number; estimated_time?: number } }[] }
interface ListRes<T> { ok?: boolean; error?: string; items?: T[] }

export function Skills() {
  const [idx, pick] = useAccountSelect();
  const [methods, setMethods] = useState<ListRes<MethodItem> | null>(null);
  const [skills, setSkills] = useState<ListRes<SkillItem> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [syl, setSyl] = useState<{ loading?: boolean; data?: Syllabus; error?: string } | null>(null);

  const load = async () => {
    if (idx === null) return setErr('Сначала выберите аккаунт.');
    setBusy(true); setErr('');
    const safe = <T,>(p: Promise<T>) => p.catch((e: unknown) => ({ ok: false, error: errText(e) }) as T);
    const [a, b] = await Promise.all([
      safe(get<ListRes<MethodItem>>(`/api/account/${idx}/skill_verifications/methods`)),
      safe(get<ListRes<SkillItem>>(`/api/account/${idx}/skill_verifications/skills`)),
    ]);
    setMethods(a); setSkills(b); setBusy(false);
  };
  const open = async (id: string | number | undefined) => {
    if (idx === null || id === undefined || id === '') return;
    setSyl({ loading: true });
    try {
      const d = await get<Syllabus>(`/api/account/${idx}/skill_verification/${id}`);
      if (d.ok === false) throw new Error(d.error);
      setSyl({ data: d });
    } catch (e) { setSyl({ error: errText(e) || 'Не удалось загрузить программу теста' }); }
  };
  const close = useCallback(() => setSyl(null), []);
  useEffect(() => {
    if (!syl) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [syl, close]);

  const bad = (label: string, r: ListRes<unknown> | null) => (r && r.ok === false ? <div className={`${m.status} ${s.bad}`}>{label}: {r.error || 'не удалось загрузить'}</div> : null);
  return (
    <Sect icon="graduation-cap" title="Навыки и верификации">
      <div className={m.inline}>{pick}<button className={s.btn} disabled={busy} onClick={() => void load()}>Загрузить</button></div>
      {err && <div className={`${m.status} ${s.bad}`}>{err}</div>}
      {methods && methods.ok !== false && (
        <div>
          <h4 className={m.sub}>Доступные тесты</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(methods.items ?? []).length === 0 && <span className={s.dim}>Нет доступных тестов</span>}
            {(methods.items ?? []).map((it, i) => {
              const o = it.verification_objects?.[0] ?? {};
              return (
                <button key={i} className={m.item} onClick={() => void open(o.id)}>
                  <b>{it.name}</b>
                  <div className={s.dim}>{o.name}{o.level?.name ? ` · ${o.level.name}` : ''} · вопросов: {it.kak_dela_quiz?.task_number ?? '?'} · ~{it.kak_dela_quiz?.estimated_time ?? '?'} сек · {it.availability?.status ?? ''}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {bad('Доступные тесты', methods)}
      {skills && skills.ok !== false && (
        <div>
          <h4 className={m.sub}>Мои навыки</h4>
          {(skills.items ?? []).length === 0 && <span className={s.dim}>Навыков нет</span>}
          {(skills.items ?? []).map((it, i) => (
            <div key={i} style={{ padding: '3px 0' }}>
              <Icon name={it.verified ? 'check' : 'circle'} size={13} className={it.verified ? s.ok : s.dim} /> {it.name}
              <span className={s.dim}> · {it.category}</span>
            </div>
          ))}
        </div>
      )}
      {bad('Мои навыки', skills)}
      {syl && (
        <div className={m.back} onClick={(e) => e.target === e.currentTarget && close()}>
          <div className={m.modal}>
            <button className={m.modalX} onClick={close} aria-label="Закрыть"><Icon name="x" size={16} /></button>
            {syl.loading && <span className={s.dim}>Загружаю программу теста…</span>}
            {syl.error && <span className={s.bad}>{syl.error}</span>}
            {syl.data && (
              <>
                <h3>{syl.data.name}</h3>
                {(syl.data.levels ?? []).length === 0 && <span className={s.dim}>Уровней нет</span>}
                {(syl.data.levels ?? []).map((lv, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <b>{lv.name}</b>
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      {String(lv.theory?.content || '').split('\n').filter(Boolean).map((l, n) => <div key={n}>{l}</div>)}
                      {!lv.theory?.content && <span className={s.dim}>Программа не указана</span>}
                    </div>
                    <div className={s.dim} style={{ fontSize: 12, marginTop: 4 }}>Вопросов: {lv.theory?.task_number ?? '?'} · ~{lv.theory?.estimated_time ?? '?'} сек</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </Sect>
  );
}

/* ── Анализ резюме ── */
type Obj = Record<string, unknown>;
const KNOWN = new Set(['ok', 'title', 'resume_id', 'grade', 'current_score', 'subroles', 'missing_skills', 'recommended_duties', 'partial', 'errors', 'error']);
const itemName = (it: unknown): string => {
  if (typeof it === 'string') return it.trim();
  if (it && typeof it === 'object' && !Array.isArray(it)) {
    for (const k of ['name', 'string', 'text', 'title']) { const v = (it as Obj)[k]; if (typeof v === 'string' && v.trim()) return v.trim(); }
    try { return JSON.stringify(it); } catch { return String(it); }
  }
  return it == null ? '' : String(it);
};
const scoreText = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? (n <= 1 ? `${Math.round(n * 100)}%` : String(Math.round(n))) : null);

function ListSection({ title, items }: { title: string; items: unknown }) {
  const names = (Array.isArray(items) ? items : []).map(itemName).filter(Boolean);
  return (
    <div>
      <h4 className={m.sub}>{title}</h4>
      {names.length ? <ul className={m.ul}>{names.map((n, i) => <li key={i}>{n}</li>)}</ul> : <span className={s.dim}>Нет данных.</span>}
    </div>
  );
}

export function ResumeAnalysis() {
  const [idx, pick] = useAccountSelect();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ data?: Obj; error?: string } | null>(null);

  const run = async () => {
    if (idx === null) return setRes({ error: 'Сначала выберите аккаунт.' });
    setBusy(true);
    try {
      const d = await get<Obj>(`/api/account/${idx}/resume_audit`);
      if (!d || typeof d !== 'object') throw new Error('Пустой ответ сервера.');
      if (d.ok === false || (d.error && d.ok !== true)) throw new Error(String(d.error || 'Неизвестная ошибка'));
      setRes({ data: d });
    } catch (e) { setRes({ error: errText(e) || 'Не удалось выполнить анализ резюме.' }); }
    setBusy(false);
  };

  const d = res?.data;
  const grade = d && (typeof d.grade === 'object' && d.grade ? ((d.grade as Obj).name ?? (d.grade as Obj).id) : d.grade);
  const sc = d ? scoreText(d.current_score) : null;
  const subroles = (Array.isArray(d?.subroles) ? d.subroles : []) as Obj[];
  const errors = (Array.isArray(d?.errors) ? d.errors : []) as unknown[];
  const extra = d ? Object.fromEntries(Object.entries(d).filter(([k]) => !KNOWN.has(k))) : {};
  return (
    <Sect icon="bot" title="Анализ резюме">
      <div className={m.inline}>{pick}<button className={s.btn} disabled={busy} onClick={() => void run()}>{busy ? 'Анализ…' : 'Анализировать'}</button></div>
      {res?.error && <div className={`${m.box} ${m.boxBad}`}>{res.error}</div>}
      {d && (
        <div className={m.box}>
          <div><b>{typeof d.title === 'string' && d.title.trim() ? d.title.trim() : 'Без названия'}</b>{d.resume_id != null && String(d.resume_id).trim() !== '' && <div className={s.dim} style={{ fontSize: 10 }}>resume_id: {String(d.resume_id)}</div>}</div>
          {(grade != null && String(grade).trim() !== '' || sc) && (
            <div className={m.chips}>
              {grade != null && String(grade).trim() !== '' && <span className={`${m.chip} ${m.chipOn}`}>{String(grade)}</span>}
              {sc && <span className={m.chip}>Совпадение: {sc}</span>}
            </div>
          )}
          {subroles.length > 0 && (
            <div>
              <h4 className={m.sub}>Саброли / грейд</h4>
              <div className={m.chips}>
                {subroles.map((sub, i) => {
                  const n = itemName(sub); if (!n) return null;
                  const p = typeof sub.probability === 'number' ? ` · ${Math.round(sub.probability * 100)}%` : '';
                  return <span key={i} className={`${m.chip} ${sub.main ? m.chipOn : ''}`}>{n}{p}</span>;
                })}
              </div>
            </div>
          )}
          <ListSection title="Чего не хватает" items={d.missing_skills} />
          <ListSection title="Рекомендуемые обязанности" items={d.recommended_duties} />
          {Boolean(d.partial) && (
            <div className={`${m.box} ${m.boxWarn}`}>
              Результат неполный: часть источников недоступна.
              {errors.length > 0 && <ul className={m.ul}>{errors.map((er, i) => <li key={i}>{er && typeof er === 'object' ? `${(er as Obj).endpoint ?? 'endpoint'}: ${(er as Obj).error ?? 'ошибка'}` : String(er)}</li>)}</ul>}
            </div>
          )}
          {Object.keys(extra).length > 0 && (
            <details><summary className={s.dim} style={{ cursor: 'pointer', fontSize: 11 }}>Дополнительные данные ({Object.keys(extra).length})</summary><pre className={m.pre}>{JSON.stringify(extra, null, 2)}</pre></details>
          )}
        </div>
      )}
    </Sect>
  );
}

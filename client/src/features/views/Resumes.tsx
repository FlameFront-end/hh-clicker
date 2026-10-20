import { useState } from 'react';
import { get, post } from '@/lib/api';
import { safeHref } from '@/lib/safe';
import s from '@/ui/Ui.module.css';
import { Err, Item, Section, useLoader, type Json } from './bits';

const STATUS: Record<string, [string, string]> = {
  published: [s.ok, 'опубликовано'], auto_approved: [s.ok, 'опубликовано'], not_finished: [s.bad, 'не завершено'], modified: [s.warn, 'изменено'], blocked: [s.bad, 'заблокировано'],
};
const PRESETS: [string, string][] = [
  ['Автоматизация тестирования', '15.9'], ['Python Developer', '10.3'], ['QA Engineer', '26.8'],
  ['Системный администратор', '20.0'], ['Аналитик', '2.3'], ['DevOps инженер', '23.9'],
];

export function Resumes({ idx }: { idx: string }) {
  const l = useLoader(() => get<Json>(`/api/account/${idx}/all_resumes`));
  const [preset, setPreset] = useState('');
  const [custom, setCustom] = useState('');
  const [st, setSt] = useState<{ t: string; c: string }>({ t: '', c: s.dim });
  const [busy, setBusy] = useState(false);
  const items: Json[] = l.data?.resumes ?? [];

  const clone = async () => {
    const title = custom.trim() || preset;
    if (!title && !confirm('Клонировать без заголовка? Придётся задать вручную на hh.ru')) return;
    setBusy(true); setSt({ t: 'Клонирую…', c: s.dim });
    try {
      const d = await post<Json>(`/api/account/${idx}/clone_resume`, { title });
      if (d.ok) { setSt({ t: d.title_set ? `Склонировано: «${title}»` : 'Склонировано (заголовок задай на hh.ru)', c: s.ok }); setTimeout(() => void l.run(), 500); }
      else setSt({ t: d.error || 'Ошибка', c: s.bad });
    } catch (e) { setSt({ t: String(e), c: s.bad }); } finally { setBusy(false); }
  };
  const quickEdit = async (hash: string) => {
    const title = prompt('Заголовок резюме (должность):', ''); if (title === null) return;
    const salary = prompt('Зарплата (₽, 0 = убрать):', '0');
    const about = prompt('О себе (описание, пусто = не менять):', '');
    const body: Json = { resume_hash: hash };
    if (title) body.title = title;
    if (salary && parseInt(salary) > 0) body.salary = parseInt(salary);
    if (about) body.skills = about;
    if (Object.keys(body).length < 2) return alert('Нечего менять');
    try {
      const d = await post<Json>(`/api/account/${idx}/edit_resume`, body);
      if (d.ok) { alert('Резюме обновлено'); void l.run(); } else alert(d.error || 'Ошибка');
    } catch (e) { alert(String(e)); }
  };

  return (
    <Section icon="file-text" title="Резюме аккаунта"
      actions={<button className={s.btn} disabled={l.busy || !idx} onClick={l.run}>Загрузить</button>}
      status={l.busy ? '…' : l.data ? `${l.data.total ?? 0} резюме` : <Err text={l.err} />}>
      <div className={s.filters}>
        <select className={s.select} value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="">— Выбери нишу —</option>
          {PRESETS.map(([n, c]) => <option key={n} value={n}>{n} (конкуренция {c})</option>)}
        </select>
        <input className={s.input} style={{ maxWidth: 260 }} placeholder="или свой заголовок…" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className={s.btn} disabled={busy || !idx} onClick={() => void clone()}>Клонировать</button>
        <span className={st.c} style={{ fontSize: 12 }}>{st.t}</span>
      </div>
      {l.data && !items.length && <span className={s.dim}>Нет резюме</span>}
      {items.map((r, i) => {
        const [c, lbl] = STATUS[r.status] ?? [s.dim, r.status || '—'];
        const pct = Number(r.percent) || 0;
        const exp = r.experience_count;
        const content = [r.skills_count ? `${r.skills_count} навыков` : '', exp == null ? '' : exp === 0 ? 'без опыта' : `${exp} мест работы`].filter(Boolean).join(', ') || 'пусто';
        return (
          <Item key={i} title={r.title}
            sub={<><span className={c}>{lbl}</span>{pct > 0 && <span className={pct >= 80 ? s.ok : s.warn}> · {pct}%</span>} · {r.is_searchable ? 'в поиске' : 'скрыто'} · {content}{(r.views_7d || r.shows_7d) ? ` · ${r.views_7d || 0} просм. · ${r.shows_7d || 0} показов` : ''}</>}
            right={<span style={{ float: 'right', display: 'inline-flex', gap: 6 }}>
              <a className={s.btn} style={{ textDecoration: 'none' }} href={safeHref(r.edit_url)} target="_blank" rel="noopener noreferrer">hh.ru</a>
              <button className={s.btn} onClick={() => void quickEdit(r.hash)}>Быстро</button>
            </span>} />
        );
      })}
    </Section>
  );
}

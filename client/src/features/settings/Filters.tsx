import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/store/app';
import { stripEmoji } from '@/components/Icon';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { CfgCheck, CfgNumber, CfgSelect, Hint, Hr, Sect, Sub, TagInput, useFlash } from './kit';

const SCHEDULES: [string, string][] = [['remote', 'Удалённая'], ['fullDay', 'Полный день'], ['flexible', 'Гибкий'], ['shift', 'Сменный'], ['flyInFlyOut', 'Вахта']];
const EXP: [string, string][] = [['noExperience', 'Без опыта'], ['between1And3', '1–3 года'], ['between3And6', '3–6 лет'], ['moreThan6', '6+ лет']];
const FMT: [string, string][] = [['REMOTE', 'Удалёнка'], ['HYBRID', 'Гибрид'], ['ON_SITE', 'Офис']];
const norm = (t: unknown): string => (!t ? '—' : typeof t === 'string' ? t : Array.isArray(t) ? t.map((x) => (x as { string?: string })?.string ?? x).filter(Boolean).join(' ') : (t as { string?: string }).string ?? '—');
const parse = (v: string) => [...new Set(v.split(/[,;\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
const toText = (a?: string[]) => (a ?? []).join(', ');

function Region() {
  const v = useApp((x) => x.snapshot?.config?.hh_region);
  const send = useApp((x) => x.sendCmd);
  const [d, setD] = useState<string | null>(null);
  return (
    <div className={m.inline}>
      <span className={`${s.dim} ${m.mono}`}>https://</span>
      <input className={s.input} style={{ width: 150 }} maxLength={40} pattern="[a-z0-9-]*" placeholder="пусто = основной" value={d ?? String(v ?? '')}
        onChange={(e) => setD(e.target.value)} onBlur={() => { if (d !== null) { send({ type: 'set_config', key: 'hh_region', value: d.trim().toLowerCase() }); setD(null); } }} />
      <span className={`${s.dim} ${m.mono}`}>.hh.ru</span>
      <Hint>Пример: <code>syktyvkar</code>, <code>moscow</code>. OAuth и chatik всегда на основном домене.</Hint>
    </div>
  );
}

function ResumeFilters() {
  const accs = useApp((x) => x.snapshot?.accounts) ?? [];
  const [accIdx, setAccIdx] = useState<number | null>(null);
  const [hash, setHash] = useState('');
  const cur = accIdx ?? accs[0]?.idx ?? null;
  const acc = accs.find((a) => a.idx === cur);
  const resumes = acc?.all_resumes ?? [];
  const curHash = resumes.some((r) => r.hash === hash) ? hash : acc?.resume_hash || resumes[0]?.hash || '';
  const prof = acc?.resume_filters?.[curHash];
  const [incl, setIncl] = useState(''); const [excl, setExcl] = useState(''); const [emp, setEmp] = useState('');
  const [exp, setExp] = useState<string[]>([]); const [fmt, setFmt] = useState<string[]>([]);
  const [flash, setFlash] = useFlash(4000);
  const key = `${cur}:${curHash}`;
  useEffect(() => { // подгружаем форму при смене аккаунта/резюме (и при первом снимке)
    setIncl(toText(prof?.title_include_keywords)); setExcl(toText(prof?.title_exclude_keywords)); setEmp(toText(prof?.employer_exclude_keywords));
    setExp(prof?.experience ?? []); setFmt(prof?.allowed_work_formats ?? []);
  }, [key, !!prof]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (set: (f: (a: string[]) => string[]) => void, v: string) => set((a) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]));
  const save = async () => {
    if (cur === null || !curHash) return setFlash('Нет выбранного аккаунта или резюме');
    setFlash('Сохраняю…');
    try {
      const d = await api<{ ok?: boolean; error?: string }>(`/api/account/${cur}/resume_filters`, { method: 'PATCH', body: { resume_hash: curHash, filters: { title_include_keywords: parse(incl), title_exclude_keywords: parse(excl), employer_exclude_keywords: parse(emp), experience: exp, allowed_work_formats: fmt } } });
      if (!d.ok) throw new Error(d.error || 'ошибка');
      setFlash('Правила сохранены');
    } catch (e) { setFlash('Ошибка: ' + (e instanceof Error ? e.message : e)); }
  };
  return (
    <div>
      <Sub>Фильтры по резюме</Sub>
      <Hint>Правила сохраняются отдельно для выбранного резюме. Пустой include = без ограничения.</Hint>
      <div className={m.two} style={{ margin: '8px 0' }}>
        <select className={s.select} value={cur ?? ''} onChange={(e) => { setAccIdx(Number(e.target.value)); setHash(''); }}>{accs.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name)}</option>)}</select>
        <select className={s.select} value={curHash} onChange={(e) => setHash(e.target.value)}>{resumes.map((r) => <option key={r.hash} value={r.hash}>{norm(r.title)}</option>)}</select>
      </div>
      <div className={m.three}>
        <label><span className={s.ok}>Разрешить в названии</span><textarea className={m.ta} rows={3} value={incl} onChange={(e) => setIncl(e.target.value)} placeholder="frontend, react, typescript" /></label>
        <label><span className={s.bad}>Исключить в названии</span><textarea className={m.ta} rows={3} value={excl} onChange={(e) => setExcl(e.target.value)} placeholder="junior, intern, lead" /></label>
        <label><span className={s.warn}>Исключить работодателей</span><textarea className={m.ta} rows={3} value={emp} onChange={(e) => setEmp(e.target.value)} placeholder="сбер, агентство" /></label>
      </div>
      <div className={m.inline} style={{ marginTop: 8 }}>
        <span className={s.dim}>Опыт:</span>{EXP.map(([v, l]) => <label key={v} className={s.checkLbl}><input type="checkbox" checked={exp.includes(v)} onChange={() => toggle(setExp, v)} />{l}</label>)}
      </div>
      <div className={m.inline} style={{ marginTop: 6 }}>
        <span className={s.dim}>Формат:</span>{FMT.map(([v, l]) => <label key={v} className={s.checkLbl}><input type="checkbox" checked={fmt.includes(v)} onChange={() => toggle(setFmt, v)} />{l}</label>)}
      </div>
      <div className={m.inline} style={{ marginTop: 8 }}><button className={s.btn} onClick={() => void save()}>Сохранить правила резюме</button><span className={m.status}>{flash}</span></div>
    </div>
  );
}

export function Filters() {
  const cfg = useApp((x) => x.snapshot?.config);
  const send = useApp((x) => x.sendCmd);
  const scheds = useMemo(() => (cfg?.allowed_schedules as string[] | undefined) ?? [], [cfg?.allowed_schedules]);
  const incl = (cfg?.title_include_keywords as string[] | undefined) ?? [];
  const excl = (cfg?.title_exclude_keywords as string[] | undefined) ?? [];
  const fresh = !!cfg?.fresh_vacancies_mode;
  return (
    <Sect icon="sliders-horizontal" title="Фильтры и автоматизация">
      <div><Sub>Региональный поддомен HH</Sub><Region /></div>
      <Hr />
      <div>
        <Sub>Род соискателя для LLM-ответов</Sub>
        <CfgSelect k="llm_applicant_gender" options={[['female', 'Женский'], ['male', 'Мужской'], ['neutral', 'Нейтральный']]} />
        <Hint>Подставляется в системный промпт LLM и дефолтный ответ опросника.</Hint>
      </div>
      <Hr />
      <div>
        <Sub>Умный поиск</Sub>
        <div className={m.inline}>
          <CfgCheck k="filter_agencies">Исключить агентства</CfgCheck>
          <CfgCheck k="filter_low_competition">Только малоконкурентные (&lt;10 откликов)</CfgCheck>
          <span className={s.dim}>Свежесть:</span>
          <CfgSelect k="search_period_days" number options={[['0', 'Все'], ['1', '1 день'], ['3', '3 дня'], ['7', '7 дней'], ['14', '14 дней'], ['30', '30 дней']]} />
        </div>
        <Hint>Фильтры добавляются к поисковым URL. Работают для веб-поиска и OAuth.</Hint>
      </div>
      <Hr />
      <div>
        <Sub>Формат работы</Sub>
        <Hint>Отмечены = разрешены. Если ничего не отмечено — фильтра нет.</Hint>
        <div className={m.inline} style={{ marginTop: 6 }}>
          {SCHEDULES.map(([v, l]) => (
            <label key={v} className={s.checkLbl}><input type="checkbox" checked={scheds.includes(v)} onChange={(e) => send({ type: 'set_config', key: 'allowed_schedules', value: e.target.checked ? [...scheds, v] : scheds.filter((x) => x !== v) })} />{l}</label>
          ))}
        </div>
      </div>
      <Hr />
      <div>
        <Sub>Фильтр по словам в названии</Sub>
        <Hint>Регистронезависимо, по подстроке. Применяется до отклика — экономит запросы.</Hint>
        <div className={m.two} style={{ marginTop: 8 }}>
          <div><span className={s.ok} style={{ fontSize: 11.5 }}>Разрешить (include) — если непусто, оставляем только совпавшие</span><TagInput tone="ok" tags={incl} placeholder="python, backend, golang — Enter / запятая" onChange={(v) => send({ type: 'set_config', key: 'title_include_keywords', value: v })} /></div>
          <div><span className={s.bad} style={{ fontSize: 11.5 }}>Исключить (exclude) — выкинуть, если содержит</span><TagInput tone="bad" tags={excl} placeholder="junior, стажёр, intern" onChange={(v) => send({ type: 'set_config', key: 'title_exclude_keywords', value: v })} /></div>
        </div>
      </div>
      <Hr />
      <ResumeFilters />
      <Hr />
      <CfgCheck k="auto_apply_tests" hint="Если включен LLM — вопросы заполнит нейронка. Иначе — шаблонные ответы.">Автоматически заполнять и отправлять опросники при откликах (для всех аккаунтов)</CfgCheck>
      <CfgCheck k="skip_inconsistent" hint="Дополнительный запрос к HH для каждой вакансии: медленнее, но пропускает неподходящие.">Пропускать вакансии с несовпадением опыта (pre-check)</CfgCheck>
      <Hr />
      <div>
        <Sub>Контроль лимитов</Sub>
        <div className={m.inline}><span>Дневной лимит:</span><CfgNumber k="daily_apply_limit" min={0} max={500} /><span className={s.dim}>(0 = без лимита)</span></div>
        <div style={{ marginTop: 8 }}><CfgCheck k="stop_on_hh_limit" hint="Бот ставит паузу при лимите. Снимите паузу вручную или дождитесь 00:00 МСК.">Полная остановка при лимите HH (не перепроверять, ждать до завтра)</CfgCheck></div>
        <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)' }}>
          <CfgCheck k="fresh_vacancies_mode">Беречь часть дневного лимита для свежих вакансий</CfgCheck>
          <div className={m.inline} style={{ marginTop: 8, opacity: fresh ? 1 : .6 }}>
            <span>Свежая не старше</span><CfgNumber k="fresh_vacancy_hours" min={1} max={168} fallback={24} width={64} map={(n) => Math.max(1, n || 24)} /><span>ч</span>
            <span>Резерв</span><CfgNumber k="fresh_apply_reserve" min={0} max={200} fallback={50} width={64} map={(n) => Math.max(0, n || 0)} /><span>откликов</span>
          </div>
          <Hint>Старые вакансии расходуют лимит только до границы «лимит − резерв». Свежие идут первыми.</Hint>
        </div>
      </div>
      <Hr />
      <CfgCheck k="use_oauth_apply" hint="Если выключено — отклики через Web (cookies). OAuth быстрее и без капчи, но по одному запросу.">Метод откликов: OAuth API (токен Android-приложения — без капчи, чистый JSON)</CfgCheck>
    </Sect>
  );
}

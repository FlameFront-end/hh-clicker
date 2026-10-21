import { useEffect, useMemo, useState } from 'react';
import { Select } from '@/ui/radix';
import { api } from '@/lib/api';
import { useApp } from '@/store/app';
import { stripEmoji } from '@/components/Icon';
import s from '@/ui/Ui.module.css';
import m from './Settings.module.css';
import { Actions, Block, CfgNumber, CfgSelect, CfgSwitch, ChipSet, Field, Row, Rows, Sect, TagInput, useFlash } from './kit';

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
    <label className={m.domain}>
      <span>https://</span>
      <input maxLength={40} pattern="[a-z0-9-]*" placeholder="основной" value={d ?? String(v ?? '')} aria-label="Региональный поддомен"
        onChange={(e) => setD(e.target.value)} onBlur={() => { if (d !== null) { send({ type: 'set_config', key: 'hh_region', value: d.trim().toLowerCase() }); setD(null); } }} />
      <span>.hh.ru</span>
    </label>
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
    <Block title="Правила для конкретного резюме" desc="Сохраняются отдельно для выбранного резюме. Пустое «разрешить» — без ограничения.">
      <div className={m.cols2}>
        <Field label="Аккаунт"><Select value={cur ?? ''} onChange={(e) => { setAccIdx(Number(e.target.value)); setHash(''); }}>{accs.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name)}</option>)}</Select></Field>
        <Field label="Резюме"><Select value={curHash} onChange={(e) => setHash(e.target.value)}>{resumes.map((r) => <option key={r.hash} value={r.hash}>{norm(r.title)}</option>)}</Select></Field>
      </div>
      <div className={m.three}>
        <Field label="Разрешить в названии" tone="ok"><textarea className={m.ta} rows={3} value={incl} onChange={(e) => setIncl(e.target.value)} placeholder="frontend, react, typescript" /></Field>
        <Field label="Исключить в названии" tone="bad"><textarea className={m.ta} rows={3} value={excl} onChange={(e) => setExcl(e.target.value)} placeholder="junior, intern, lead" /></Field>
        <Field label="Исключить работодателей" tone="warn"><textarea className={m.ta} rows={3} value={emp} onChange={(e) => setEmp(e.target.value)} placeholder="сбер, агентство" /></Field>
      </div>
      <Field label="Опыт"><ChipSet options={EXP} value={exp} onChange={setExp} /></Field>
      <Field label="Формат работы"><ChipSet options={FMT} value={fmt} onChange={setFmt} /></Field>
      <Actions status={flash} tone={flash.startsWith('Ошибка') || flash.startsWith('Нет') ? 'bad' : 'ok'}><button className={s.btn} onClick={() => void save()}>Сохранить правила резюме</button></Actions>
    </Block>
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
      <Block title="Поиск" desc="Что добавляется к поисковым URL. Работает и для веб-поиска, и для OAuth.">
        <Rows>
          <Row title="Региональный поддомен" hint={<>Например <code>syktyvkar</code>. Пусто — основной hh.ru. OAuth и chatik всегда на основном домене.</>}><Region /></Row>
          <CfgSwitch k="filter_agencies" title="Исключать агентства" hint="Только прямые работодатели" />
          <CfgSwitch k="filter_low_competition" title="Только малоконкурентные" hint="Меньше 10 откликов на вакансию" />
          <Row title="Свежесть вакансий" hint="Не старше выбранного срока"><CfgSelect k="search_period_days" number options={[['0', 'Все'], ['1', '1 день'], ['3', '3 дня'], ['7', '7 дней'], ['14', '14 дней'], ['30', '30 дней']]} /></Row>
        </Rows>
        <Field label="Формат работы" hint="Выбранные форматы разрешены. Ничего не выбрано — фильтра нет."><ChipSet options={SCHEDULES} value={scheds} onChange={(v) => send({ type: 'set_config', key: 'allowed_schedules', value: v })} /></Field>
      </Block>

      <Block title="Слова в названии вакансии" desc="Регистр не важен, поиск по подстроке. Применяется до отклика — экономит запросы. Enter или запятая добавляют слово.">
        <div className={m.cols2}>
          <Field label="Разрешить" tone="ok" hint="Если список не пуст — остаются только совпавшие"><TagInput tone="ok" tags={incl} placeholder="python, backend…" onChange={(v) => send({ type: 'set_config', key: 'title_include_keywords', value: v })} /></Field>
          <Field label="Исключить" tone="bad" hint="Вакансии с этими словами пропускаются"><TagInput tone="bad" tags={excl} placeholder="junior, стажёр…" onChange={(v) => send({ type: 'set_config', key: 'title_exclude_keywords', value: v })} /></Field>
        </div>
      </Block>

      <ResumeFilters />

      <Block title="Отклики" desc="Как бот откликается и что делает с опросниками.">
        <Rows>
          <CfgSwitch k="use_oauth_apply" title="Откликаться через OAuth API" hint="Токен Android-приложения: без капчи, чистый JSON, но по одному запросу. Выключено — отклики через Web (cookies)." />
          <CfgSwitch k="auto_apply_tests" title="Заполнять опросники автоматически" hint="Для всех аккаунтов. Если включён LLM — отвечает нейронка, иначе шаблоны." />
          <CfgSwitch k="skip_inconsistent" title="Пропускать несовпадение по опыту" hint="Доп. запрос к HH на каждую вакансию — медленнее, но отсекает неподходящие." />
          <Row title="Род соискателя для ответов" hint="Подставляется в промпт LLM и дефолтный ответ опросника"><CfgSelect k="llm_applicant_gender" options={[['female', 'Женский'], ['male', 'Мужской'], ['neutral', 'Нейтральный']]} /></Row>
        </Rows>
      </Block>

      <Block title="Лимиты" desc="HH ограничивает число откликов в сутки. Здесь — как бот с этим обращается.">
        <Rows>
          <Row title="Дневной лимит откликов" hint="0 — без собственного лимита"><CfgNumber k="daily_apply_limit" min={0} max={500} /></Row>
          <CfgSwitch k="stop_on_hh_limit" title="Остановиться при лимите HH" hint="Бот встаёт на паузу и не перепроверяет до 00:00 МСК. Паузу можно снять вручную." />
          <CfgSwitch k="fresh_vacancies_mode" title="Беречь часть лимита для свежих вакансий" hint="Старые вакансии тратят лимит только до границы «лимит − резерв», свежие идут первыми." />
          <Row off={!fresh} title="Считать вакансию свежей" hint="Не старше указанного числа часов"><CfgNumber k="fresh_vacancy_hours" min={1} max={168} fallback={24} width={72} map={(n) => Math.max(1, n || 24)} /><span className={m.unit}>ч</span></Row>
          <Row off={!fresh} title="Резерв для свежих" hint="Сколько откликов оставить на новые вакансии"><CfgNumber k="fresh_apply_reserve" min={0} max={200} fallback={50} width={72} map={(n) => Math.max(0, n || 0)} /><span className={m.unit}>шт.</span></Row>
        </Rows>
      </Block>
    </Sect>
  );
}

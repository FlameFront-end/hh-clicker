import { useMemo, useState } from 'react';
import { Select } from '@/ui/radix';
import { useApp } from '@/store/app';
import { stripEmoji } from '@/components/Icon';
import { effectiveList } from '@/features/main/panels/searchInfo';
import m from './Settings.module.css';
import { Block, CfgNumber, CfgSelect, CfgSwitch, ChipSet, Field, Row, Rows, Sect, TagInput } from './kit';
import { ResumeRules } from './ResumeRules';
import { confirmDiscardChanges } from '@/lib/unsaved';

const SCHEDULES: [string, string][] = [['remote', 'Удалённая'], ['fullDay', 'Полный день'], ['flexible', 'Гибкий'], ['shift', 'Сменный'], ['flyInFlyOut', 'Вахта']];
const norm = (t: unknown): string => (!t ? '—' : typeof t === 'string' ? t : Array.isArray(t) ? t.map((x) => (x as { string?: string })?.string ?? x).filter(Boolean).join(' ') : (t as { string?: string }).string ?? '—');

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
  return (
    <Block title="Правила для конкретного резюме" desc="Наследование, свои ограничения и отключённый фильтр показаны отдельно.">
      <div className={m.cols2}>
        <Field label="Аккаунт"><Select aria-label="Аккаунт для правил резюме" value={cur ?? ''} onChange={(e) => { if (confirmDiscardChanges()) { setAccIdx(Number(e.target.value)); setHash(''); } }}>{accs.map((a) => <option key={a.idx} value={a.idx}>{stripEmoji(a.name)}</option>)}</Select></Field>
        <Field label="Резюме"><Select aria-label="Резюме для правил" value={curHash} onChange={(e) => { if (confirmDiscardChanges()) setHash(e.target.value); }}>{resumes.map((r) => <option key={r.hash} value={r.hash}>{norm(r.title)}</option>)}</Select></Field>
      </div>
      {acc && curHash && <ResumeRules key={`${cur}:${curHash}`} acc={acc} hash={curHash} />}
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
  const accs = useApp((x) => x.snapshot?.accounts) ?? [];
  const overridden = accs.filter((a) => effectiveList(a, cfg, 'title_include_keywords').source !== 'global' || effectiveList(a, cfg, 'title_exclude_keywords').source !== 'global').map((a) => stripEmoji(a.name));
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

      <Block title="Слова в названии вакансии" desc="Общие для всех профилей. Регистр не важен, поиск по подстроке. Enter или запятая добавляют слово.">
        {overridden.length > 0 && (
          <div className={m.override}>
            <b>Не действуют для: {overridden.join(', ')}</b>
            <span>У этих профилей свои слова. Посмотреть и изменить: Главная → карточка профиля → «Поиск».</span>
          </div>
        )}
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
          <CfgSwitch k="skip_auto_response_vacancies" title="Пропускать вакансии с авто-откликом HH" hint="Массовые вакансии, где HH откликается за соискателя. Нужен доп. запрос на каждую вакансию" />
          <CfgSwitch k="accredited_it_only" title="Только IT-аккредитованные компании" hint="Доп. запрос на каждую вакансию" />
          <CfgSwitch k="prefer_quick_responses" title="Сначала вакансии с быстрым ответом" hint="Поднимает в очереди вакансии, где HR отвечает быстро. Доп. запрос на каждую вакансию" />
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

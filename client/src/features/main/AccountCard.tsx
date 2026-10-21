import { memo, type MouseEvent } from 'react';
import { Icon, stripEmoji } from '@/components/Icon';
import { fmtInt, num } from '@/lib/format';
import { useApp, useT } from '@/store/app';
import { promptDialog } from '@/ui/dialog';
import type { Account } from '@/types/snapshot';
import { Menu, MenuCheck, MenuContent, MenuItem, MenuSep, MenuTrigger, Tip, Toggle } from '@/ui/radix';
import { ago, humanDetail, isLimited, plural, safeHttps, statusOf, untilMskMidnight } from './status';
import { hueOf } from '@/lib/hue';
import { useAccount } from './useAccount';
import s from './AccountCard.module.css';


const cleanName = (name: string) => stripEmoji(name).replace(/\s*\(\s*\)/, '');
const initials = (name: string) => cleanName(name).replace(/\s*\(.*?\)\s*/g, ' ').trim().split(/[\s·]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

/** Клик по карточке открывает детали, если кликнули не по контролу. */
const isControl = (e: MouseEvent) => !!(e.target as HTMLElement).closest('button, a, input, select, textarea, [role="switch"], [role="menu"]');

function AccountCardImpl({ acc, onOpen }: { acc: Account; onOpen: () => void }) {
  const t = useT();
  const snap = useApp((x) => x.snapshot)!;
  const a = useAccount(acc);
  const cfg = snap.config;
  const setAlias = useApp((x) => x.setAlias);
  const rename = async () => {
    const v = await promptDialog(`Своё название для «${acc.hh_name ?? acc.name}» (пусто — вернуть исходное):`, acc.hh_name ? acc.name : '');
    if (v !== null) setAlias(acc.hh_name ?? acc.name, v);
  };
  const st = statusOf(acc, snap);
  const globalPaused = snap.paused;
  const running = !acc.paused && !globalPaused;
  const hhUsed = num(acc.hh_today_applies);
  const hhLim = num(acc.hh_daily_limit) || 200;
  const pct = Math.min(100, Math.round((hhUsed / hhLim) * 100));
  const prog = acc.status === 'applying' && acc.total_vacancies > 0 ? Math.round((acc.current_vacancy_idx / acc.total_vacancies) * 100) : 0;
  const sentN = num(acc.sent);
  const recentInt = num(acc.hh_interviews_recent ?? acc.hh_interviews);
  const totalInt = num(acc.hh_interviews);
  const lastOk = ago(acc.last_apply_at);
  const lastTry = ago(acc.last_apply_attempt_at);
  const captcha = acc.captcha_url ? safeHttps(acc.captcha_url) : null;
  const minSal = num(acc.min_salary) || num(cfg.min_salary);
  const detail = humanDetail(acc.status_detail);

  const alerts: { tone: 'warn' | 'bad'; text: React.ReactNode }[] = [];
  if (acc.captcha_url) alerts.push({ tone: 'warn', text: <>HH просит пройти капчу{captcha && <> — <a href={captcha} target="_blank" rel="noopener noreferrer">открыть</a></>}, потом включите аккаунт</> });
  if (acc.cookies_expired) alerts.push({ tone: 'bad', text: <>Сессия устарела — обновите куки в настройках</> });
  if (num(acc.consecutive_errors) > 0) alerts.push({ tone: 'warn', text: `${acc.consecutive_errors} ${plural(num(acc.consecutive_errors), 'ошибка', 'ошибки', 'ошибок')} подряд` });
  if (acc.degraded_mode) alerts.push({ tone: 'warn', text: `Работает через запасной API · пропущено ${num(acc.degraded_skipped)}` });
  if (isLimited(acc)) alerts.push({ tone: 'bad', text: <>Лимит на сегодня исчерпан · сброс через {untilMskMidnight()}</> });

  const secondary: { n: number; label: string; hint: string; bad?: boolean }[] = [
    { n: num(acc.tests), label: plural(num(acc.tests), 'тест', 'теста', 'тестов'), hint: 'Вакансии с тестом или опросом, отложенные ботом; это не подтверждение отправленного отклика' },
    { n: num(acc.already_applied), label: 'уже были', hint: 'Пропущены: вы уже откликались на эти вакансии раньше' },
    { n: num(acc.errors), label: plural(num(acc.errors), 'ошибка', 'ошибки', 'ошибок'), hint: 'Отклики, которые не удалось отправить', bad: num(acc.errors) > 0 },
  ];
  if (num(acc.questionnaire_sent) > 0) secondary.splice(1, 0, { n: num(acc.questionnaire_sent), label: plural(num(acc.questionnaire_sent), 'опрос', 'опроса', 'опросов'), hint: 'Вакансии с опросом, заполненным автоматически' });
  if (minSal > 0) secondary.push({ n: num(acc.salary_skipped), label: 'по зарплате', hint: `Пропущены: зарплата ниже ${fmtInt(minSal)} ₽` });

  return (
    <article
      className={`${s.card} ${s['t_' + st.tone]} ${running ? '' : s.off}`}
      style={{ ['--acc' as string]: hueOf(cleanName(acc.hh_name ?? acc.name)) }}
      onClick={(e) => !isControl(e) && onOpen()}
    >
      {prog > 0 && <div className={s.progress} style={{ width: `${prog}%` }} />}

      <header className={s.head}>
        <div className={s.avatar}>{initials(acc.name)}<span className={s.ring} /></div>
        <div className={s.title}>
          <div className={s.name} title={cleanName(acc.name)}>{cleanName(acc.name)}</div>
          <Tip text={st.title}>
            <span className={`${s.status} ${s['s_' + st.tone]}`}><Icon name="dot" size={9} />{st.label}</span>
          </Tip>
        </div>
        <Tip text={globalPaused ? 'Сейчас включена общая пауза — снимите её вверху справа' : running ? 'Поставить этот аккаунт на паузу' : 'Возобновить отклики для этого аккаунта'}>
          <label className={s.power}>
            {globalPaused && <span>Общая пауза</span>}
            <Toggle checked={running} disabled={globalPaused} onChange={a.togglePause} label="Аккаунт включён" />
          </label>
        </Tip>
        <Menu>
          <MenuTrigger asChild><button className={s.iconBtn} aria-label="Ещё действия"><Icon name="ellipsis" size={16} /></button></MenuTrigger>
          <MenuContent>
            <MenuItem icon="panel-right-open" onSelect={onOpen}>Статистика и настройки</MenuItem>
            <MenuItem icon="pencil" onSelect={rename}>Переименовать</MenuItem>
            <MenuSep />
            <MenuItem icon="arrow-up-from-line" onSelect={a.touchNow}>Поднять резюме в поиске</MenuItem>
            <MenuItem icon="message-square" onSelect={a.llmNow}>Ответить HR сейчас</MenuItem>
            <MenuItem icon="eraser" onSelect={a.declineDiscards}>Скрыть отказы из откликов</MenuItem>
            <MenuSep />
            <MenuCheck icon="clock" checked={a.autoTouch} onChange={a.toggleTouch}>Поднимать резюме автоматически</MenuCheck>
            <MenuCheck icon="bot" checked={a.llmOn} onChange={a.toggleLlm}>Отвечать HR через ИИ</MenuCheck>
            <MenuCheck icon="key-round" checked={!!acc.use_oauth} onChange={a.toggleOauth}>Откликаться через API HH</MenuCheck>
            {acc.temp && <MenuSep />}
            {acc.temp && !acc.bot_active && <MenuItem icon="play" onSelect={a.activate}>{t('btn_launch')}</MenuItem>}
            {acc.temp && acc.bot_active && <MenuItem icon="square" onSelect={a.deactivate}>Остановить сессию</MenuItem>}
            <MenuSep />
            <MenuItem icon="trash-2" danger onSelect={a.remove}>Удалить аккаунт</MenuItem>
          </MenuContent>
        </Menu>
      </header>

      <div className={s.hero}>
        <Tip text={`Отправлено за всё время · за текущий запуск ${fmtInt(num(acc.session_sent))}`}>
          <div className={s.big}><b className={`${s.ok} tnum`}>{fmtInt(sentN)}</b><span>{plural(sentN, 'отклик', 'отклика', 'откликов')}</span></div>
        </Tip>
        <Tip text={totalInt > recentInt ? `Свежие приглашения · всего за всё время ${totalInt}` : 'Приглашения на собеседование от работодателей'}>
          <div className={s.big}><b className={`${recentInt > 0 ? s.warn : s.dim} tnum`}>{recentInt}</b><span>{plural(recentInt, 'приглашение', 'приглашения', 'приглашений')}</span></div>
        </Tip>
      </div>

      {secondary.some((x) => x.n > 0) && <div className={s.secondary}>
        {secondary.filter((x) => x.n > 0).map((x) => (
          <Tip key={x.label} text={x.hint}>
            <span className={x.bad ? s.bad : ''}><b className="tnum">{x.n}</b> {x.label}</span>
          </Tip>
        ))}
      </div>}

      <div className={s.quota}>
        <div className={s.quotaTop}>
          <Tip text="HH разрешает ограниченное число откликов в сутки. Сброс в 00:00 по Москве">
            <span className={s.dim}>Лимит HH сегодня</span>
          </Tip>
          <span className="tnum"><b className={hhUsed >= hhLim ? s.bad : hhUsed >= hhLim - 10 ? s.warn : ''}>{hhUsed}</b><span className={s.dim}> / {hhLim}</span></span>
        </div>
        <div className={s.bar}><i className={hhUsed >= hhLim ? s.barBad : ''} style={{ width: `${pct}%` }} /></div>
      </div>

      <div className={s.now}>
        {acc.current_vacancy_title ? (
          <>
            <Icon name="send" size={13} />
            <span className={s.nowText} title={acc.current_vacancy_title}>
              <span className={s.dim}>Откликается: </span>{acc.current_vacancy_title}{acc.current_vacancy_company && <span className={s.dim}> · {acc.current_vacancy_company}</span>}
            </span>
            {prog > 0 && <span className={`${s.dim} tnum`}>{acc.current_vacancy_idx} из {acc.total_vacancies}</span>}
          </>
        ) : (
          <><Icon name={st.icon} size={13} /><span className={s.nowText}>{detail || (running ? 'Готовится к следующему шагу' : 'Не работает — включите переключатель')}</span></>
        )}
      </div>

      {alerts.length > 0 && (
        <div className={s.alerts}>{alerts.map((x, i) => <span key={i} className={`${s.alert} ${s['a_' + x.tone]}`}><Icon name="triangle-alert" size={12} />{x.text}</span>)}</div>
      )}

      <footer className={s.foot}>
        <span className={s.times}>
          {lastOk ? <>Последний отклик <b className={s.okTxt}>{lastOk.ago} назад</b></> : lastTry ? <>Пробовал {lastTry.ago} назад, пока без успеха</> : <>Сегодня откликов ещё не было</>}
        </span>
        <Tip text={acc.use_oauth ? 'Отклики идут через официальный API HH' : 'Отклики идут через веб-сессию (cookies)'}>
          <span className={s.chip}>{acc.use_oauth ? 'API' : 'Web'}</span>
        </Tip>
        {a.llmOn && cfg.llm_enabled && <Tip text="ИИ отвечает на сообщения HR"><span className={s.chip}>ИИ</span></Tip>}
        <button className={s.open} onClick={onOpen}>Детали<Icon name="chevron-right" size={13} /></button>
      </footer>
    </article>
  );
}

export const AccountCard = memo(AccountCardImpl);

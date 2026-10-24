import { memo, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon, stripEmoji } from '@/components/Icon';
import { fmtInt, num } from '@/lib/format';
import { useApp, useT } from '@/store/app';
import { promptDialog } from '@/ui/dialog';
import type { Account } from '@/types/snapshot';
import { Menu, MenuCheck, MenuContent, MenuItem, MenuSep, MenuTrigger, Tip, Toggle } from '@/ui/radix';
import { humanDetail, isLimited, safeHttps, statusOf, untilMskMidnight } from './status';
import { hueOf } from '@/lib/hue';
import { useAccount } from './useAccount';
import s from './AccountCard.module.css';
import { duration, hhQuota, profileActive, relative } from './metrics';
import { mainCopy } from './copy';
import { searchSummary } from './panels/searchInfo';
import { ApplyErrors } from './ApplyErrors';


const cleanName = (name: string) => stripEmoji(name).replace(/\s*\(\s*\)/, '');
const initials = (name: string) => cleanName(name).replace(/\s*\(.*?\)\s*/g, ' ').trim().split(/[\s·]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

/** Клик по карточке открывает детали, если кликнули не по контролу. */
const isControl = (e: MouseEvent) => !!(e.target as HTMLElement).closest('button, a, input, select, textarea, details, [role="switch"], [role="menu"]');

function AccountCardImpl({ acc, onOpen, onSearch, shared = false }: { acc: Account; onOpen: () => void; onSearch?: () => void; shared?: boolean }) {
  const t = useT();
  const snap = useApp((x) => x.snapshot)!;
  const connected = useApp((x) => x.connected);
  const en = useApp((x) => x.lang) === 'en';
  const c = mainCopy(en);
  const a = useAccount(acc);
  const cfg = snap.config;
  const setAlias = useApp((x) => x.setAlias);
  const rename = async () => {
    const v = await promptDialog(en ? `Display name for ${acc.hh_name ?? acc.name} (leave empty to restore):` : `Своё название для «${acc.hh_name ?? acc.name}» (пусто — вернуть исходное):`, acc.hh_name ? acc.name : '');
    if (v !== null) setAlias(acc.hh_name ?? acc.name, v);
  };
  const st = statusOf(acc, snap, undefined, en);
  const globalPaused = snap.paused;
  const running = profileActive(acc) && !acc.paused && !globalPaused;
  const hhUsed = num(acc.hh_today_applies);
  const hhLim = num(acc.hh_daily_limit) || 200;
  const pct = Math.min(100, Math.round((hhUsed / hhLim) * 100));
  const prog = acc.status === 'applying' && acc.total_vacancies > 0 ? Math.round((acc.current_vacancy_idx / acc.total_vacancies) * 100) : 0;
  const sentN = num(acc.sent_today);
  const recentInt = num(acc.hh_interviews_recent ?? acc.hh_interviews);
  const totalInt = num(acc.hh_interviews);
  const lastOk = acc.last_sent_at || acc.last_apply_at;
  const quota = hhQuota([acc]);
  const resume = acc.all_resumes?.find((r) => r.hash === acc.resume_hash);
  const resumeTitle = typeof resume?.title === 'string' ? resume.title : c.noResume;
  const nextAt = acc.next_search_at ? Date.parse(acc.next_search_at) : NaN;
  const summary = acc.cycle_summary;
  const captcha = acc.captcha_url ? safeHttps(acc.captcha_url) : null;
  const detail = humanDetail(acc.status_detail, en);

  const alerts: { tone: 'warn' | 'bad'; text: React.ReactNode }[] = [];
  if (acc.captcha_url || acc.paused_reason === 'captcha') alerts.push({ tone: 'warn', text: captcha ? <a href={captcha} target="_blank" rel="noopener noreferrer">{c.captcha}</a> : c.captcha });
  if (acc.paused_reason === 'review') alerts.push({ tone: 'warn', text: <><a href="https://hh.ru/applicant/negotiations" target="_blank" rel="noopener noreferrer">{c.review}</a>{' '}<Link to="/tests">{en ? 'Record the check result' : 'Указать результат проверки'}</Link></> });
  if (acc.paused_reason === 'auth') alerts.push({ tone: 'bad', text: <button className={s.alertAction} onClick={onOpen}>{c.auth}</button> });
  if (acc.cookies_expired) {
    const mobile = ['mobile', 'oauth'].includes(String(acc.mode || '').toLowerCase());
    // Mobile-профилю веб-куки нужны только для анкет через сайт — это не авария.
    alerts.push(mobile
      ? { tone: 'warn', text: en ? 'Web session expired: website questionnaires are unavailable. API applications remain available.' : 'Веб-куки устарели: анкеты через сайт недоступны. Отклики идут через API' }
      : { tone: 'bad', text: c.auth });
  }
  if (num(acc.consecutive_errors) > 0) alerts.push({ tone: 'warn', text: en ? `Consecutive failures: ${acc.consecutive_errors}. Details are above.` : `Неудачных попыток подряд: ${acc.consecutive_errors}. Подробности — выше.` });
  if (acc.degraded_mode) alerts.push({ tone: 'warn', text: `${en ? 'Using fallback API · skipped' : 'Работает через запасной API · пропущено'} ${num(acc.degraded_skipped)}` });
  if (isLimited(acc)) alerts.push({ tone: 'bad', text: <>{en ? 'Daily allowance reached · resets in' : 'Лимит на сегодня исчерпан · сброс через'} {untilMskMidnight()}</> });

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
          <div className={s.nameRow}>
            <span className={s.name} title={cleanName(acc.name)}>{cleanName(acc.name)}</span>
            {shared && <Tip text={c.shared}><span className={s.shared}><Icon name="users" size={11} /></span></Tip>}
          </div>
          <div className={s.subRow}>
            <Tip text={st.title}>
              <span className={`${s.status} ${s['s_' + st.tone]}`}><Icon name="dot" size={9} />{st.label}</span>
            </Tip>
            <span className={s.resumeTitle} title={`${c.resume}: ${resumeTitle}`}>{resumeTitle}</span>
          </div>
        </div>
        <Tip text={!connected ? c.noConnection : globalPaused ? c.globalPauseHint : running ? c.disable : c.enable}>
          <label className={s.power}>
            <Toggle checked={running} disabled={!connected || globalPaused || !profileActive(acc)} onChange={a.togglePause} label={c.enabled + ': ' + cleanName(acc.name)} />
          </label>
        </Tip>
        <Menu>
          <MenuTrigger asChild><button disabled={!connected} className={s.iconBtn} aria-label={c.more + ': ' + cleanName(acc.name)}><Icon name="ellipsis" size={16} /></button></MenuTrigger>
          <MenuContent>
            <MenuItem icon="play" disabled={!connected || !acc.can_run_now || a.runNowBusy} onSelect={() => void a.runNow()}>
              <span>{a.runNowBusy ? c.running : c.run}{!acc.can_run_now && <small className={s.menuReason}>{c.runBlocked}</small>}</span>
            </MenuItem>
            <MenuSep />
            <MenuItem icon="panel-right-open" onSelect={onOpen}>{c.detailsSettings}</MenuItem>
            <MenuItem icon="pencil" onSelect={rename}>{c.rename}</MenuItem>
            <MenuSep />
            <MenuItem icon="arrow-up-from-line" disabled={!running || !a.autoTouch} onSelect={a.touchNow}>{c.touch}</MenuItem>
            <MenuItem icon="message-square" disabled={!running || !a.llmOn || !cfg.llm_enabled} onSelect={a.llmNow}>{c.llm}</MenuItem>
            <MenuItem icon="eraser" onSelect={a.declineDiscards}>{en ? 'Hide rejected applications' : 'Скрыть отказы из откликов'}</MenuItem>
            <MenuSep />
            <MenuCheck icon="clock" checked={a.autoTouch} onChange={a.toggleTouch}>{en ? 'Bump resume automatically' : 'Поднимать резюме автоматически'}</MenuCheck>
            <MenuCheck icon="bot" disabled={!cfg.llm_enabled} checked={!!cfg.llm_enabled && a.llmOn} onChange={a.toggleLlm}>{!cfg.llm_enabled ? (en ? 'AI disabled globally' : 'ИИ выключен в общих настройках') : cfg.llm_auto_send ? (en ? 'AI auto-replies' : 'ИИ: автоматические ответы') : (en ? 'AI drafts only' : 'ИИ: только черновики')}</MenuCheck>
            <MenuCheck icon="key-round" disabled={!!cfg.use_oauth_apply} checked={!!cfg.use_oauth_apply || !!acc.use_oauth} onChange={a.toggleOauth}>{cfg.use_oauth_apply ? (en ? 'HH API enabled globally' : 'API HH включён общей настройкой') : (en ? 'Use HH API for applications' : 'Откликаться через API HH')}</MenuCheck>
            {acc.temp && <MenuSep />}
            {acc.temp && !acc.bot_active && <MenuItem icon="play" onSelect={a.activate}>{t('btn_launch')}</MenuItem>}
            {acc.temp && acc.bot_active && <MenuItem icon="square" onSelect={a.deactivate}>{en ? 'Stop session' : 'Остановить сессию'}</MenuItem>}
            <MenuSep />
            <MenuItem icon="trash-2" danger onSelect={a.remove}>{en ? 'Delete profile' : 'Удалить профиль'}</MenuItem>
          </MenuContent>
        </Menu>
      </header>

      <div className={s.metrics}>
        <Tip text={`${c.todaySub} · ${fmtInt(num(acc.sent))} ${c.total}`}>
          <div className={s.metric}>
            <span className={s.mLabel}>{c.todayProfile}</span>
            <b className={`${sentN > 0 ? s.ok : ''} tnum`}>{fmtInt(sentN)}</b>
            <small>{fmtInt(num(acc.sent))} {c.totalShort}</small>
          </div>
        </Tip>
        <Tip text={acc.hh_stats_checked_at ? `${c.invitationsSub} · ${c.totalInv.toLowerCase()}: ${totalInt}` : c.syncingStats}>
          <div className={s.metric}>
            <span className={s.mLabel}>{c.invitationsShort}</span>
            <b className={`${recentInt > 0 ? s.warn : ''} tnum`}>{acc.hh_stats_checked_at ? recentInt : '—'}</b>
            <small>{acc.hh_stats_checked_at ? c.days60 : globalPaused ? c.pausedShort : c.loadingShort}</small>
          </div>
        </Tip>
        <Tip text={`${c.quotaHint}${shared ? ' · ' + c.shared.toLowerCase() : ''}${quota.complete ? ' · ' + c.updated.toLowerCase() + ' ' + relative(acc.hh_today_applies_updated, en) : ''}`}>
          <div className={s.metric}>
            <span className={s.mLabel}>{c.quotaShort}</span>
            <b className="tnum">{quota.complete ? <><span className={hhUsed >= hhLim ? s.bad : hhUsed >= hhLim - 10 ? s.warn : ''}>{hhUsed}</span><span className={s.of}>/{hhLim}</span></> : '—'}</b>
            <div className={s.bar}><i className={hhUsed >= hhLim ? s.barBad : ''} style={{ width: `${quota.complete ? pct : 0}%` }} /></div>
          </div>
        </Tip>
      </div>

      <button type="button" className={s.search} onClick={onSearch ?? onOpen} title="Как этот профиль ищет вакансии — открыть и настроить">
        <Icon name="search" size={13} />
        <span className={s.searchLabel}>{en ? 'Search' : 'Поиск'}</span>
        <span className={s.searchText}>{searchSummary(acc, cfg)}</span>
        <Icon name="chevron-right" size={13} />
      </button>

      <div className={s.now}>
        {acc.current_vacancy_title && running ? (
          <>
            <Icon name="send" size={13} />
            <span className={s.nowText} title={acc.current_vacancy_title}>
              {acc.current_vacancy_title}{acc.current_vacancy_company && <span className={s.dim}> · {acc.current_vacancy_company}</span>}
            </span>
            {prog > 0 && <span className={`${s.dim} tnum`}>{acc.current_vacancy_idx}/{acc.total_vacancies}</span>}
          </>
        ) : (
          <><Icon name={st.icon} size={13} /><span className={s.nowText}>{!profileActive(acc) ? c.inactive : globalPaused ? c.globalPause : acc.paused ? st.label : acc.status === 'waiting' && Number.isFinite(nextAt) ? (nextAt > Date.now() ? c.next + ' ' + duration((nextAt - Date.now()) / 1000, en) : c.starting) : detail || st.label}</span></>
        )}
        {summary && typeof summary.eligible === 'number' && (
          <Tip text={<span className={s.cycleTip}>
            <b>{c.cycle}{acc.last_search_at ? ' · ' + relative(acc.last_search_at, en) : ''}</b>
            <span>{c.found}: {summary.found}</span><span>{c.eligible}: {summary.eligible}</span>
            <span>{c.skipped}: {summary.already}</span><span>{c.tests}: {summary.tests}</span><span>{c.filtered}: {summary.filtered}</span>
          </span>}>
            <span className={s.cycleChip} tabIndex={0}>{summary.eligible} {c.newShort}</span>
          </Tip>
        )}
      </div>

      {(num(acc.unique_tests) > 0 || num(acc.unique_already) > 0 || num(acc.errors) > 0) && <div className={s.secondary}>
        <Tip text={c.unique}><span className={s.secLabel}>{c.thisRun}</span></Tip>
        {num(acc.unique_tests) > 0 && <span><b>{fmtInt(num(acc.unique_tests))}</b> {c.testsShort}</span>}
        {num(acc.unique_already) > 0 && <span><b>{fmtInt(num(acc.unique_already))}</b> {c.alreadyShort}</span>}
        {num(acc.errors) > 0 && <ApplyErrors acc={acc} en={en} />}
      </div>}

      {alerts.length > 0 && (
        <div className={s.alerts}>{alerts.map((x, i) => <span key={i} className={`${s.alert} ${s['a_' + x.tone]}`}><Icon name="triangle-alert" size={12} /><span className={s.alertText}>{x.text}</span></span>)}</div>
      )}

      <footer className={s.foot}>
        <span className={s.times}>
          {lastOk ? <>{c.lastSent} <b>{relative(lastOk, en)}</b></> : c.noSent}
        </span>
        <Tip text={acc.effective_oauth ? c.useApi : c.useWeb}>
          <span className={s.chip}>{acc.effective_oauth ? 'API' : 'Web'}</span>
        </Tip>
        {a.llmOn && cfg.llm_enabled && <Tip text={cfg.llm_auto_send ? c.ai : c.drafts}><span className={s.chip}>{cfg.llm_auto_send ? c.ai : c.drafts}</span></Tip>}
        <button className={s.open} onClick={onOpen}>{c.details}<Icon name="chevron-right" size={13} /></button>
      </footer>
    </article>
  );
}

export const AccountCard = memo(AccountCardImpl);

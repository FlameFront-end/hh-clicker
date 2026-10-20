import { memo, useState } from 'react';
import { Emoji, Icon, stripEmoji } from '@/components/Icon';
import { post, del } from '@/lib/api';
import { fmtInt, num } from '@/lib/format';
import { useApp, useT } from '@/store/app';
import type { Account } from '@/types/snapshot';
import { ago, isLimited, safeHttps, statusOf, untilMskMidnight } from './status';
import { useAction } from './useAction';
import styles from './AccountRow.module.css';

function Check({ checked, onChange, children, title }: { checked: boolean; onChange: () => void; children: React.ReactNode; title?: string }) {
  return (
    <label className={styles.check} title={title}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className={styles.box}><Icon name="check" size={11} /></span>
      <span>{children}</span>
    </label>
  );
}

function AccountRowImpl({ acc }: { acc: Account }) {
  const t = useT();
  const snap = useApp((s) => s.snapshot)!;
  const open = useApp((s) => s.expanded.has(acc.idx));
  const toggleExpanded = useApp((s) => s.toggleExpanded);
  const sendCmd = useApp((s) => s.sendCmd);
  const cfg = snap.config;
  const st = statusOf(acc, snap, t);
  const [flags, setFlags] = useState<Record<string, boolean | undefined>>({});
  const touchNow = useAction(() => post(`/api/account/${acc.idx}/resume_touch`));
  const declineD = useAction(async () => {
    const r = await post<{ declined?: number }>(`/api/account/${acc.idx}/decline_discards`);
    return `Отклонено: ${r.declined ?? 0}`;
  });
  const llmNow = useAction(async () => {
    const r = await post<{ started?: boolean; accounts?: number; error?: string }>('/api/llm_run_now');
    if (!r.started) throw new Error(r.error || 'Не запустилось');
    return `Запущено (${r.accounts ?? '?'})`;
  });

  const pct = acc.status === 'applying' && acc.total_vacancies > 0 ? Math.round((acc.current_vacancy_idx / acc.total_vacancies) * 100) : 0;
  const hhUsed = num(acc.hh_today_applies);
  const hhLim = num(acc.hh_daily_limit) || 200;
  const minSal = num(acc.min_salary) || num(cfg.min_salary);
  const recentInt = num(acc.hh_interviews_recent ?? acc.hh_interviews);
  const totalInt = num(acc.hh_interviews);
  const llmOn = acc.llm_enabled !== false;
  const applyTests = flags.apply_tests ?? !!acc.apply_tests;
  const degraded = flags.degraded ?? acc.degraded_fallback_enabled !== false;
  const autoTouch = acc.resume_touch_enabled !== false;
  const countdown = acc.next_resume_touch?.match(/\(([^)]+)\)/)?.[1];
  const attempt = ago(acc.last_apply_attempt_at);
  const sent = ago(acc.last_apply_at);
  const captcha = acc.captcha_url ? safeHttps(acc.captcha_url) : null;
  const globalPaused = snap.paused;
  const limited = isLimited(acc);

  const flip = async (key: 'apply_tests' | 'degraded', path: string, field: string, cur: boolean) => {
    setFlags((f) => ({ ...f, [key]: !cur }));
    try {
      const r = await post<Record<string, unknown> & { ok?: boolean }>(path);
      if (!r.ok) throw new Error('fail');
      setFlags((f) => ({ ...f, [key]: !!r[field] }));
    } catch {
      setFlags((f) => ({ ...f, [key]: cur }));
    }
    setTimeout(() => setFlags((f) => ({ ...f, [key]: undefined })), 2000);
  };

  const onDelete = async () => {
    if (!confirm(`Удалить ${acc.temp ? 'сессию ' + acc.name : 'аккаунт #' + acc.idx}? Действие необратимо.`)) return;
    try {
      await del(acc.temp ? `/api/session/${acc.idx}` : `/api/account/${acc.idx}/delete`);
    } catch (e) {
      alert('Ошибка: ' + (e instanceof Error ? e.message : e));
    }
  };

  // LLM-плашка
  let llmChip = '';
  let llmTone: 'ok' | 'bad' | 'dim' | 'accent' = 'dim';
  if (!cfg.llm_enabled) { llmChip = 'LLM выкл (глобально)'; llmTone = 'bad'; }
  else if (!llmOn) { llmChip = 'LLM выкл (для акка)'; }
  else if (acc.llm_status) { llmChip = acc.llm_status; llmTone = acc.llm_status.startsWith('✅') ? 'ok' : acc.llm_status.startsWith('💤') ? 'dim' : 'accent'; }
  else llmChip = 'ожидание первого цикла';
  const llmOff = !cfg.llm_enabled || !llmOn;

  return (
    <article className={`${styles.row} ${open ? styles.open : ''}`} style={{ ['--acc' as string]: `var(--c-${acc.color || 'accent'}, var(--accent))` }}>
      {pct > 0 && <div className={styles.progress} style={{ width: `${pct}%` }} />}

      <div className={styles.top}>
        <button className={styles.chev} onClick={() => toggleExpanded(acc.idx)} aria-expanded={open} title="Свернуть/развернуть">
          <Icon name="chevron-down" size={16} />
        </button>
        <div className={styles.name} title={acc.name}>{stripEmoji(acc.name).replace(/\s*\(\s*\)/, '')}</div>
        <span className={`${styles.status} ${styles['s_' + st.tone]}`} title={st.title}>
          <Icon name="dot" size={9} />{st.label}
        </span>
        <button
          className={`${styles.pill} ${acc.use_oauth ? styles.pillOk : ''}`}
          title="Метод откликов: OAuth API или Web cookies"
          onClick={() => sendCmd({ type: 'account_oauth', idx: acc.idx })}
        >
          <Icon name={acc.use_oauth ? 'key-round' : 'globe'} size={11} />{acc.use_oauth ? 'API' : 'Web'}
        </button>

        <div className={styles.stats}>
          <div className={styles.stat} title="Сессия / всего / HH сегодня">
            <b className={`${styles.ok} tnum`}>{fmtInt(num(acc.sent))}</b><i>{t('stat_replies')}</i>
            <small className="tnum">/{fmtInt(num(acc.total_applied))}{acc.daily_limit > 0 ? ` · ${acc.daily_sent || 0}/${acc.daily_limit}` : acc.daily_sent ? ` · ${acc.daily_sent}` : ''}</small>
            {acc.hh_today_applies_updated && (
              <small className={hhUsed >= hhLim ? styles.badTxt : hhUsed >= hhLim - 10 ? styles.warnTxt : ''}>HH {hhUsed}/{hhLim}</small>
            )}
          </div>
          <div className={styles.stat}><b className="tnum">{num(acc.tests)}</b><i>{t('stat_tests')}</i></div>
          {num(acc.questionnaire_sent) > 0 && <div className={styles.stat}><b className="tnum">{num(acc.questionnaire_sent)}</b><i>{t('stat_surveys')}</i></div>}
          <div className={styles.stat}><b className="tnum">{num(acc.already_applied)}</b><i>{t('stat_already')}</i></div>
          <div className={styles.stat}><b className={`tnum ${num(acc.errors) > 0 ? styles.badTxt : ''}`}>{num(acc.errors)}</b><i>{t('stat_errors')}</i></div>
          {minSal > 0 && <div className={styles.stat}><b className="tnum">{num(acc.salary_skipped)}</b><i>{t('stat_salary')}</i></div>}
          {totalInt > 0 && (
            <div className={styles.stat}><b className={`tnum ${styles.warnTxt}`}>{recentInt}</b><i>{t('stat_interviews')}</i>{totalInt > recentInt && <small>всего {totalInt}</small>}</div>
          )}
        </div>
      </div>

      <div className={styles.now}>
        {acc.current_vacancy_title ? (
          <span className={styles.vac}>
            <Icon name="briefcase" size={12} /> {acc.current_vacancy_title}
            {acc.current_vacancy_company && <span className={styles.dim}> · {acc.current_vacancy_company}</span>}
            {pct > 0 && <span className={styles.dim}> · {acc.current_vacancy_idx}/{acc.total_vacancies}</span>}
          </span>
        ) : (
          <span className={styles.dim}>{t('card_waiting')}</span>
        )}
        {(attempt || sent) && (
          <span className={styles.dim}>
            {attempt && <>попытка <b>{attempt.time}</b> · {attempt.ago} назад</>}
            {attempt && sent && ' · '}
            {sent && <>удачный <b className={styles.okTxt}>{sent.time}</b> · {sent.ago} назад</>}
          </span>
        )}
        {limited && <span className={styles.badTxt}>лимит HH · сбросится через <b>{untilMskMidnight()}</b> (00:00 МСК)</span>}
        {acc.found_vacancies > 0 && <span className={styles.dim}>найдено {acc.found_vacancies}</span>}
      </div>

      {(captcha || acc.cookies_expired || num(acc.consecutive_errors) > 0 || acc.degraded_mode) && (
        <div className={styles.alerts}>
          {acc.captcha_url && (
            <div className={`${styles.alert} ${styles.warnA}`}>
              <Icon name="triangle-alert" size={14} /> HH остановил отклики: требуется проверка.
              {captcha ? <a href={captcha} target="_blank" rel="noopener noreferrer">Открыть проверку</a> : <span> (ссылка отклонена: не hh.ru)</span>}
              <span className={styles.dim}> После проверки сними паузу профиля.</span>
            </div>
          )}
          {acc.cookies_expired && <div className={`${styles.alert} ${styles.badA}`}><Icon name="cookie" size={14} /> {t('cookies_expired_badge')}</div>}
          {num(acc.consecutive_errors) > 0 && <div className={`${styles.alert} ${styles.warnA}`}><Icon name="triangle-alert" size={14} /> Ошибок подряд: {acc.consecutive_errors}</div>}
          {acc.degraded_mode && <div className={`${styles.alert} ${styles.warnA}`}><Icon name="shield" size={14} /> Деградированный режим · пропущено {num(acc.degraded_skipped)}</div>}
        </div>
      )}

      {open && (
        <div className={styles.details}>
          <div className={styles.cols}>
            <div className={styles.col}>
              <h4>Активность</h4>
              <div className={styles.kv}>
                <span>Интервью</span><b>{num(acc.hh_interviews)}</b>
                <span>Просмотрено</span><b>{num(acc.hh_viewed)}</b>
                <span>Не просмотрено</span><b>{num(acc.hh_not_viewed)}</b>
                <span>Отказов</span><b>{num(acc.hh_discards)}</b>
                <span>Не прочитано работодателем</span><b>{num(acc.hh_unread_by_employer)}</b>
              </div>
              {acc.hh_stats_updated && <div className={styles.dim}>обновлено {acc.hh_stats_updated}</div>}

              <div className={`${styles.llm} ${styles['l_' + llmTone]}`}>
                <Icon name="bot" size={13} /><span className={styles.llmChip}><Emoji text={llmChip} size={12} /></span>
                <i>всего</i><b className="tnum">{fmtInt(num(acc.llm_replied_count))}</b>
                {!llmOff && <><i>в очереди</i><b className={num(acc.llm_pending_chats) > 0 ? styles.warnTxt : ''}>{num(acc.llm_pending_chats)}</b></>}
              </div>

              {num(acc.resume_views_7d) > 0 && (
                <div className={styles.resume}>
                  <span><Icon name="eye" size={12} /> {num(acc.resume_views_7d)} просм. <b className={styles.accTxt}>+{num(acc.resume_views_new)}</b></span>
                  <span><Icon name="search" size={12} /> {num(acc.resume_shows_7d)} показов</span>
                  <span><Icon name="mailbox" size={12} tone="ok" /> {num(acc.resume_invitations_7d)} приглаш.</span>
                  <span className={styles.dim}>
                    {num(acc.resume_next_touch_seconds) > 0
                      ? `подъём через ${Math.floor(num(acc.resume_next_touch_seconds) / 3600) > 0 ? Math.floor(num(acc.resume_next_touch_seconds) / 3600) + 'ч ' : ''}${Math.floor((num(acc.resume_next_touch_seconds) % 3600) / 60)}м`
                      : `${num(acc.resume_free_touches)} подъёмов доступно`}
                  </span>
                </div>
              )}

              {acc.acc_event_log?.length > 0 && (
                <div className={styles.events}>
                  {acc.acc_event_log.map((e, i) => (
                    <div key={i} className={styles.ev}>
                      <span className={styles.dim}>{e.time}</span>
                      <Emoji text={e.icon} size={12} />
                      <div>
                        <div>{e.title}{e.company && <span className={styles.dim}> @ {e.company}</span>}</div>
                        {e.extra && <div className={styles.dim}>{e.extra}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {acc.action_history?.length > 0 && <div className={styles.hist}>{acc.action_history.slice(-5).join('  |  ')}</div>}
            </div>

            <div className={styles.col}>
              <h4>Настройки</h4>
              <Check checked={applyTests} onChange={() => flip('apply_tests', `/api/account/${acc.idx}/apply_tests`, 'apply_tests', applyTests)}>
                {t('card_apply_tests')}
              </Check>
              <Check
                checked={degraded}
                onChange={() => flip('degraded', `/api/account/${acc.idx}/degraded_fallback`, 'degraded_fallback_enabled', degraded)}
                title="При протухших cookies продолжать откликаться через OAuth API"
              >
                OAuth-fallback при протухших cookies
              </Check>
              <div className={styles.dim} style={{ marginTop: 10 }}>
                Сопроводительное письмо, автоотклик HH Pro, радар, автопоиски и прочие секции переносятся на React — пока в <a href="/">старом интерфейсе</a>.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={`${styles.btn} ${acc.paused || globalPaused ? styles.btnWarn : ''}`}
          disabled={globalPaused}
          title={globalPaused ? 'Снимите глобальную паузу в правом верхнем углу' : ''}
          onClick={() => sendCmd({ type: 'account_pause', idx: acc.idx })}
        >
          <Icon name={acc.paused || globalPaused ? 'play' : 'pause'} size={13} />
          {globalPaused ? t('btn_acc_global_pause') : acc.paused ? t('btn_acc_resume') : t('btn_acc_pause')}
        </button>

        <button
          className={`${styles.toggle} ${autoTouch ? styles.on : ''}`}
          title="Авто-подъём резюме вкл/выкл"
          onClick={() => void post(`/api/account/${acc.idx}/resume_touch_toggle`)}
        >
          <span className={styles.knob} />
          Авто-подъём{autoTouch ? (countdown ? ` · через ${countdown}` : ' · вкл') : countdown ? ` · выкл (было через ${countdown})` : ' · выкл'}
        </button>
        <button className={styles.btn} disabled={touchNow.busy} onClick={touchNow.run} title="Поднять резюме прямо сейчас">
          <Icon name="arrow-up-from-line" size={13} />{touchNow.busy ? 'поднимаю…' : touchNow.error ? 'ошибка' : 'Сейчас'}
        </button>
        <button className={styles.btn} disabled={declineD.busy} onClick={declineD.run}>
          <Icon name="eraser" size={13} />{declineD.msg ?? declineD.error ?? t('btn_clear_discards')}
        </button>
        <button className={`${styles.btn} ${llmOn ? styles.btnOk : ''}`} onClick={() => sendCmd({ type: 'account_llm', idx: acc.idx })} title="LLM авто-ответы на сообщения HR">
          <Icon name="message-square" size={13} />Ответы {llmOn ? 'вкл' : 'выкл'}
        </button>
        <button className={styles.btn} disabled={llmNow.busy} onClick={llmNow.run} title="Проверить чаты и ответить прямо сейчас">
          <Icon name="refresh-cw" size={13} />{llmNow.msg ?? llmNow.error ?? 'Проверить'}
        </button>
        {acc.temp && !acc.bot_active && <button className={`${styles.btn} ${styles.btnOk}`} onClick={() => void post(`/api/session/${acc.idx}/activate`)}><Icon name="play" size={13} />{t('btn_launch')}</button>}
        {acc.temp && acc.bot_active && <button className={`${styles.btn} ${styles.btnWarn}`} onClick={() => void post(`/api/session/${acc.idx}/deactivate`)}><Icon name="square" size={13} />Стоп</button>}
        <span className={styles.grow} />
        <button className={`${styles.btn} ${styles.btnDanger}`} onClick={onDelete} title="Удалить"><Icon name="trash-2" size={13} /></button>
      </div>
    </article>
  );
}

export const AccountRow = memo(AccountRowImpl);

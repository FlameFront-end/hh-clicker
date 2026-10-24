import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useApp, useT } from '@/store/app';
import { fmtUptime, num } from '@/lib/format';
import { useHeaderData } from './useHeaderData';
import styles from './Header.module.css';

const TARGET: Record<string, string> = { PREVIOUS_EMPLOYER: 'прошлый работодатель', CURRENT_EMPLOYER: 'текущий работодатель' };

export function Header() {
  const t = useT();
  const snap = useApp((s) => s.snapshot);
  const connected = useApp((s) => s.connected);
  const lang = useApp((s) => s.lang);
  const toggleLang = useApp((s) => s.toggleLang);
  const sendCmd = useApp((s) => s.sendCmd);
  const { counters, reviews } = useHeaderData();
  const [popup, setPopup] = useState(false);

  const accs = snap?.accounts ?? [];
  const cfg = snap?.config;
  const gs = snap?.global_stats;
  const totalDaily = snap?.dashboard?.today;
  const limit = num(cfg?.daily_apply_limit);
  const stopped = accs.some((a) => a.hard_stopped);
  const pausedAccs = accs.filter((a) => a.paused).length;
  const oauthCount = accs.filter((a) => a.effective_oauth ?? a.use_oauth).length;
  const globalOAuth = !!cfg?.use_oauth_apply;
  const oauthOn = oauthCount > 0 || globalOAuth;

  const views = accs.reduce((s, a) => s + num(a.resume_views_new), 0);
  const inv = accs.reduce((s, a) => s + num(a.resume_invitations_new), 0);
  const viewsNew = Math.max(views, num(counters?.new_resume_views));
  const inboxChats = num(counters?.unread_chats);
  const inboxNeg = num(counters?.unread_negotiations);

  return (
    <header className={styles.header}>
      <span className={`${styles.conn} ${connected ? styles.on : ''}`} title={`${connected ? 'Подключено' : 'Нет связи'} · работает ${fmtUptime(snap?.uptime_seconds ?? 0)}`} />
      <span className={styles.title}>HH Bot</span>

      <div className={styles.stats}>
        <span title={t('hdr_replies')}><Icon name="check" size={13} tone="ok" /> <b className="tnum">{gs?.total_sent ?? 0}</b> {t('hdr_replies')}
          {totalDaily !== undefined && <em className={stopped ? styles.bad : styles.dim} title={limit > 0 ? `Ваш лимит: ${limit} в день на каждый профиль` : 'Подтверждённые отправки в истории · сутки по Москве'}> · {lang === 'en' ? 'today' : 'сегодня'} {totalDaily}</em>}
        </span>
      </div>

      {(inboxChats + inboxNeg + viewsNew + inv > 0) && (
        <div className={`${styles.stats} ${styles.hh}`} title="Новое на HH по всем аккаунтам">
          {inboxChats > 0 && <span title="Непрочитанные чаты"><Icon name="message-square" size={13} /> <b className="tnum">{inboxChats}</b></span>}
          {(inboxNeg + inv) > 0 && <span title="Новые приглашения и отклики работодателей"><Icon name="mailbox" size={13} tone="ok" /> <b className="tnum">{Math.max(inboxNeg, inv)}</b></span>}
          {viewsNew > 0 && <span title="Новые просмотры резюме"><Icon name="eye" size={13} /> <b className="tnum">{viewsNew}</b></span>}
        </div>
      )}

      <span className={styles.spacer} />

      {reviews.total > 0 && (
        <span className={styles.reviewsWrap}>
          <button className={`${styles.badge} ${styles.warnBadge}`} onClick={() => setPopup((v) => !v)}>
            <Icon name="star" size={12} /> Оценить: {reviews.total}
          </button>
          {popup && (
            <div className={styles.popup}>
              {reviews.groups.map((g) => (
                <div key={g.name}>
                  <div className={styles.popupHead}>{g.name}</div>
                  {g.items.map((it, i) => (
                    <div key={i} className={styles.popupItem}>
                      <b>{it.employer_name}</b>
                      {it.position && <span> · {it.position}</span>}
                      {it.target && <span className={styles.dim}> · {TARGET[it.target] ?? it.target}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </span>
      )}

      <span
        className={`${styles.badge} ${oauthOn ? styles.okBadge : styles.accentBadge}`}
        title={lang === 'en' ? 'Effective application transport. Configure it in profile details.' : 'Фактический способ отправки. Настраивается в деталях профиля.'}
      >
        <Icon name={oauthOn ? 'key-round' : 'globe'} size={12} />
        {oauthOn ? `API ${oauthCount}/${accs.length}` : 'Web'}
      </span>

      <button className={styles.btn} onClick={toggleLang} title="Язык / Language">{lang === 'ru' ? 'RU' : 'EN'}</button>
      <button
        className={`${styles.btn} ${snap?.paused ? styles.paused : ''}`}
        disabled={!connected}
        aria-label={snap?.paused ? (lang === 'en' ? 'Resume all profiles' : 'Возобновить все профили') : (lang === 'en' ? 'Pause all profiles' : 'Поставить все профили на паузу')}
        onClick={() => sendCmd({ type: 'pause_toggle' })}
      >
        <Icon name={snap?.paused ? 'play' : 'pause'} size={13} />
        {snap?.paused ? t('btn_resume') : pausedAccs ? `${t('btn_pause')} (${pausedAccs})` : t('btn_pause')}
      </button>
    </header>
  );
}

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
  const totalDaily = accs.reduce((s, a) => s + num(a.daily_sent), 0);
  const limit = num(cfg?.daily_apply_limit);
  const stopped = accs.some((a) => a.hard_stopped);
  const pausedAccs = accs.filter((a) => a.paused).length;
  const oauthCount = accs.filter((a) => a.use_oauth).length;
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
      <h1 className={styles.title}>HH Bot</h1>

      <div className={styles.stats}>
        <span title={t('hdr_replies')}><Icon name="check" size={13} tone="ok" /> <b className="tnum">{gs?.total_sent ?? 0}</b> {t('hdr_replies')}
          {limit > 0 && <em className={totalDaily >= limit ? styles.bad : styles.dim}> · сегодня {totalDaily}/{limit}</em>}
          {limit <= 0 && totalDaily > 0 && <em className={stopped ? styles.bad : styles.dim}> · сегодня {totalDaily}</em>}
        </span>
        <span title={`${t('hdr_in_db')} · с тестом: ${gs?.storage_tests ?? 0}`}><Icon name="database" size={13} /> <b className="tnum">{gs?.storage_total ?? 0}</b> {t('hdr_in_db')}</span>
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

      <button
        className={`${styles.badge} ${oauthOn ? styles.okBadge : styles.accentBadge}`}
        title="Переключить глобальный режим откликов (OAuth/Web)"
        onClick={() => sendCmd({ type: 'set_config', key: 'use_oauth_apply', value: !globalOAuth })}
      >
        <Icon name={oauthOn ? 'key-round' : 'globe'} size={12} />
        {oauthOn ? (globalOAuth ? 'OAuth (все)' : `OAuth (${oauthCount}/${accs.length})`) : 'Web'}
      </button>

      <button className={styles.btn} onClick={toggleLang} title="Язык / Language">{lang === 'ru' ? 'RU' : 'EN'}</button>
      <button
        className={`${styles.btn} ${snap?.paused ? styles.paused : ''}`}
        onClick={() => sendCmd({ type: 'pause_toggle' })}
      >
        <Icon name={snap?.paused ? 'play' : 'pause'} size={13} />
        {snap?.paused ? t('btn_resume') : pausedAccs ? `${t('btn_pause')} (${pausedAccs})` : t('btn_pause')}
      </button>
    </header>
  );
}

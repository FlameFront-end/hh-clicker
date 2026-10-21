import { Icon, stripEmoji } from '@/components/Icon';
import { useApp, useT } from '@/store/app';
import { num } from '@/lib/format';
import { plural } from '@/features/main/status';
import { Avatar, Empty, PageHead } from '@/ui/Kit';
import s from '@/ui/Ui.module.css';
import styles from './HhTab.module.css';

export function HhTab() {
  const t = useT();
  const accs = (useApp((x) => x.snapshot?.accounts) ?? []).filter((a) => !a.temp || a.bot_active);
  return (
    <div className={s.page}>
      <PageHead title="Статус на HH" sub="Что происходит с вашими откликами на самом hh.ru: просмотры, приглашения, отказы." />
      {accs.length === 0 && <Empty icon="target" title="Нет аккаунтов" hint="Добавьте аккаунт в настройках, чтобы увидеть статистику HH." />}
      <div className={styles.grid}>
        {accs.map((a) => {
          const name = stripEmoji(a.name).replace(/\s*\(\s*\)/, '');
          const inv = num(a.hh_interviews), viewed = num(a.hh_viewed), notViewed = num(a.hh_not_viewed), disc = num(a.hh_discards), unread = num(a.hh_unread_by_employer);
          const total = viewed + notViewed + disc;
          const pct = (n: number) => (total ? `${(n / total) * 100}%` : '0%');
          const loaded = !!a.hh_stats_updated;
          return (
            <section key={a.idx} className={styles.card}>
              <header className={styles.top}>
                <Avatar name={name} size={30} />
                <div className={styles.who}>
                  <b>{name}</b>
                  <span>{loaded ? `Данные обновлены ${a.hh_stats_updated}` : a.hh_stats_loading ? t('hh_loading') : t('hh_no_data')}</span>
                </div>
              </header>
              {loaded && (
                <>
                  <div className={styles.hero}>
                    <div className={`${styles.big} ${inv ? styles.ok : ''}`}><b className="tnum">{inv}</b><span>{plural(inv, 'приглашение', 'приглашения', 'приглашений')} на собеседование</span></div>
                    {unread > 0 && <div className={styles.alert}><Icon name="mail" size={13} />{unread} {plural(unread, 'сообщение', 'сообщения', 'сообщений')} от HR не прочитано</div>}
                  </div>
                  {total > 0 && (
                    <>
                      <div className={styles.bar} aria-hidden>
                        <i style={{ width: pct(viewed), background: 'var(--warn)' }} />
                        <i style={{ width: pct(notViewed), background: 'var(--border-hi)' }} />
                        <i style={{ width: pct(disc), background: 'var(--bad)' }} />
                      </div>
                      <div className={styles.legend}>
                        <span><i style={{ background: 'var(--warn)' }} />Просмотрено <b className="tnum">{viewed}</b></span>
                        <span><i style={{ background: 'var(--border-hi)' }} />Не просмотрено <b className="tnum">{notViewed}</b></span>
                        <span><i style={{ background: 'var(--bad)' }} />Отказы <b className="tnum">{disc}</b></span>
                      </div>
                    </>
                  )}
                  {a.hh_interviews_list?.length > 0 && (
                    <div className={styles.sec}>
                      <h4>{t('hh_inv_list')}</h4>
                      {a.hh_interviews_list.map((i, n) => (
                        <div key={n} className={styles.item}>
                          {i.date && <span className={styles.date}>{i.date}</span>}
                          {i.neg_id ? <a href={`https://hh.ru/applicant/negotiations/${encodeURIComponent(i.neg_id)}`} target="_blank" rel="noopener noreferrer">{i.text}<Icon name="arrow-up-right" size={12} /></a> : <span>{i.text}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {Array.isArray(a.hh_possible_offers) && a.hh_possible_offers.length > 0 && (
                    <div className={styles.sec}>
                      <h4>{t('hh_offers')}</h4>
                      {(a.hh_possible_offers as { name?: string; vacancyNames?: string[] }[]).map((o, n) => (
                        <div key={n} className={styles.item}><b>{o.name}</b><span className={s.dim}>{(o.vacancyNames ?? []).slice(0, 3).join(', ')}</span></div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

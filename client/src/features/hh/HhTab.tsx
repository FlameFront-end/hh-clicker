import { stripEmoji } from '@/components/Icon';
import { useApp, useT } from '@/store/app';
import { num } from '@/lib/format';
import { colorVar } from '@/lib/safe';
import s from '@/ui/Ui.module.css';
import styles from './HhTab.module.css';

export function HhTab() {
  const t = useT();
  const accs = (useApp((x) => x.snapshot?.accounts) ?? []).filter((a) => !a.temp || a.bot_active);
  return (
    <div className={s.page}>
      {accs.map((a) => (
        <section key={a.idx} className={styles.block}>
          <h3 className={styles.name} style={{ color: colorVar(a.color || '') }}>{stripEmoji(a.name)}</h3>
          {a.hh_stats_loading && !a.hh_stats_updated ? <div className={s.dim}>{t('hh_loading')}</div>
            : !a.hh_stats_updated ? <div className={s.dim}>{t('hh_no_data')}</div>
            : (
              <>
                <div className={styles.counters}>
                  <C v={num(a.hh_interviews)} l={t('hh_interviews')} c={s.ok} />
                  <C v={num(a.hh_viewed)} l={t('hh_viewed')} c={s.warn} />
                  <C v={num(a.hh_discards)} l={t('hh_discards')} c={s.bad} />
                  <C v={num(a.hh_not_viewed)} l={t('hh_not_viewed')} c={s.dim} />
                  {num(a.hh_unread_by_employer) > 0 && <C v={num(a.hh_unread_by_employer)} l="HR не чит." c={s.accent} />}
                </div>
                <div className={s.dim} style={{ fontSize: 11, margin: '8px 0 12px' }}>{t('hh_updated')} {a.hh_stats_updated}</div>
                {a.hh_interviews_list?.length > 0 && (
                  <>
                    <h4 className={styles.sub}>{t('hh_inv_list')}</h4>
                    {a.hh_interviews_list.map((i, n) => (
                      <div key={n} className={styles.item}>
                        {i.date && <span className={styles.date}>{i.date}</span>}
                        {i.neg_id ? <a href={`https://hh.ru/applicant/negotiations/${encodeURIComponent(i.neg_id)}`} target="_blank" rel="noopener noreferrer">{i.text}</a> : <span>{i.text}</span>}
                      </div>
                    ))}
                  </>
                )}
                {Array.isArray(a.hh_possible_offers) && a.hh_possible_offers.length > 0 && (
                  <>
                    <h4 className={styles.sub}>{t('hh_offers')}</h4>
                    {(a.hh_possible_offers as { name?: string; vacancyNames?: string[] }[]).map((o, n) => (
                      <div key={n} className={styles.item}><b>{o.name}</b><span className={s.dim}>{(o.vacancyNames ?? []).slice(0, 3).join(', ')}</span></div>
                    ))}
                  </>
                )}
              </>
            )}
        </section>
      ))}
    </div>
  );
}

function C({ v, l, c }: { v: number; l: string; c: string }) {
  return <div className={styles.counter}><div className={`${styles.val} ${c} tnum`}>{v}</div><div className={styles.lbl}>{l}</div></div>;
}

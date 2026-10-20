import { Emoji, Icon, stripEmoji } from '@/components/Icon';
import { useApp, useT } from '@/store/app';
import type { RecentResponse } from '@/types/snapshot';
import styles from './Recent.module.css';

function Chips({ r }: { r: RecentResponse }) {
  const er = r.employer_rating;
  return (
    <span className={styles.chips}>
      {r.hr_online && <span className={styles.chip} title="HR онлайн"><Icon name="dot" size={10} tone="ok" /> онлайн</span>}
      {r.accept_auto === false && <span className={styles.chip} title="Не принимает автоотклики"><Icon name="ban" size={11} tone="warn" /> без авто</span>}
      {er && er.rating > 0 && <span className={styles.chip} title={`${er.reviews_count} отзывов · ${er.recommendations_percent}% рекомендуют`}><Icon name="star" size={11} tone="warn" /> {er.rating.toFixed(1)}</span>}
    </span>
  );
}

export function Recent() {
  const t = useT();
  const list = useApp((s) => s.snapshot?.recent_responses) ?? [];
  return (
    <section className={styles.card}>
      <h3 className={styles.title}>{t('sidebar_recent')}</h3>
      <div className={styles.list}>
        {list.length === 0 && <div className={styles.none}>Пока пусто</div>}
        {list.slice(0, 40).map((r, i) => (
          <div key={`${r.id}-${i}`} className={styles.item}>
            <div className={styles.row1}>
              <span className={styles.time}>{r.time}</span>
              <span className={styles.acc}>{stripEmoji(r.acc)}</span>
              <span className={styles.res}><Emoji text={r.icon} size={12} /></span>
            </div>
            <div className={styles.vac} title={r.title}>{r.title}</div>
            <div className={styles.meta}>{r.company}{r.salary ? ` · ${r.salary}` : ''}</div>
            <Chips r={r} />
          </div>
        ))}
      </div>
    </section>
  );
}

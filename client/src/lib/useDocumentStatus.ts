import { useEffect, useRef } from 'react';
import { useApp, useT } from '@/store/app';

/** Заголовок вкладки по состоянию бота + браузерные уведомления (приглашения, лимит, протухшие куки). */
export function useDocumentStatus() {
  const snap = useApp((s) => s.snapshot);
  const t = useT();
  const prev = useRef<{ inited: boolean; inv: Record<number, number>; limit: Record<number, boolean>; cookies: Record<number, boolean> }>({ inited: false, inv: {}, limit: {}, cookies: {} });

  useEffect(() => {
    const id = window.setTimeout(() => { if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission(); }, 3000);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!snap) return;
    const accs = snap.accounts ?? [];
    const sent = snap.global_stats?.total_sent ?? 0;
    document.title = accs.some((a) => a.status === 'limit') ? t('title_limit')
      : snap.paused ? t('title_paused')
      : sent > 0 ? `✅ ${sent} откл. | HH Bot` : 'HH Bot Dashboard';

    const p = prev.current;
    const notify = 'Notification' in window && Notification.permission === 'granted';
    const send = (title: string, body: string) => { if (!notify) return; try { new Notification(title, { body, icon: '/favicon.ico' }); } catch { /* нет прав */ } };
    for (const a of accs) {
      const inv = a.hh_interviews ?? 0;
      const was = p.inv[a.idx] ?? inv;
      if (p.inited && inv > was) send(`${t('notif_new_inv')}${a.short}`, `${t('notif_inv_count_pre')} ${inv} ${t('notif_inv_count_mid')}${inv - was})`);
      p.inv[a.idx] = inv;
      const isLimit = a.status === 'limit';
      if (p.inited && isLimit && !p.limit[a.idx]) send(`${t('notif_limit')}${a.short}`, t('notif_limit_body'));
      p.limit[a.idx] = isLimit;
      const exp = !!a.cookies_expired;
      if (p.inited && exp && !p.cookies[a.idx]) send(`${t('notif_cookies')}${a.short}`, t('notif_cookies_body'));
      p.cookies[a.idx] = exp;
    }
    p.inited = true;
  }, [snap, t]);
}

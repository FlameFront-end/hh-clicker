import { useEffect, useRef, useState } from 'react';
import { get } from '@/lib/api';
import { useApp } from '@/store/app';

export interface Counters { unread_chats: number; unread_negotiations: number; new_resume_views: number; new_notifications: number }
export interface ReviewGroup { name: string; items: { employer_name?: string; position?: string; target?: string }[] }

const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);

/** Суммарные счётчики HH (не чаще раза в 60 с) и список работодателей для оценки (один раз). */
export function useHeaderData() {
  const snapshot = useApp((s) => s.snapshot);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [reviews, setReviews] = useState<{ total: number; groups: ReviewGroup[] }>({ total: 0, groups: [] });
  const last = useRef(0);
  const busy = useRef(false);
  const reviewsDone = useRef(false);
  const accs = snapshot?.accounts;

  useEffect(() => {
    if (!accs?.length || busy.current || Date.now() - last.current < 60_000) return;
    busy.current = true;
    last.current = Date.now();
    void Promise.allSettled(accs.map((a) => get<{ ok?: boolean; counters?: Record<string, unknown> }>(`/api/account/${a.idx}/counters_v2`)))
      .then((res) => {
        const sum: Counters = { unread_chats: 0, unread_negotiations: 0, new_resume_views: 0, new_notifications: 0 };
        let any = false;
        for (const r of res) {
          if (r.status !== 'fulfilled' || !r.value?.ok || !r.value.counters) continue;
          any = true;
          for (const k of Object.keys(sum) as (keyof Counters)[]) sum[k] += n(r.value.counters[k]);
        }
        if (any) setCounters(sum);
      })
      .finally(() => { busy.current = false; });
  }, [accs]);

  useEffect(() => {
    if (!accs?.length || reviewsDone.current) return;
    reviewsDone.current = true;
    void (async () => {
      let total = 0;
      const groups: ReviewGroup[] = [];
      for (const a of accs) {
        try {
          const d = await get<{ ok?: boolean; count?: number; items?: ReviewGroup['items'] }>(`/api/account/${a.idx}/reviews_to_rate`);
          if (d?.ok && Number(d.count) > 0) {
            total += Number(d.count);
            groups.push({ name: a.name || a.short || `Аккаунт ${a.idx + 1}`, items: d.items ?? [] });
          }
        } catch { /* тихо */ }
      }
      setReviews({ total, groups });
    })();
  }, [accs]);

  return { counters, reviews };
}

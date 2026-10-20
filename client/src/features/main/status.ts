import type { Account, Snapshot } from '@/types/snapshot';
import type { IconName } from '@/components/icons';
import { num } from '@/lib/format';

export type Tone = 'idle' | 'run' | 'bad' | 'warn';
export interface StatusView { label: string; tone: Tone; icon: IconName; title?: string }

const MAP: Record<string, [IconName, string, Tone]> = {
  idle: ['pause', 'status_idle', 'idle'],
  collecting: ['inbox', 'status_collecting', 'run'],
  applying: ['send', 'status_applying', 'run'],
  limit: ['ban', 'status_limit', 'bad'],
  waiting: ['hourglass', 'status_waiting', 'warn'],
  checking: ['search', 'status_checking', 'run'],
  '—': ['circle', 'status_inactive', 'idle'],
};

export function statusOf(acc: Account, snap: Snapshot, t: (k: string) => string): StatusView {
  if (snap.paused) return { label: t('status_all_paused'), tone: 'idle', icon: 'pause' };
  if (acc.paused) {
    const hhUsed = num(acc.hh_today_applies);
    const hhLimit = num(acc.hh_daily_limit) || 200;
    if (acc.hard_stopped && hhUsed >= hhLimit)
      return { label: `HH-лимит ${hhUsed}/${hhLimit}`, tone: 'bad', icon: 'octagon-x', title: `Счётчик из HH (обновлено ${acc.hh_today_applies_updated || '—'})` };
    if (acc.hard_stopped && acc.daily_limit > 0 && acc.daily_sent >= acc.daily_limit)
      return { label: `${t('status_daily_limit')} ${acc.daily_sent}/${acc.daily_limit}`, tone: 'bad', icon: 'octagon-x', title: t('status_daily_limit_hint') };
    if (acc.limit_exceeded)
      return { label: t('status_hh_limit'), tone: 'bad', icon: 'ban', title: acc.status_detail || t('status_hh_limit_hint') };
    return { label: t('status_acc_paused'), tone: 'idle', icon: 'pause' };
  }
  const m = MAP[acc.status];
  return { label: m ? t(m[1]) : String(acc.status).toUpperCase(), tone: m?.[2] ?? 'idle', icon: m?.[0] ?? 'circle-help', title: acc.status_detail || undefined };
}

export function ago(iso: string): { time: string; ago: string } | null {
  if (!iso) return null;
  const ts = new Date(iso);
  if (isNaN(ts.getTime())) return null;
  const d = Math.max(0, Math.floor((Date.now() - ts.getTime()) / 1000));
  const a = d < 60 ? `${d}с` : d < 3600 ? `${Math.floor(d / 60)}м` : d < 86400 ? `${Math.floor(d / 3600)}ч ${Math.floor((d % 3600) / 60)}м` : `${Math.floor(d / 86400)}д`;
  return { time: ts.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }), ago: a };
}

/** Через сколько сбросится лимит HH — до 00:00 МСК. */
export function untilMskMidnight(): string {
  const msk = new Date(Date.now() + 3 * 3600_000);
  const next = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + 1);
  const min = Math.max(0, Math.floor((next - msk.getTime()) / 60000));
  return `${Math.floor(min / 60)}ч ${min % 60}м`;
}

export function isLimited(a: Account): boolean {
  return a.paused_reason === 'limit' || !!a.hard_stopped || (a.daily_limit > 0 && a.daily_sent >= a.daily_limit);
}

export function safeHttps(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'hh.ru' || u.hostname.endsWith('.hh.ru')) ? u.href : null;
  } catch {
    return null;
  }
}

import type { Account } from '@/types/snapshot';

export function applyErrorReason(reason: string | undefined, en = false): string {
  const reasons: Record<string, string> = en ? {
    transport_error: 'Network request failed; submission was not confirmed.',
    questionnaire_unconfirmed: 'HH did not confirm the questionnaire submission. Check the application on HH before continuing.',
    submission_unconfirmed: 'HH did not confirm the application submission.',
  } : {
    transport_error: 'Ошибка сетевого запроса: отправка не подтверждена.',
    questionnaire_unconfirmed: 'HH не подтвердил отправку анкеты. Перед продолжением проверьте отклик на HH.',
    submission_unconfirmed: 'HH не подтвердил отправку отклика.',
  };
  return reasons[reason || ''] || (en ? 'Details of this older failure were not retained. Check the application on HH before retrying.' : 'Подробности этой старой ошибки не сохранены. Перед повторной отправкой проверьте отклик на HH.');
}

export function applyErrorCount(count: number, en = false): string {
  if (en) return `${count} submission ${count === 1 ? 'error' : 'errors'}`;
  const word = count % 10 === 1 && count % 100 !== 11 ? 'ошибка' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'ошибки' : 'ошибок';
  return `${count} ${word} отправки`;
}

export function parseStamp(raw?: string): number | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}[T ]/.test(raw)) return null;
  const ts = Date.parse(raw.replace(' ', 'T'));
  return Number.isFinite(ts) ? ts : null;
}

export function mskDay(ts: number): string {
  return new Date(ts + 3 * 3600_000).toISOString().slice(0, 10);
}

export function duration(seconds: number, en = false): string {
  const n = Math.max(0, Math.ceil(seconds));
  if (n < 60) return `${n}${en ? 's' : 'с'}`;
  if (n < 3600) return `${Math.floor(n / 60)}${en ? 'm' : 'м'} ${n % 60}${en ? 's' : 'с'}`;
  if (n < 86400) return `${Math.floor(n / 3600)}${en ? 'h' : 'ч'} ${Math.floor(n % 3600 / 60)}${en ? 'm' : 'м'}`;
  return `${Math.floor(n / 86400)}${en ? 'd' : 'д'}`;
}

export function relative(raw: string | undefined, en = false, now = Date.now()): string {
  const ts = parseStamp(raw);
  if (ts === null) return '—';
  return `${duration((now - ts) / 1000, en)} ${en ? 'ago' : 'назад'}`;
}

export function eventTime(raw: string, en = false): string {
  const ts = parseStamp(raw);
  if (ts === null) return en ? 'Date unknown' : 'Дата неизвестна';
  return new Date(ts).toLocaleString(en ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Missing, previous-day or >10-minute-old HH counts are unknown, not zero. */
export function hhQuota(accounts: Account[], now = Date.now()) {
  const groups = new Map<string, { used: number; limit: number; updated: number | null; profiles: number }>();
  for (const a of accounts) {
    if (a.temp && !a.bot_active) continue;
    const key = a.hh_user_id || `unknown:${a.idx}`;
    const prev = groups.get(key);
    const ts = parseStamp(a.hh_today_applies_updated);
    const valid = ts !== null && ts <= now + 60_000 && now - ts < 600_000 && mskDay(ts) === mskDay(now);
    const incoming = { used: Math.max(0, Number(a.hh_today_applies) || 0), limit: Number(a.hh_daily_limit) || 200, updated: valid ? ts : null, profiles: (prev?.profiles ?? 0) + 1 };
    if (prev?.updated != null && (incoming.updated === null || prev.updated > incoming.updated)) {
      groups.set(key, { ...prev, profiles: incoming.profiles });
    } else groups.set(key, incoming);
  }
  const values = [...groups.values()];
  const known = values.filter((g) => g.updated !== null);
  return { used: known.reduce((n, g) => n + g.used, 0), limit: values.reduce((n, g) => n + g.limit, 0),
    complete: values.length > 0 && known.length === values.length, known: known.length, users: values.length,
    shared: values.some((g) => g.profiles > 1), unidentified: accounts.some((a) => !(a.temp && !a.bot_active) && !a.hh_user_id),
    updated: known.length ? new Date(Math.min(...known.map((g) => g.updated!))).toISOString() : '' };
}

export function needsAttention(a: Account): boolean {
  return ['captcha', 'auth', 'review', 'auto_errors'].includes(a.paused_reason) || a.status === 'error';
}

export function profileActive(a: Account): boolean {
  return !(a.temp && !a.bot_active);
}

export function invitationTotals(accounts: Account[]) {
  const groups = new Map<string, { recent: number; total: number; stamp: number }>();
  for (const a of accounts) {
    const stamp = parseStamp(a.hh_stats_checked_at);
    if (stamp === null) continue;
    const key = a.hh_user_id || 'profile:' + a.idx;
    if ((groups.get(key)?.stamp ?? -Infinity) > stamp) continue;
    groups.set(key, { recent: Number(a.hh_interviews_recent) || 0, total: Number(a.hh_interviews) || 0, stamp });
  }
  return { recent: [...groups.values()].reduce((n, v) => n + v.recent, 0),
    total: [...groups.values()].reduce((n, v) => n + v.total, 0), known: groups.size,
    updated: groups.size ? new Date(Math.min(...[...groups.values()].map((v) => v.stamp))).toISOString() : '' };
}

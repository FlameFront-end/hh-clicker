import type { Account, Snapshot } from '@/types/snapshot';
import type { IconName } from '@/components/icons';
import { num } from '@/lib/format';

export type Tone = 'idle' | 'run' | 'bad' | 'warn';
export interface StatusView { label: string; tone: Tone; icon: IconName; title?: string }

/** Человеческие подписи статусов (sentence case) + пояснение в подсказке. */
const MAP: Record<string, [IconName, string, Tone, string]> = {
  idle: ['pause', 'Ждёт запуска', 'idle', 'Бот ещё не начал цикл для этого аккаунта'],
  collecting: ['search', 'Ищет вакансии', 'run', 'Проходит по URL поиска и собирает подходящие вакансии'],
  applying: ['send', 'Откликается', 'run', 'Отправляет отклики на собранные вакансии'],
  limit: ['ban', 'Упёрся в лимит', 'bad', 'HH ограничил отклики — бот подождёт сброса'],
  waiting: ['hourglass', 'Перерыв между циклами', 'idle', 'Круг закончен, бот ждёт и начнёт новый поиск сам'],
  checking: ['search', 'Проверяет лимит', 'run', 'Проверяет, снял ли HH ограничение'],
  '—': ['circle', 'Не активен', 'idle', ''],
};

export function statusOf(acc: Account, snap: Snapshot, _t?: (k: string) => string): StatusView {
  if (snap.paused) return { label: 'Всё на паузе', tone: 'idle', icon: 'pause', title: 'Включена общая пауза (кнопка вверху справа)' };
  if (acc.paused) {
    const hhUsed = num(acc.hh_today_applies);
    const hhLimit = num(acc.hh_daily_limit) || 200;
    if (acc.hard_stopped && hhUsed >= hhLimit)
      return { label: `Лимит HH: ${hhUsed} из ${hhLimit}`, tone: 'bad', icon: 'octagon-x', title: `Сбросится в 00:00 МСК · счётчик обновлён ${acc.hh_today_applies_updated || '—'}` };
    if (acc.hard_stopped && acc.daily_limit > 0 && acc.daily_sent >= acc.daily_limit)
      return { label: `Дневной лимит: ${acc.daily_sent} из ${acc.daily_limit}`, tone: 'bad', icon: 'octagon-x', title: 'Ваш лимит откликов на день исчерпан. Сбросится завтра в 00:00' };
    if (acc.limit_exceeded)
      return { label: 'HH ограничил отклики', tone: 'bad', icon: 'ban', title: acc.status_detail || 'Бот проверит снятие лимита автоматически' };
    return { label: 'На паузе', tone: 'idle', icon: 'pause', title: 'Включите переключатель, чтобы бот продолжил' };
  }
  const m = MAP[acc.status];
  return { label: m ? m[1] : String(acc.status), tone: m?.[2] ?? 'idle', icon: m?.[0] ?? 'circle-help', title: m?.[3] || undefined };
}

/** Понятная строка «что сейчас происходит» из технического status_detail. */
export function humanDetail(detail: string | undefined | null): string {
  const d = (detail || '').trim();
  if (!d) return '';
  let m = d.match(/^OAuth-сбор\s+(\d+)\s*\/\s*(\d+)/i);
  if (m) return `Собрано ${m[1]} из ${m[2]} вакансий`;
  m = d.match(/^(?:Web-)?сбор\s+(\d+)\s*\/\s*(\d+)/i);
  if (m) return `Собрано ${m[1]} из ${m[2]} вакансий`;
  if (/^нет новых вакансий/i.test(d)) return 'Новых вакансий нет — проверит снова в следующем круге';
  return d;
}

/** «5 откликов», «1 отклик», «2 отклика». */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
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

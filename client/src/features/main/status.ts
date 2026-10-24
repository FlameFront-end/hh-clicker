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
  error: ['triangle-alert', 'Ошибка — нужен журнал', 'bad', 'Откройте журнал, чтобы узнать причину и время повторной попытки'],
  '—': ['circle', 'Не активен', 'idle', ''],
};

function statusRu(acc: Account, snap: Snapshot): StatusView {
  if (snap.paused) return { label: 'Всё на паузе', tone: 'idle', icon: 'pause', title: 'Включена общая пауза (кнопка вверху справа)' };
  if (acc.temp && !acc.bot_active) return { label: 'Сессия остановлена', tone: 'idle', icon: 'square', title: 'Запустите сессию через меню профиля' };
  if (acc.paused) {
    const hhUsed = num(acc.hh_today_applies);
    const hhLimit = num(acc.hh_daily_limit) || 200;
    if (acc.hard_stopped && hhUsed >= hhLimit)
      return { label: `Лимит HH: ${hhUsed} из ${hhLimit}`, tone: 'bad', icon: 'octagon-x', title: `Сбросится в 00:00 МСК · счётчик обновлён ${acc.hh_today_applies_updated || '—'}` };
    if (acc.hard_stopped && acc.daily_limit > 0 && acc.daily_sent >= acc.daily_limit)
      return { label: `Дневной лимит: ${acc.daily_sent} из ${acc.daily_limit}`, tone: 'bad', icon: 'octagon-x', title: 'Ваш лимит откликов на день исчерпан. Сбросится завтра в 00:00' };
    if (acc.limit_exceeded)
      return { label: 'HH ограничил отклики', tone: 'bad', icon: 'ban', title: acc.status_detail || 'Бот проверит снятие лимита автоматически' };
    if (acc.paused_reason === 'review')
      return { label: 'Проверьте отклик', tone: 'warn', icon: 'clipboard-list', title: 'HH не подтвердил отправку. Проверьте отклик на HH; если его нет, разрешите повтор во вкладке «Тесты», затем включите профиль' };
    if (acc.paused_reason === 'captcha')
      return { label: 'Нужна проверка HH', tone: 'warn', icon: 'shield', title: 'HH попросил пройти капчу. Пройдите её по ссылке в карточке и включите профиль' };
    if (acc.paused_reason === 'auth')
      return { label: 'Нужен вход в HH', tone: 'bad', icon: 'key-round', title: 'Сессия HH устарела. Обновите куки или войдите заново' };
    if (acc.paused_reason === 'auto_errors')
      return { label: 'Пауза после ошибок', tone: 'warn', icon: 'triangle-alert', title: 'Несколько ошибок отправки подряд. Посмотрите журнал и включите профиль' };
    return { label: 'На паузе', tone: 'idle', icon: 'pause', title: 'Включите переключатель, чтобы бот продолжил' };
  }
  const m = MAP[acc.status];
  return { label: m ? m[1] : String(acc.status), tone: m?.[2] ?? 'idle', icon: m?.[0] ?? 'circle-help', title: m?.[3] || undefined };
}

export function statusOf(acc: Account, snap: Snapshot, _t?: (k: string) => string, en = false): StatusView {
  const base = statusRu(acc, snap);
  if (!en) return base;
  const labels: Record<string, string> = { idle: 'Ready', collecting: 'Searching vacancies', applying: 'Sending applications', waiting: 'Between search cycles', checking: 'Checking HH allowance', limit: 'HH restriction', error: 'Error — check the log', '—': 'Inactive' };
  const reasons: Record<string, string> = { captcha: 'HH verification required', auth: 'Sign in to HH', review: 'Review application on HH', auto_errors: 'Paused after send errors', limit: 'Daily allowance reached', manual: 'Paused' };
  return { ...base, label: snap.paused ? 'All applications paused' : acc.temp && !acc.bot_active ? 'Session stopped' : acc.paused ? (reasons[acc.paused_reason] || 'Paused') : (labels[acc.status] || acc.status), title: undefined };
}

/** Понятная строка «что сейчас происходит» из технического status_detail. */
export function humanDetail(detail: string | undefined | null, en = false): string {
  const d = (detail || '').trim();
  if (!d) return '';
  if (en) {
    const query = d.match(/^Поисковые запросы:\s*(\d+)\s*из\s*(\d+)/i);
    if (query) return `Search queries: ${query[1]} of ${query[2]}`;
    const progress = d.match(/^(?:OAuth-сбор|Web-сбор|Загрузка)\s+(\d+)\s*\/\s*(\d+)/i);
    if (progress) return `Search progress: ${progress[1]} of ${progress[2]}`;
    if (/^нет новых вакансий/i.test(d)) return 'No new matching vacancies';
    if (/^цикл завершён/i.test(d)) return 'Search cycle completed';
  }
  let m = d.match(/^OAuth-сбор\s+(\d+)\s*\/\s*(\d+)/i);
  if (m) return `Страницы поиска: ${m[1]} из ${m[2]}`;
  m = d.match(/^(?:Web-)?сбор\s+(\d+)\s*\/\s*(\d+)/i);
  if (m) return `Страницы поиска: ${m[1]} из ${m[2]}`;
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

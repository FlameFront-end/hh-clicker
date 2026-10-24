import type { Account, Config } from '@/types/snapshot';

export type FilterKey = 'title_include_keywords' | 'title_exclude_keywords' | 'employer_exclude_keywords';
export type Source = 'resume' | 'profile' | 'global';

/** Какие слова реально применяет бот: правила резюме → свои у профиля → общие из настроек
 *  (тот же порядок, что config.resume_filter_value на сервере). */
export function effectiveList(acc: Account, cfg: Config | undefined, key: FilterKey): { list: string[]; source: Source } {
  const prof = acc.resume_filters?.[acc.resume_hash] as Partial<Record<string, string[]>> | undefined;
  if (prof && key in prof) return { list: prof[key] ?? [], source: 'resume' };
  const own = acc[key];
  if (Array.isArray(own) && (acc.profile_filter_keys ? acc.profile_filter_keys.includes(key) : true)) return { list: own, source: 'profile' };
  const global = (cfg as unknown as Record<string, unknown> | undefined)?.[key];
  return { list: Array.isArray(global) ? (global as string[]) : [], source: 'global' };
}

export const SOURCE_LABEL: Record<Source, string> = {
  resume: 'свои для этого резюме',
  profile: 'свои для профиля',
  global: 'общие из настроек',
};

const SCHED: Record<string, string> = { remote: 'удалёнка', fullDay: 'полный день', flexible: 'гибкий', shift: 'сменный', flyInFlyOut: 'вахта' };
const FMT: Record<string, string> = { REMOTE: 'удалёнка', HYBRID: 'гибрид', ON_SITE: 'офис', FIELD_WORK: 'разъездная' };
export const EXP: Record<string, string> = { noExperience: 'без опыта', between1And3: '1–3 года', between3And6: '3–6 лет', moreThan6: '6+ лет' };

/** Форматы работы, которые пропускает бот (правило резюме или общий фильтр). */
export function workFormats(acc: Account, cfg: Config | undefined): string[] {
  const prof = acc.resume_filters?.[acc.resume_hash];
  if (prof && 'allowed_work_formats' in prof) return (prof.allowed_work_formats ?? []).map((x) => FMT[x] ?? x);
  return ((cfg?.allowed_schedules as string[] | undefined) ?? []).map((x) => SCHED[x] ?? x);
}

export function experience(acc: Account): string[] {
  const prof = acc.resume_filters?.[acc.resume_hash];
  return (prof?.experience ?? []).map((x) => EXP[x] ?? x);
}

export function sourceCount(acc: Account, cfg: Config | undefined): number {
  if (acc.search_source_mode === 'inherit') return (cfg?.url_pool as unknown[] | undefined)?.length ?? 0;
  return acc.search_source_mode === 'selected' ? acc.urls?.length ?? 0 : acc.urls?.length || ((cfg?.url_pool as unknown[] | undefined)?.length ?? 0);
}

/** Короткая строка «как ищет» для карточки профиля. */
export function searchSummary(acc: Account, cfg: Config | undefined): string {
  const n = sourceCount(acc, cfg);
  const parts = [`${n} ${n % 10 === 1 && n % 100 !== 11 ? 'поиск' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'поиска' : 'поисков'}`];
  if (acc.include_saved_searches !== false) parts.push('+ сохранённые HH');
  const fmt = workFormats(acc, cfg);
  if (fmt.length) parts.push(fmt.join(', '));
  const inc = effectiveList(acc, cfg, 'title_include_keywords').list.length;
  const exc = effectiveList(acc, cfg, 'title_exclude_keywords').list.length;
  if (inc || exc) parts.push(`слова: +${inc} / −${exc}`);
  const days = Number(cfg?.search_period_days) || 0;
  if (days > 0) parts.push(`за ${days} дн.`);
  return parts.join(' · ');
}

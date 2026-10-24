// Типы WebSocket-снимка (`type: "state_update"`), снятые с реального сервера.
// Поля, которых нет в этом списке, но которые бэкенд может прислать, доступны через индексную сигнатуру.

export type AccountStatus = 'idle' | 'collecting' | 'applying' | 'limit' | 'waiting' | 'checking' | '—' | string;

export interface ResumeRef { hash: string; title: unknown }

export interface ResumeFilters {
  title_include_keywords: string[];
  title_exclude_keywords: string[];
  employer_exclude_keywords: string[];
  experience: string[];
  allowed_work_formats: string[];
}

export interface AccEvent {
  time: string;
  icon: string;
  type: string;
  title: string;
  company: string;
  extra: string;
}

export interface HhInterview { neg_id: string; date: string; text: string; recent: boolean }

export interface Account {
  idx: number;
  name: string;
  /** Оригинальное имя с HH, если аккаунт переименован пользователем. */
  hh_name?: string;
  hh_short?: string;
  short: string;
  color: string;
  temp: boolean;
  bot_active: boolean;
  resume_hash: string;
  all_resumes: ResumeRef[];
  resume_filters: Record<string, ResumeFilters>;
  title_include_keywords: string[];
  title_exclude_keywords: string[];
  employer_exclude_keywords: string[];
  experience: unknown[];
  letter: string;
  urls: string[];
  search_source_mode?: 'selected' | 'inherit';
  include_saved_searches?: boolean;
  active_search_urls?: string[];
  profile_filter_keys?: string[];
  url_pages: Record<string, number>;
  url_stats: Record<string, number>;
  status: AccountStatus;
  status_detail: string;
  can_run_now?: boolean;
  sent_today?: number;
  last_sent_at?: string;
  unique_tests?: number;
  unique_already?: number;
  next_search_at?: string;
  last_search_at?: string;
  hh_stats_checked_at?: string;
  cycle_summary?: { found: number; eligible: number; already: number; tests: number; filtered: number };
  effective_oauth?: boolean;
  /** Профили одного пользователя HH делят дневной лимит. */
  hh_user_id?: string;
  sent: number;
  total_applied: number;
  tests: number;
  errors: number;
  already_applied: number;
  found_vacancies: number;
  current_vacancy_title: string;
  current_vacancy_company: string;
  current_vacancy_idx: number;
  total_vacancies: number;
  salary_skipped: number;
  questionnaire_sent: number;
  limit_exceeded: boolean;
  paused: boolean;
  paused_reason: string;
  next_resume_touch: string;
  resume_touch_status: string;
  resume_touch_enabled: boolean;
  hh_interviews: number;
  hh_interviews_recent: number;
  hh_viewed: number;
  hh_discards: number;
  hh_not_viewed: number;
  hh_unread_by_employer: number;
  hh_stats_updated: string;
  hh_stats_loading: boolean;
  hh_interviews_list: HhInterview[];
  hh_possible_offers: unknown[];
  action_history: string[];
  resume_views_7d: number;
  resume_views_new: number;
  resume_shows_7d: number;
  resume_invitations_7d: number;
  resume_invitations_new: number;
  resume_next_touch_seconds: number;
  resume_free_touches: number;
  resume_global_invitations: number;
  resume_new_invitations_total: number;
  acc_event_log: AccEvent[];
  apply_errors?: { time: string; vacancy_id: string; title: string; reason: string; http_status?: number | null; error_code?: string }[];
  apply_tests: boolean;
  safety_enabled: boolean;
  safety_inconsistent_skipped: number;
  safety_misleading_skipped: number;
  safety_redirect_skipped: number;
  safety_last_reason: string;
  consecutive_errors: number;
  cookies_expired: boolean;
  degraded_mode: boolean;
  degraded_skipped: number;
  degraded_fallback_enabled: boolean;
  mode: string;
  resume_status_oauth: {
    status_id: string;
    status_name: string;
    blocked: boolean;
    finished: boolean;
    can_publish_or_update: boolean;
    next_publish_at: string;
    progress: number;
    moderation_note: unknown[];
  };
  hh_today_applies: number;
  hh_today_applies_updated: string;
  hh_daily_limit: number;
  oauth_status: { has_token: boolean; expires_hours: number; has_refresh: boolean };
  llm_enabled: boolean;
  llm_status: string;
  llm_pending_chats: number;
  llm_current_neg_id: string;
  llm_current_employer: string;
  llm_current_idx: number;
  llm_current_total: number;
  llm_last_check_at: string;
  llm_next_check_at: string;
  use_oauth: boolean;
  daily_sent: number;
  daily_limit: number;
  hard_stopped: boolean;
  last_apply_at: string;
  last_apply_attempt_at: string;
  captcha_url: string;
  [extra: string]: unknown;
}

export interface EmployerRating {
  rating: number;
  reviews_count: number;
  recommendations_percent: number;
}

export interface RecentResponse {
  error_detail?: { reason: string; http_status?: number | null; error_code?: string };
  account_name?: string;
  time: string;
  acc: string;
  color: string;
  id: string;
  title: string;
  company: string;
  salary: string;
  result: string;
  icon: string;
  hr_online: string | null;
  chat_write: string | null;
  accept_auto: boolean | null;
  employer_rating: EmployerRating | null;
}

export interface LogEntry { time: string; acc: string; color: string; message: string; level: string }

export interface LetterTemplate { name: string; text: string }
export interface UrlPoolItem { url: string; pages: number }

export interface Config {
  pages_per_url: number;
  response_delay: number;
  pause_between_cycles: number;
  batch_responses: number;
  limit_check_interval: number;
  min_salary: number;
  min_employer_rating?: number;
  min_recommendations_percent?: number;
  auto_pause_errors: number;
  auto_apply_tests: boolean;
  use_oauth_apply: boolean;
  daily_apply_limit: number;
  hh_daily_limit: number;
  fresh_vacancies_mode: boolean;
  fresh_vacancy_hours: number;
  fresh_apply_reserve: number;
  stop_on_hh_limit: boolean;
  llm_check_interval: number;
  allowed_schedules: string[];
  title_include_keywords: string[];
  title_exclude_keywords: string[];
  questionnaire_templates: unknown[];
  questionnaire_default_answer: string;
  letter_templates: LetterTemplate[];
  url_pool: UrlPoolItem[];
  skip_inconsistent: boolean;
  filter_agencies: boolean;
  filter_low_competition: boolean;
  search_period_days: number;
  llm_enabled: boolean;
  llm_auto_send: boolean;
  llm_fill_questionnaire: boolean;
  llm_use_cover_letter: boolean;
  llm_use_resume: boolean;
  llm_use_quick_replies: boolean;
  hh_ai_letter_first_try: boolean;
  related_vacancies_enabled: boolean;
  llm_model: string;
  llm_base_url: string;
  llm_status_summary: { configured_provider: string; reply: Record<string, unknown>; questionnaire: Record<string, unknown> };
  llm_system_prompt: string;
  llm_api_key_set: boolean;
  llm_api_key_fingerprint: string;
  llm_profiles: unknown[];
  llm_profile_mode: string;
  [extra: string]: unknown;
}

export interface GlobalStats {
  total_sent: number;
  total_tests: number;
  total_errors: number;
  total_found: number;
  storage_total: number;
  storage_tests: number;
}

export interface Snapshot {
  type: 'state_update';
  uptime_seconds: number;
  paused: boolean;
  dashboard?: { today: number; last_24h: number; hourly: number[]; day_timezone: string; generated_at: string };
  accounts: Account[];
  recent_responses: RecentResponse[];
  log: LogEntry[];
  llm_log: unknown[];
  config: Config;
  global_stats: GlobalStats;
  vacancy_queues: Record<string, { remaining: number; next: unknown[] }>;
}

/** Команды, которые UI шлёт по WebSocket (`sendCmd`). */
export type WsCommand = { type: string; [k: string]: unknown };

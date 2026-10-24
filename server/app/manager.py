"""
BotManager — core bot logic with per-account worker threads.
"""

import asyncio
import copy
import aiohttp
import json
import random
from datetime import datetime, timedelta
from collections import deque
from pathlib import Path
import time
import threading
import requests
import re
import urllib.parse
from app.hh_http import HH
from app.user_agent import mobile_user_agent, webview_user_agent
try:
    from zoneinfo import ZoneInfo
    _MSK = ZoneInfo("Europe/Moscow")
except Exception:
    _MSK = None  # fallback на local

from app.logging_utils import log_debug, log_exception, _is_login_page
from app.dispatch import MessageSendUncertain
from app.hh_mobile_transport import MobileAPIError


_LEVEL_KEYWORDS = {"senior", "lead", "сеньор", "сениор", "лид", "тимлид", "teamlead", "team lead"}


def _title_allowed(title: str, include: list, exclude: list, experience: list,
                   role_include: list | None = None) -> bool:
    """Profession is mandatory; experience may replace seniority, never the profession."""
    title = title.lower()
    include = [str(k).strip().lower() for k in include if str(k).strip()]
    exclude = [str(k).strip().lower() for k in exclude if str(k).strip()]
    # Explicit exclusions always win, including Fullstack/NestJS titles.
    if any(k in title for k in exclude):
        return False
    roles = [k for k in include if k not in _LEVEL_KEYWORDS]
    levels = [k for k in include if k in _LEVEL_KEYWORDS]
    if not roles and levels:
        # Existing senior profiles store level words per resume and profession
        # words on the account. Both constraints must survive that override.
        roles = [str(k).strip().lower() for k in (role_include or [])
                 if str(k).strip().lower() not in _LEVEL_KEYWORDS and str(k).strip()]
    frontend_markers = ("frontend", "front-end", "front end", "фронтенд", "фронтэнд", "react", "next.js", "nextjs")
    frontend_roles = [k for k in roles if any(marker in k for marker in frontend_markers)]
    if frontend_roles:
        # TS/NestJS alone do not establish a frontend role (pure backend uses
        # them too). Preserve broad stacks without accepting another profession.
        roles = frontend_roles
    if roles and not any(k in title for k in roles):
        return False
    if levels and not any(k in title for k in levels):
        return bool(roles and "moreThan6" in experience)
    return not include or bool(roles or any(k in title for k in levels))


def _experience_ids(value) -> list[str]:
    if isinstance(value, dict):
        value = value.get("id")
    if isinstance(value, str):
        return [value] if value else []
    return []


def _experience_allowed(acc: dict, meta: dict, vid: str, allowed: list) -> bool:
    if not allowed:
        return True
    actual = _experience_ids(meta.get("experience")) or list(meta.get("experience_filters") or [])
    if not actual:
        details = fetch_vacancy_details(acc, vid)
        actual = _experience_ids((details or {}).get("experience"))
        if actual:
            meta["experience"] = actual[0]
    return bool(set(actual).intersection(allowed))


def _apply_context_key(acc: dict) -> str:
    """Only dispatch-affecting settings, not mutable cookies/locks/counters."""
    keys = ("resume_hash", "resume_filters", "urls", "title_include_keywords",
            "title_exclude_keywords", "employer_exclude_keywords", "letter", "apply_tests",
            "search_source_mode", "include_saved_searches")
    global_keys = ("min_salary", "allowed_schedules", "title_include_keywords",
                   "title_exclude_keywords", "employer_exclude_keywords", "auto_apply_tests",
                   "search_period_days", "skip_auto_response_vacancies", "accredited_it_only",
                   "min_employer_rating", "min_recommendations_percent", "min_employer_reviews",
                   "url_pool", "filter_agencies", "filter_low_competition")
    return json.dumps({"account": {k: acc.get(k) for k in keys},
                       "global": {k: getattr(CONFIG, k, None) for k in global_keys}},
                      sort_keys=True, default=str)


def _search_urls(acc: dict) -> list:
    if "_cycle_search_urls" in acc:
        return list(acc["_cycle_search_urls"])
    if acc.get("search_source_mode") == "selected":
        return list(acc.get("urls") or [])
    if acc.get("search_source_mode") == "inherit":
        return [_url_entry(u)["url"] for u in CONFIG.url_pool]
    return list(acc.get("urls") or [_url_entry(u)["url"] for u in CONFIG.url_pool])


def parse_search_url(url: str) -> tuple[str, int | str, dict]:
    """Convert an HH web/API search URL to ``search_vacancies`` arguments."""
    query = urllib.parse.parse_qs(
        urllib.parse.urlparse(url).query, keep_blank_values=False
    )

    def _take(name, default):
        values = query.pop(name, None)
        return values[-1] if values else default

    text = _take("text", "")
    # HH area 113 = вся Россия. Ссылки без явного area (в частности старые
    # автоссылки по resume) не должны молча ограничиваться Москвой (area=1).
    area = _take("area", 113)
    # Pagination is controlled by the collector/mobile client.  These keys are
    # properties of the SSR URL, not vacancy filters.
    for key in ("page", "per_page", "items_on_page", "no_magic", "ored_clusters"):
        query.pop(key, None)
    filters = {
        key: values[0] if len(values) == 1 else values
        for key, values in query.items()
    }
    return text, area, filters


def _without_query_keys(url: str, keys: set[str]) -> str:
    """Remove selected query parameters before adding per-resume overrides."""
    parsed = urllib.parse.urlsplit(url)
    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query = urllib.parse.urlencode(
        [(key, value) for key, value in pairs if key not in keys],
        doseq=True,
    )
    return urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment)
    )


def _merge_vacancy_meta(target: dict, incoming: dict) -> None:
    """Merge page metadata while preserving per-query filter buckets."""
    for vid, meta in (incoming or {}).items():
        current = target.setdefault(vid, {})
        for key, value in (meta or {}).items():
            if key not in ("experience_filters", "work_format_filters"):
                current[key] = value
                continue
            merged = list(current.get(key) or [])
            for bucket in value or []:
                if bucket and bucket not in merged:
                    merged.append(bucket)
            if merged:
                current[key] = merged


def _work_format_ids(value) -> list[str]:
    """Extract normalized HH work-format ids from a vacancy field."""
    if not isinstance(value, list):
        value = [value] if value else []
    result = []
    for item in value:
        raw = item.get("id") if isinstance(item, dict) else item
        if isinstance(raw, str) and raw.strip():
            normalized = raw.strip().upper()
            if normalized not in result:
                result.append(normalized)
    return result


def _mobile_search_filters(filters: dict) -> dict:
    """Add Android-native ordering/period controls to a mobile search.

    The API supports period values 1, 3 and 7 days.  Fresh mode requests the
    newest vacancies from HH before the local page cap is applied; otherwise a
    locally sorted result can still miss the globally newest vacancies.
    """
    result = dict(filters or {})
    if CONFIG.fresh_vacancies_mode:
        result.setdefault("order_by", "publication_time")
    try:
        period = int(CONFIG.search_period_days)
    except (TypeError, ValueError):
        period = 0
    # Mobile API понимает только 1/3/7 дней. Остальные значения (14, 30)
    # применяются локально по дате публикации — см. _too_old_for_period.
    if period in (1, 3, 7):
        result.setdefault("period", period)
    # Те же метки, что и web-поиск: HH принимает одну метку, приоритет у
    # «мало откликов». Раньше mobile-профили эти переключатели игнорировали.
    if "label" not in result:
        if CONFIG.filter_low_competition:
            result["label"] = "low_performance"
        elif CONFIG.filter_agencies:
            result["label"] = "not_from_agency"
    return result


# Грубые курсы для фильтра «мин. зарплата» (как в web-парсере hh_api).
_SALARY_RATES = {
    "RUR": 1, "RUB": 1, "USD": 90, "EUR": 100, "KZT": 0.18, "BYR": 28, "BYN": 28,
    "UZS": 0.007, "UAH": 2.2, "AZN": 53, "GEL": 33, "KGS": 1.05,
}


def _salary_rub(sal) -> int | None:
    """Нижняя граница зарплаты в рублях. None — зарплата не указана или
    валюта неизвестна (такие вакансии фильтр зарплаты не отбрасывает)."""
    if not isinstance(sal, dict):
        return None
    value = sal.get("from") or sal.get("to")
    if not value:
        return None
    rate = _SALARY_RATES.get(str(sal.get("currency") or "RUR").upper())
    if rate is None:
        return None
    try:
        return int(float(value) * rate)
    except (TypeError, ValueError):
        return None


def _too_old_for_period(meta: dict, now: datetime | None = None) -> bool:
    """Локальный фильтр «свежесть N дней». Нужен для mobile-поиска, где сервер
    принимает только 1/3/7 дней. Вакансии без даты не отбрасываем."""
    try:
        days = int(CONFIG.search_period_days)
    except (TypeError, ValueError):
        return False
    if days <= 0:
        return False
    published = _vacancy_published_at(meta)
    if published is None:
        return False
    if now is None:
        now = datetime.now(published.tzinfo) if published.tzinfo else datetime.now()
    return (now - published).total_seconds() > days * 86400


def _salary_too_low(salary_map: dict, vid: str) -> bool:
    """Отбрасываем только вакансии с УКАЗАННОЙ зарплатой ниже порога.
    Раньше без зарплаты = отказ, а это около половины рынка."""
    if CONFIG.min_salary <= 0:
        return False
    sal = salary_map.get(vid)
    return sal is not None and sal < CONFIG.min_salary


def _uses_api_search(acc: dict, state) -> bool:
    """Mobile accounts use APK-native API search; web uses it in degradation."""
    if str(acc.get("mode", "")).strip().lower() in ("mobile", "oauth"):
        return True
    return bool(
        state.cookies_expired
        and acc.get("resume_hash")
        and state.degraded_fallback_enabled
    )


def _server_next_publish_datetime(status: dict) -> datetime | None:
    """Convert HH next_publish_at to the local naive datetime used by AccountState."""
    raw = (status or {}).get("next_publish_at")
    if not raw:
        return None
    try:
        value = str(raw).strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone().replace(tzinfo=None)
        return parsed
    except (TypeError, ValueError):
        return None


def _normalize_touch_result(result) -> tuple[bool, str, datetime | None]:
    """The mobile cooldown response is a dict; normal publish returns a tuple."""
    if not isinstance(result, dict):
        success, message = result
        return success, message, None
    next_at = None
    try:
        if result.get("next_at"):
            next_at = datetime.fromtimestamp(float(result["next_at"]))
    except (TypeError, ValueError, OverflowError, OSError):
        pass
    message = ("Лимит поднятия резюме HH" if result.get("error") == "touch_limit_active"
               else str(result.get("error") or "Не удалось поднять резюме"))
    return bool(result.get("ok")), message, next_at


def _vacancy_published_at(meta: dict) -> datetime | None:
    """Parse an HH ISO timestamp without assuming the server timezone."""
    raw = (meta or {}).get("published_at") or (meta or {}).get("created_at")
    if not raw:
        return None
    try:
        value = str(raw).strip().replace("Z", "+00:00")
        # HH uses ISO-8601 offsets in the compact +0300 form; Python versions
        # before 3.11 require the colon form +03:00.
        if len(value) >= 5 and value[-5] in "+-" and value[-4:].isdigit():
            value = value[:-2] + ":" + value[-2:]
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def _is_fresh_vacancy(meta: dict, hours: int, now: datetime | None = None) -> bool:
    published = _vacancy_published_at(meta)
    if published is None or bool((meta or {}).get("archived")):
        return False
    if now is None:
        now = datetime.now(published.tzinfo) if published.tzinfo else datetime.now()
    elif published.tzinfo and now.tzinfo is None:
        now = now.astimezone(published.tzinfo)
    elif not published.tzinfo and now.tzinfo:
        published = published.replace(tzinfo=now.tzinfo)
    age_seconds = (now - published).total_seconds()
    return 0 <= age_seconds <= max(int(hours), 1) * 3600


def _effective_daily_ceiling() -> int:
    limits = [int(v) for v in (CONFIG.daily_apply_limit, CONFIG.hh_daily_limit)
              if isinstance(v, (int, float)) and int(v) > 0]
    return min(limits) if limits else 200


def _cap_apply_batch(batch, daily_sent, hh_today_applies):
    # The bot's local limit and HH's account-wide limit are independent:
    # ``daily_sent`` counts applications sent by this bot, while
    # ``hh_today_applies`` also includes applications made elsewhere. Do not
    # subtract the HH counter from the bot's smaller local allowance.
    remaining_limits = []
    if CONFIG.daily_apply_limit > 0:
        remaining_limits.append(max(0, int(CONFIG.daily_apply_limit) - int(daily_sent or 0)))
    if CONFIG.hh_daily_limit > 0:
        remaining_limits.append(max(0, int(CONFIG.hh_daily_limit) - int(hh_today_applies or 0)))
    remaining = min(remaining_limits) if remaining_limits else len(batch)
    return batch[:remaining]


def _completed_apply_results(batch, results):
    # Account for every response already received. Persist receipts first,
    # then ambiguous writes, then blockers; only afterwards consider starting
    # a questionnaire (which is a new network write, not result accounting).
    def priority(item):
        result = item[1]
        if isinstance(result, Exception):
            return 1
        if result[0] in ("sent", "already"):
            return 0
        if result[0] == "error" and (result[1] or {}).get("review_required"):
            return 1
        return 3 if result[0] == "test" else 2
    return sorted(zip(batch, results), key=priority)


def _protect_fresh_batch(batch: list, vacancy_meta: dict, *, hours: int,
                         ceiling: int, reserve: int, used: int,
                         now: datetime | None = None) -> tuple[list, int]:
    """Return allowed batch and count of deferred old vacancies."""
    old_slots = max(0, ceiling - min(max(reserve, 0), ceiling) - max(used, 0))
    total_slots = max(0, ceiling - max(used, 0))
    selected, deferred = [], 0
    for vid in batch:
        if total_slots <= 0:
            deferred += 1
        elif _is_fresh_vacancy(vacancy_meta.get(vid, {}) or {}, hours, now):
            selected.append(vid)
            total_slots -= 1
        elif old_slots > 0:
            selected.append(vid)
            old_slots -= 1
            total_slots -= 1
        else:
            deferred += 1
    return selected, deferred


def _today_msk() -> str:
    """Дата по Москве. HH работает в MSK; используем её как «день» бота
    чтобы midnight rollover не зависел от TZ контейнера (Docker = UTC по дефолту).
    """
    if _MSK is not None:
        return datetime.now(_MSK).strftime("%Y-%m-%d")
    return datetime.now().strftime("%Y-%m-%d")


def _fingerprint_key(key: str) -> str:
    """Безопасный fingerprint API-ключа для UI: first4…last4 (N симв.).
    Полный ключ никогда не уходит в snapshot, но юзер видит что именно
    сохранилось (особенно полезно после релоада когда type=password input
    показывает только звёздочки)."""
    if not key:
        return ""
    s = (key or "").strip()
    if len(s) <= 12:
        return f"••• ({len(s)} симв.)"
    return f"{s[:4]}…{s[-4:]} ({len(s)} симв.)"

from app.config import (
    CONFIG, accounts_data,
    save_config, load_config, save_accounts, load_accounts,
    _url_entry, _url_pages_map, hh_base, questionnaire_default_answer,
    normalize_resume_filters, resume_filter_value,
)

from app.storage import (
    _load_cache, get_applied_list, get_dashboard_metrics,
    add_applied, is_applied, add_test_vacancy, is_test, is_review_pending, get_stats,
    load_browser_sessions, save_browser_sessions,
    upsert_interview, get_no_chat_neg_ids, get_replied_keys, hold_message_for_review, is_message_review_pending,
    _schedule_save,
)

from app.oauth import (
    _oauth_apply,
    get_oauth_status,
    _obtain_oauth_token,
    _token_key,
    refresh_oauth_tokens_proactive,
    fetch_saved_vacancy_searches,
    fetch_favorited_vacancies,
    fetch_blacklisted_vacancies,
    fetch_resume_status,
    fetch_employer_rating,
    fetch_vacancy_details,
    fetch_negotiation_messages_oauth,
    send_negotiation_message_oauth,
    fetch_negotiations_today_count,
    fetch_negotiations_statistic,
)

from app.hh_api import (
    get_headers, parse_ids, parse_vacancy_meta, parse_salaries,
    parse_work_schedules, extract_search_query, parse_apply_strategy_meta,
)

from app.llm import generate_llm_reply, _openclaw_command, get_llm_last_status, get_llm_status_summary

from app.hh_client_factory import get_client

from app.hh_chat import (
    _build_thread_from_chat_item, _check_chat_locked,
    ChatikWSClient,
)

from app.hh_resume import (
    _resume_cache, _RESUME_CACHE_TTL,
)

from app.state import AccountState

LLM_LOG_FILE = Path("data") / "llm_log.jsonl"

# -- Async page fetcher (used only by BotManager) --

async def fetch_page(session, url, sem, req_kw: dict | None = None):
    async with sem:
        try:
            await asyncio.sleep(0.05)
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10), **(req_kw or {})) as r:
                html = await r.text()
                # Логируем только не-200 и аномальные размеры — иначе hundreds
                # of disk writes per cycle давят RotatingFileHandler (swarm-16 #9).
                if r.status != 200 or len(html) < 1000:
                    log_debug(f"⚠️ URL: {url} | Статус: {r.status} | Размер: {len(html)}")
                return html
        except Exception as e:
            log_debug(f"❌ ОШИБКА при загрузке: {url} | {type(e).__name__}: {e}")
            return ""


# ============================================================
# BOT MANAGER
# ============================================================

def _handle_edited_event(state, payload: dict) -> None:
    """HR отредактировал сообщение — кэшированный draft устарел (строился на
    старом тексте). Дропаем ключи по этому чату, LLM пересчитает на след. цикле."""
    chat_id = str(payload.get("chatId") or payload.get("chat_id") or "")
    if not chat_id:
        return
    with state._llm_drafts_lock:
        if state._llm_drafts:
            to_drop = [k for k in list(state._llm_drafts.keys()) if str(k[0]) == chat_id]
            for k in to_drop:
                state._llm_drafts.pop(k, None)
            if to_drop:
                log_debug(f"WS push [{state.short}] edited в {chat_id}: сброшено {len(to_drop)} черновиков")


class BotManager:
    def __init__(self):
        self.paused = False
        self._stop_event = threading.Event()
        self.account_states: list[AccountState] = []
        self.activity_log: deque = deque(maxlen=100)
        self.recent_responses: deque = deque(maxlen=100)
        self.llm_log: deque = deque(maxlen=200)    # LLM reply history
        # Защищает list(deque) snapshot от race с concurrent appendleft.
        # В CPython deque.appendleft атомарен, но `list(deque)` иногда падает с RuntimeError при гонке.
        self._deque_lock = threading.Lock()
        self.vacancy_queues: dict = {}
        self._start_time: datetime = None
        self.temp_sessions: list = load_browser_sessions()  # сессии из браузера (персистентные)
        self.temp_states: dict[int, AccountState] = {}  # temp_idx → AccountState для активных сессий
        # Global dedup across all accounts: {(cur_pid, neg_id, last_msg_id)}
        # Prevents double-sends when multiple accounts share the same HH user (same cur_pid)
        self._llm_sent_global: set = set()
        self._llm_sent_by_neg_id: dict = {}  # индекс neg_id -> set(global_key) для O(1) очистки
        self._llm_sent_lock = threading.Lock()
        # HR contacts collected from contactInfo during pre-checks
        self.hr_contacts: list = []  # capped at 500
        self._hr_contacts_lock = threading.Lock()
        # Guards activate_session against concurrent WS calls spawning duplicate workers
        self._activate_lock = threading.Lock()
        self._retiring_sessions = []  # (session object, state), until workers exit
        # Сериализация append к data/llm_log.jsonl (kimi-search-1 #5).
        self._llm_log_write_lock = threading.Lock()

    def reload_temp_sessions(self, sessions: list | None = None) -> int:
        """Refresh browser accounts after OTP materializes their sessions.

        ``sessions`` avoids racing the asynchronous disk writer.  Other callers may
        omit it to reload the persisted snapshot.
        """
        fresh = load_browser_sessions() if sessions is None else sessions
        if not isinstance(fresh, list):
            fresh = []
        self.temp_sessions[:] = fresh
        return len(self.temp_sessions)

    def _persist_llm_log(self, entry: dict):
        """Append-only JSONL write-through for LLM reply events (async via _schedule_save).
        Сериализуем через _llm_log_write_lock — иначе concurrent appends могут интерливить
        большие JSON-строки (>PIPE_BUF на Linux) и корраптить JSONL (kimi-search-1 #5).
        """
        def _write():
            try:
                from app.database import append_event
                with self._llm_log_write_lock:
                    append_event(LLM_LOG_FILE, entry)
            except Exception as e:
                log_debug(f"llm_log persist error: {e}")
        _schedule_save(_write)

    def _build_session_urls(self, resume_hash: str) -> list[str]:
        """Собрать URL конкретной сессии, не изменяя глобальный конфиг.

        Этот метод вызывается при автоматическом восстановлении активных
        сессий во время старта. Поэтому он обязан быть read-only: resume URL
        является runtime URL аккаунта, а не пользовательской настройкой
        ``CONFIG.url_pool``.
        """
        default_resume_url = (
            f"{hh_base()}/search/vacancy?resume={resume_hash}"
            "&area=113&order_by=publication_time&items_on_page=20"
        )
        urls = []
        for item in CONFIG.url_pool:
            entry = _url_entry(item)
            url = entry["url"]
            if not url:
                continue
            _text, _area, filters = parse_search_url(url)
            url_resume = str(filters.get("resume") or "")
            # Берём настройки поиска именно выбранного резюме. URL другого
            # резюме нельзя подмешивать в эту сессию.
            if not url_resume or url_resume == str(resume_hash):
                urls.append(url)
        if not any(str(parse_search_url(url)[2].get("resume") or "") == str(resume_hash)
                   for url in urls):
            urls.insert(0, default_resume_url)
        return urls

    def activate_session(self, temp_idx: int, restore: bool = False) -> bool:
        """Запустить браузерную сессию как полноценный бот-аккаунт.

        restore=True — авто-восстановление при старте: сохранённая ручная пауза
        остаётся в силе. При ручном запуске из UI пауза снимается."""
        with self._activate_lock:
            if temp_idx < 0 or temp_idx >= len(self.temp_sessions):
                return False
            ts = self.temp_sessions[temp_idx]
            self._retiring_sessions[:] = [
                (session, old) for session, old in self._retiring_sessions
                if any(t.is_alive() for t in getattr(old, '_workers', []))
            ]
            if any(session is ts for session, old in self._retiring_sessions):
                return False
            if not ts.get("resume_hash"):
                return False
            if temp_idx in self.temp_states:
                return True  # уже запущен
            if not restore:
                ts["paused"] = False
                ts["paused_reason"] = ""
                ts["captcha_url"] = ""
            # Отфильтровываем сохранённые URL от других резюме — юзер мог
            # сменить resume_hash сессии, а ts["urls"] содержит `resume=<старый_hash>`.
            # Без фильтра mobile-collect соберёт вакансии по чужому фильтру,
            # а отклики пойдут с текущего resume → шумовые отклики (audit #2).
            _rh = str(ts["resume_hash"])
            saved_urls = []
            for item in (ts.get("urls") or []):
                url = _url_entry(item)["url"]
                if not url:
                    continue
                try:
                    _text, _area, _flt = parse_search_url(url)
                    url_rh = str(_flt.get("resume") or "")
                except Exception:
                    url_rh = ""
                if not url_rh or url_rh == _rh:
                    saved_urls.append(url)
            acc = {
                "name": ts["name"],
                "short": ts.get("short", ts["name"]),
                "color": "yellow",
                "resume_hash": ts["resume_hash"],
                "letter": ts.get("letter", ""),
                "cookies": ts.get("cookies", {}),
                # Настройки конкретного аккаунта имеют приоритет. Если их нет,
                # используем URL из глобального пула для выбранного resume.
                "urls": saved_urls or self._build_session_urls(ts["resume_hash"]),
                "url_pages": dict(ts.get("url_pages") or {}),
                # Подтягиваем persistent флаги из temp_sessions — без этого
                # после restart browser-сессии теряли use_oauth/apply_tests (swarm-12 #9).
                "use_oauth": bool(ts.get("use_oauth", False)),
                "apply_tests": bool(ts.get("apply_tests", False)),
                "safety_enabled": bool(ts.get("safety_enabled", CONFIG.skip_inconsistent)),
                "mode": ts.get("mode", "web"),
                "user_id": str(ts.get("user_id") or ""),
                "resume_filters": normalize_resume_filters(ts.get("resume_filters")),
                "paused": bool(ts.get("paused", False)),
                "paused_reason": ts.get("paused_reason", ""),
                "captcha_url": ts.get("captcha_url", ""),
                "llm_enabled": bool(ts.get("llm_enabled", True)),
                "resume_touch_enabled": bool(ts.get("resume_touch_enabled", True)),
            }
            for filter_key in (
                "title_include_keywords",
                "title_exclude_keywords",
                "employer_exclude_keywords",
            ):
                if isinstance(ts.get(filter_key), list):
                    acc[filter_key] = list(ts[filter_key])
            state = AccountState(acc)
            self.temp_states[temp_idx] = state
            ts["bot_active"] = True
        save_browser_sessions(self.temp_sessions)
        log_debug(f"activate_session({temp_idx}): starting threads...")
        t1 = threading.Thread(target=self._run_account_worker, args=(900 + temp_idx, state), daemon=True, name=f"worker-{temp_idx}")
        t2 = threading.Thread(target=self._fetch_hh_stats_worker, args=(900 + temp_idx, state), daemon=True, name=f"stats-{temp_idx}")
        # Store handles + attach на state — stop()/deactivate join'ит их (round-1 #6/#19).
        # Round-2 #4: чистим is_alive() перед extend, чтобы список dead thread'ов
        # не рос навсегда.
        # Round-3 #7: read-modify-write под _activate_lock — иначе два
        # параллельных activate могли перезаписать список друг друга.
        state._workers = [t1, t2]
        with self._activate_lock:
            if state._deleted:
                return False
            t1.start()
            t2.start()
            if not hasattr(self, "_temp_workers"):
                self._temp_workers = []
            self._temp_workers[:] = [t for t in self._temp_workers if t.is_alive()]
            self._temp_workers.extend([t1, t2])
        try:
            with self._activate_lock:
                if not state._deleted:
                    self._start_ws_push(state)
        except Exception as e:
            log_debug(f"_start_ws_push temp({temp_idx}): {e}")
        log_debug(f"activate_session({temp_idx}): threads started t1={t1.is_alive()} t2={t2.is_alive()}")
        self._add_log(state.short, "yellow", f"\U0001f310 Сессия {ts['name']} запущена как бот", "success")
        return True

    def deactivate_session(self, temp_idx: int) -> bool:
        """Остановить браузерную сессию: сигналим воркерам выйти, удаляем state,
        сохраняем сессию на диск с bot_active=False. Кнопка «Стоп» в карточке.
        Сами cookies / resume / letter не трогаем — юзер может позже жмёт «▶ Запустить».
        """
        with self._activate_lock:
            if temp_idx < 0 or temp_idx >= len(self.temp_sessions):
                return False
            ts = self.temp_sessions[temp_idx]
            state = self.temp_states.pop(temp_idx, None)
            if state is not None:
                self._retiring_sessions.append((ts, state))
                # Сигналим воркерам: проверки `state._deleted` в каждом цикле
                # и в pause-loop приведут к graceful exit потоков.
                state._deleted = True
                state.paused = True
                state.paused_reason = 'manual'
            ts["bot_active"] = False
            ts["paused"] = True
        # Аудит 2026-08-17 #19: раньше deactivate возвращался мгновенно, а
        # rapid activate → deactivate → activate успевало создать вторую
        # (перекрывающуюся) пару worker'ов для того же HH-аккаунта. Join'им
        # старых, чтобы reactivate шёл на чистом slot'е. Join вне _activate_lock
        # т.к. worker сам берёт lock через save_browser_sessions/etc.
        if state is not None:
            ws = getattr(state, '_ws_client', None)
            if ws is not None:
                ws.stop()
            for t in getattr(state, "_workers", []):
                try:
                    t.join(timeout=5)
                except Exception:
                    pass
        save_browser_sessions(self.temp_sessions)
        log_debug(f"deactivate_session({temp_idx}): bot_active=False")
        if state is not None:
            self._add_log(state.short, "yellow", f"🛑 Сессия {ts.get('name','?')} остановлена", "warning")
        return True

    def _get_apply_acc(self, idx: int) -> dict | None:
        """Вернуть acc dict для apply-эндпоинтов (обычный или временный аккаунт)"""
        if 0 <= idx < len(self.account_states):
            return dict(self.account_states[idx].acc)
        temp_idx = idx - len(self.account_states)
        if 0 <= temp_idx < len(self.temp_sessions):
            return dict(self.temp_sessions[temp_idx])
        return None

    def _get_apply_state(self, idx: int):
        """AccountState обычного профиля или запущенной браузерной сессии
        (раньше для браузерных — None, и ручные отклики не попадали в счётчики)."""
        if 0 <= idx < len(self.account_states):
            return self.account_states[idx]
        return self.temp_states.get(idx - len(self.account_states))

    def _start_ws_push(self, state) -> None:
        """Подписать аккаунт на chatik WS push.
        На chat_message_create — дёргаем _process_llm_replies в фоне (с debounce).
        Защита от спама: не чаще раз в 10с на аккаунт (HH может прислать пачку событий).
        """
        if not getattr(CONFIG, "llm_ws_push_enabled", True):
            return
        if getattr(state, "_ws_client", None) and state._ws_client.alive:
            return
        _last_trigger = [0.0]  # mutable nonlocal для closure
        _self = self

        def _on_event(event_name: str, payload: dict) -> None:
            if state._deleted or _self._stop_event.is_set():
                return
            if event_name == "chat_message_create":
                import time as _t
                now = _t.time()
                if now - _last_trigger[0] < 10:
                    return
                _last_trigger[0] = now
                # HH-limit пауза НЕ распространяется на чат-ответы, только на
                # новые отклики. Стопаем только manual/auth, остальное пропускаем.
                _is_blocking_pause = _self.paused or (state.paused and state.paused_reason in ("manual", "auth"))
                if not CONFIG.llm_enabled or not state.llm_enabled or _is_blocking_pause:
                    return
                log_debug(f"WS push [{state.short}] {event_name} → триггерим LLM")
                threading.Thread(
                    target=_self._process_llm_replies, args=(state,),
                    daemon=True, name=f"ws-llm-{state.short}",
                ).start()
            elif event_name == "chat_message_edited":
                _handle_edited_event(state, payload)
            elif event_name == "last_viewed_message_change":
                # HR прочитал наше сообщение — засветим в лог для UI-нотификации.
                chat_id = str(payload.get("chatId") or payload.get("chat_id") or "")
                if chat_id:
                    _self._add_log(state.short, state.color,
                        f"\U0001f441 HR прочитал ({chat_id})", "info", neg_id=chat_id)
            elif event_name in ("chat_state_changed", "chat_message_deleted", "chat_participant_action"):
                log_debug(f"WS push [{state.short}] {event_name}: {str(payload)[:200]}")
        state._ws_client = ChatikWSClient(state.acc, _on_event, label=state.short)
        state._ws_client.start()

    def on_realtime_event(self, acc: dict, event) -> None:
        """Realtime-событие websocket.hh.ru (Phase 1, mobile push-канал).

        Вызывается из WS-треда ws_manager. Не должен кидать/блокировать.
        Активен только при CONFIG.use_websocket_realtime (иначе no-op)."""
        try:
            if not getattr(CONFIG, "use_websocket_realtime", False):
                return
            state = next((st for st in self.account_states if st.acc is acc), None)
            if state is None:
                return
            etype = getattr(event, "type", "") or ""
            if etype == "chat_message_create":
                import time as _t
                now = _t.time()
                if now - getattr(state, "_ws_realtime_last_trigger", 0.0) < 10:
                    return  # debounce: HH может прислать пачку событий
                state._ws_realtime_last_trigger = now
                _is_blocking_pause = self.paused or (state.paused and state.paused_reason in ("manual", "auth"))
                if not CONFIG.llm_enabled or not state.llm_enabled or _is_blocking_pause:
                    return
                log_debug(f"WS realtime [{state.short}] {etype} → триггерим LLM")
                self._add_log(state.short, state.color, "\U0001f4ac Новое сообщение HR (WS realtime)", "info")
                threading.Thread(
                    target=self._process_llm_replies, args=(state,),
                    daemon=True, name=f"ws-realtime-llm-{state.short}",
                ).start()
            elif etype == "chat_message_edited":
                payload = getattr(event, "event_data", {}) or {}
                # _handle_edited_event читает только chatId/chat_id, но push-канал
                # может нести id чата в другом ключе (ws_events нормализует его в
                # event.chat_id). Докинем chatId, иначе сброс устаревших черновиков
                # молча пропустится и LLM ответит на отредактированный текст старым.
                if getattr(event, "chat_id", None) and not payload.get("chatId") and not payload.get("chat_id"):
                    payload = {**payload, "chatId": event.chat_id}
                _handle_edited_event(state, payload)
            elif etype == "last_viewed_message_change":
                chat_id = str((getattr(event, "event_data", {}) or {}).get("chatId") or getattr(event, "chat_id", "") or "")
                if chat_id:
                    self._add_log(state.short, state.color, f"\U0001f441 HR прочитал (WS, {chat_id})", "info", neg_id=chat_id)
            else:
                log_debug(f"WS realtime [{state.short}] {etype}")
        except Exception as e:
            log_debug(f"on_realtime_event error: {e}")

    def start(self):
        # Регистр всех worker-threads чтобы stop() мог их join'нуть — иначе
        # in-flight работа после SIGTERM продолжается, save_executor уже закрыт,
        # add_applied молча теряет запись (аудит 2026-08-17 #6 critical).
        self._workers: list = []
        _load_cache()
        load_config()
        # После load_config: если env HH_PROXY не задан, но в CONFIG.hh_proxy_url
        # что-то сохранено (пользователь выставлял через UI) — применить.
        # env всегда приоритет чтобы docker-compose override работал.
        try:
            import os as _os
            if not _os.environ.get("HH_PROXY", "").strip() and getattr(CONFIG, "hh_proxy_url", ""):
                from app.hh_http import set_proxy
                set_proxy(CONFIG.hh_proxy_url)
                log_debug(f"HH_PROXY из CONFIG.hh_proxy_url применён: {CONFIG.hh_proxy_url[:40]}")
        except Exception as _e:
            log_debug(f"applying stored proxy failed: {_e}")
        self._start_time = datetime.now()
        self.paused = bool(getattr(CONFIG, "bot_paused", False))
        self._restore_recent_responses()
        self.account_states = [AccountState(acc) for acc in accounts_data]
        for i, state in enumerate(self.account_states):
            t1 = threading.Thread(
                target=self._run_account_worker, args=(i, state), daemon=True
            )
            t2 = threading.Thread(
                target=self._fetch_hh_stats_worker, args=(i, state), daemon=True
            )
            t1.start()
            t2.start()
            self._workers.extend([t1, t2])
            try:
                self._start_ws_push(state)
            except Exception as e:
                log_debug(f"_start_ws_push({state.short}): {e}")
        # Phase 1: mobile WS-слушатель websocket.hh.ru (read-only push).
        # Стартуем только при явно включённом флаге — иначе поведение бота не меняется.
        if getattr(CONFIG, "use_websocket_realtime", False):
            try:
                from app.ws_manager import ws_manager
                ws_manager.auto_start_enabled()
                if self.paused:
                    ws_manager.suspend()
            except Exception as e:
                log_debug(f"ws_manager auto_start error: {e}")
        # Proactive OAuth refresh — раз в 6 часов обновляет токены,
        # у которых TTL < 48ч, чтобы refresh_token не успел истечь когда
        # аккаунт долго на паузе (лимит HH, ручная пауза).
        _oauth_t = threading.Thread(
            target=self._oauth_refresh_worker, daemon=True,
            name="oauth_refresh",
        )
        _oauth_t.start()
        self._workers.append(_oauth_t)
        # Real HH-limit tracker — каждые 30 мин синхронизирует daily_sent с
        # фактическим числом откликов из HH и снимает hard_stopped если лимит
        # реально не достигнут (например HH сам сбросил счётчик).
        _limit_t = threading.Thread(
            target=self._hh_limit_tracker_worker, daemon=True,
            name="hh_limit_tracker",
        )
        _limit_t.start()
        self._workers.append(_limit_t)

        # Авто-активация браузерных сессий, которые были запущены до перезапуска
        log_debug(f"start(): {len(self.temp_sessions)} temp sessions to check")
        for i, ts in enumerate(self.temp_sessions):
            log_debug(f"start(): session {i}: bot_active={ts.get('bot_active')}, resume_hash={bool(ts.get('resume_hash'))}")
            if ts.get("bot_active") and ts.get("resume_hash"):
                try:
                    # Ручная пауза профиля сохраняется между перезапусками.
                    result = self.activate_session(i, restore=True)
                    log_debug(f"start(): activate_session({i}) = {result}")
                except Exception as e:
                    log_debug(f"start(): activate_session({i}) ERROR: {e}")
        self._add_log("", "", "\U0001f680 Бот запущен", "success")

    def stop(self):
        self._stop_event.set()
        # Останавливаем WS-клиенты у всех аккаунтов (regular + temp)
        for st in list(self.account_states) + list(self.temp_states.values()):
            ws = getattr(st, "_ws_client", None)
            if ws:
                try:
                    ws.stop()
                except Exception:
                    pass
        # Phase 1: глушим mobile WS-слушатель ws_manager (no-op если не стартовал).
        try:
            from app.ws_manager import ws_manager
            ws_manager.stop_all()
        except Exception:
            pass
        # Аудит round-1 #6: join всех worker'ов чтобы in-flight цикл добежал
        # до `if _stop_event: return` ДО того как save_executor выключится.
        # Round-2 #3: раньше join(timeout=15) на каждый = 300с для 10 accounts.
        # Используем ОБЩИЙ deadline, чтобы shutdown был ограничен сверху.
        import time as _time
        deadline = _time.monotonic() + 20  # весь shutdown уложить в ~20с
        for t in list(getattr(self, "_workers", [])) + list(getattr(self, "_temp_workers", [])):
            remaining = deadline - _time.monotonic()
            if remaining <= 0:
                break
            try:
                t.join(timeout=remaining)
            except Exception:
                pass

    def toggle_pause(self):
        self.paused = not self.paused
        CONFIG.bot_paused = self.paused
        save_config()
        msg = "⏸️ Пауза" if self.paused else "▶️ Продолжение"
        level = "warning" if self.paused else "success"
        self._add_log("", "", msg, level)
        # Phase 1: глобальная пауза приостанавливает и mobile WS-слушатели.
        try:
            from app.ws_manager import ws_manager
            if self.paused:
                ws_manager.suspend()
            else:
                ws_manager.resume()
        except Exception:
            pass

    def _persist_account_flag(self, idx: int, key: str, value) -> None:
        """Сохранить тумблер профиля (обычного или браузерного) на диск."""
        try:
            if 0 <= idx < len(self.account_states):
                self.account_states[idx].acc[key] = value
                if idx < len(accounts_data):
                    accounts_data[idx][key] = value
                    save_accounts()
                return
            temp_idx = idx - len(self.account_states)
            state = self.temp_states.get(temp_idx)
            if state is not None:
                state.acc[key] = value
            if 0 <= temp_idx < len(self.temp_sessions):
                self.temp_sessions[temp_idx][key] = value
                save_browser_sessions(self.temp_sessions)
        except Exception as e:
            log_debug(f"persist {key} [{idx}]: {e}")

    def _persist_protective_pause(self, state: AccountState) -> None:
        flags = {"paused": bool(state.paused), "paused_reason": state.paused_reason,
                 "captcha_url": state.captcha_url}
        state.acc.update(flags)
        try:
            for i, st in enumerate(getattr(self, "account_states", [])):
                if st is state:
                    if i < len(accounts_data):
                        accounts_data[i].update(flags)
                        save_accounts()
                    return
            for i, st in getattr(self, "temp_states", {}).items():
                if st is state and i < len(self.temp_sessions):
                    self.temp_sessions[i].update(flags)
                    save_browser_sessions(self.temp_sessions)
                    return
        except Exception as exc:
            log_debug(f"persist protective pause [{state.short}]: {type(exc).__name__}")

    def toggle_account_pause(self, idx: int):
        state = None
        if 0 <= idx < len(self.account_states):
            state = self.account_states[idx]
        else:
            temp_idx = idx - len(self.account_states)
            state = self.temp_states.get(temp_idx)
        if not state:
            return
        with state._state_lock:
            state.paused = not state.paused
            if not state.paused:
                # Reset hard stop / limit so worker can continue
                state.hard_stopped = False
                state.limit_exceeded = False
                state.limit_reset_time = None
                # Иначе следующая ошибка снова auto-pause'нет account (state_machine #6).
                state.consecutive_errors = 0
                state.paused_reason = ""
                state.captcha_url = ""
            else:
                state.paused_reason = "manual"
        self._persist_protective_pause(state)
        msg = (
            f"⏸️ Аккаунт {state.short} приостановлен"
            if state.paused
            else f"▶️ Аккаунт {state.short} возобновлён"
        )
        self._add_log(state.short, state.color, msg, "warning" if state.paused else "success")
        # Phase 1: пауза regular-аккаунта приостанавливает его mobile WS-слушатель.
        # temp-сессии (browser) в ws_manager не обслуживаются — только regular idx.
        if 0 <= idx < len(self.account_states):
            try:
                from app.ws_manager import ws_manager
                if state.paused:
                    ws_manager.suspend_account(idx)
                else:
                    ws_manager.resume_account(idx)
            except Exception:
                pass

    def toggle_account_llm(self, idx: int):
        state = None
        if 0 <= idx < len(self.account_states):
            state = self.account_states[idx]
        else:
            temp_idx = idx - len(self.account_states)
            state = self.temp_states.get(temp_idx)
        if state:
            state.llm_enabled = not state.llm_enabled
            self._persist_account_flag(idx, "llm_enabled", state.llm_enabled)
            msg = (
                f"\U0001f916 LLM включён для {state.short}"
                if state.llm_enabled
                else f"\U0001f916 LLM выключен для {state.short}"
            )
            self._add_log(state.short, state.color, msg, "info")

    def toggle_account_oauth(self, idx: int):
        state = None
        if 0 <= idx < len(self.account_states):
            state = self.account_states[idx]
        else:
            temp_idx = idx - len(self.account_states)
            state = self.temp_states.get(temp_idx)
        if state:
            state.use_oauth = not state.use_oauth
            mode = "\U0001f511 OAuth" if state.use_oauth else "\U0001f310 Web"
            self._add_log(state.short, state.color, f"{mode} откликов для {state.short}", "info")
            # Persist to account data
            state.acc["use_oauth"] = state.use_oauth
            if 0 <= idx < len(accounts_data):
                accounts_data[idx]["use_oauth"] = state.use_oauth
                save_accounts()
            else:
                temp_idx = idx - len(self.account_states)
                if 0 <= temp_idx < len(self.temp_sessions):
                    self.temp_sessions[temp_idx]["use_oauth"] = state.use_oauth
                    save_browser_sessions(self.temp_sessions)

    def trigger_resume_touch(self, idx: int):
        if 0 <= idx < len(self.account_states):
            self.account_states[idx].next_resume_touch = datetime.now()
        else:
            temp_idx = idx - len(self.account_states)
            if temp_idx in self.temp_states:
                self.temp_states[temp_idx].next_resume_touch = datetime.now()

    def toggle_resume_touch(self, idx: int) -> bool:
        state = None
        if 0 <= idx < len(self.account_states):
            state = self.account_states[idx]
        else:
            temp_idx = idx - len(self.account_states)
            if temp_idx in self.temp_states:
                state = self.temp_states[temp_idx]
        if state:
            state.resume_touch_enabled = not state.resume_touch_enabled
            self._persist_account_flag(idx, "resume_touch_enabled", state.resume_touch_enabled)
            return state.resume_touch_enabled
        return False

    def _add_log(self, acc_short: str, acc_color: str, message: str, level: str = "info", neg_id: str = ""):
        entry = {
            "time": datetime.now().astimezone().isoformat(timespec="seconds"),
            "acc": acc_short,
            "color": acc_color,
            "message": message,
            "level": level,
        }
        if neg_id:
            entry["neg_id"] = str(neg_id)
        with self._deque_lock:
            self.activity_log.appendleft(entry)

    def _record_apply_error(self, state: AccountState, vid: str, reason: str, info: dict | None = None):
        meta = state.vacancy_meta.get(vid, {})
        info = info or {}
        # Never retain raw responses, exception messages or credentials here.
        status = info.get("http_status")
        code = str(info.get("error_code") or "")
        with state._deque_lock:
            state.errors += 1
            state.apply_errors.appendleft({
                "time": datetime.now().astimezone().isoformat(timespec="seconds"),
                "vacancy_id": vid if str(vid).isdigit() else "",
                "title": str(meta.get("title") or "")[:160],
                "reason": reason,
                "http_status": status if isinstance(status, int) and 100 <= status <= 599 else None,
                "error_code": code if re.fullmatch(r"[a-z_]{1,40}", code) else "",
            })

    def _add_acc_event(self, state: AccountState, icon: str, etype: str,
                        title: str, company: str, extra: str = ""):
        with state._deque_lock:
            state.acc_event_log.appendleft({
                "time": datetime.now().strftime("%H:%M"),
                "icon": icon,
                "type": etype,
                "title": title[:45],
                "company": company[:25],
                "extra": extra[:70],
            })

    def _push_action(self, state: AccountState, entry: str) -> None:
        """Thread-safe append в state.action_history под _deque_lock.
        Раньше writers делали bare append, snap builder читал `list(deque)` —
        при конкурентной мутации CPython бросает RuntimeError, broadcast_loop
        ловил, но дропал ВЕСЬ snapshot того тика → UI подвисал на 300ms.
        """
        with state._deque_lock:
            state.action_history.append(entry)

    def _push_llm_log(self, entry: dict) -> None:
        """Thread-safe appendleft в self.llm_log под _deque_lock.
        Аудит 2026-08-17 #23: раньше writers жали bare appendleft, snapshot
        builder читал list(llm_log) — та же гонка, что закрыта в _push_action.
        """
        with self._deque_lock:
            self.llm_log.appendleft(entry)

    @staticmethod
    def _snap_deque(dq, lock):
        """Snapshot deque под lock — снапшот-ридер не должен ронять весь
        snapshot тика из-за конкурентного append/appendleft (RuntimeError:
        deque mutated during iteration). Возвращает обычный list."""
        with lock:
            return list(dq)

    def _check_auto_pause(self, state: AccountState):
        """Авто-пауза при превышении лимита ошибок подряд."""
        n = CONFIG.auto_pause_errors
        if n > 0 and state.consecutive_errors >= n:
            with state._state_lock:
                # Не перетираем manual pause: если пользователь только что снял паузу,
                # `toggle_account_pause` обнулил `consecutive_errors`. Если он стоит на 0,
                # auto-pause не должен срабатывать заново.
                if state.consecutive_errors >= n and not state.paused:
                    state.paused = True
                    state.paused_reason = "auto_errors"
                    self._persist_protective_pause(state)
                    self._add_log(
                        state.short, state.color,
                        f"⛔ Авто-пауза: {n} ошибок подряд. Снимите вручную.",
                        "error",
                    )

    def _maybe_roll_daily_counter(self, state: AccountState) -> bool:
        today = _today_msk()
        with state._state_lock:
            if state.daily_date != today:
                state.daily_sent = 0
                state.daily_date = today
                state.hard_stopped = False
                # Сбрасываем и limit-флаги: иначе после rollover остаёмся в limit-check
                # block с уже обнулённым счётчиком (kimi-search-1 #9).
                state.limit_exceeded = False
                state.limit_reset_time = None
                # Сбрасываем paused если он был auto/limit (kimi-search-1 #9 extra) — но НЕ manual.
                if state.paused and state.paused_reason in ("limit", "auto_errors"):
                    state.paused = False
                    state.paused_reason = ""
                    # Также сбрасываем счётчик ошибок — иначе следующая ошибка
                    # сразу re-pause'нет аккаунт (consistency с toggle_account_pause).
                    state.consecutive_errors = 0
                return True
        return False

    def _restore_recent_responses(self):
        """Hydrate history via storage API, never an imported cache reference."""
        # В хранилище профиль записан полным именем, а живые записи ленты —
        # коротким. Приводим к одному виду, чтобы лента после рестарта не «двоилась».
        short_by_name = {}
        for acc in list(accounts_data) + list(self.temp_sessions):
            if isinstance(acc, dict) and acc.get("name"):
                short_by_name[acc["name"]] = acc.get("short") or acc["name"]
        entries = [{
            "id": row["vacancy_id"], "title": row.get("title", ""),
            "company": row.get("company", ""), "acc": short_by_name.get(row["account"], row["account"]),
            "account_name": row["account"],
            "time": row.get("at") or "",
            "result": "sent", "icon": "✅",
        } for row in get_applied_list(100)]
        with self._deque_lock:
            self.recent_responses.clear()
            self.recent_responses.extend(entries)

    def _add_response(
        self,
        state: AccountState,
        vid: str,
        title: str,
        company: str,
        result: str,
        salary: str = "",
    ):
        result_icons = {
            "sent": "✅",
            "test": "\U0001f9ea",
            "already": "\U0001f504",
            "limit": "\U0001f6ab",
            "error": "❌",
        }
        # HR online/offline + chat status вытаскиваем из vacancy_meta —
        # фронт показывает их в карточке отклика без extra-fetch'ей.
        _vm = state.vacancy_meta.get(vid, {}) if hasattr(state, "vacancy_meta") else {}
        entry = {
            "time": datetime.now().astimezone().isoformat(timespec="seconds"),
            "acc": state.short,
            "color": state.color,
            "id": vid,
            "account_name": state.name,
            "title": title or _vm.get("title") or f"Вакансия №{vid}",
            "company": company or _vm.get("company") or "",
            "salary": salary,
            "result": result,
            "icon": result_icons.get(result, "❓"),
            "hr_online": _vm.get("hr_online", ""),
            "chat_write": _vm.get("chat_write_possibility", ""),
            "accept_auto": _vm.get("accept_auto_response"),
            "employer_rating": _vm.get("employer_rating") or None,
        }
        if result == "error":
            with state._deque_lock:
                last_error = next((e for e in getattr(state, "apply_errors", []) if e["vacancy_id"] == str(vid)), None)
                if last_error:
                    entry["error_detail"] = dict(last_error)
        # Держим _deque_lock т.к. snap builder читает `list(self.recent_responses)`
        # без lock'а в другом потоке — иначе CPython RuntimeError и дроп тика.
        with self._deque_lock:
            self.recent_responses.appendleft(entry)
        if result == "test":
            state.seen_tests.add(vid)
        elif result == "already":
            state.seen_already.add(vid)

    def get_state_snapshot(self) -> dict:
        """Full JSON snapshot for WS broadcast"""
        now = datetime.now()
        uptime = int((now - self._start_time).total_seconds()) if self._start_time else 0

        # All states: regular + temp sessions (for global_stats, vacancy_queues)
        all_states = list(self.account_states) + list(self.temp_states.values())
        storage_stats = get_stats()
        metrics = get_dashboard_metrics()

        accounts = []
        for i, s in enumerate(self.account_states):
            next_touch_str = ""
            if s.next_resume_touch:
                rem = (s.next_resume_touch - now).total_seconds()
                if rem > 0:
                    h = int(rem // 3600)
                    m = int((rem % 3600) // 60)
                    next_touch_str = f"{s.next_resume_touch.strftime('%H:%M')} ({h}ч{m}м)"
                else:
                    next_touch_str = "сейчас!"

            hh_updated_str = ""
            if s.hh_stats_updated:
                ago = int((now - s.hh_stats_updated).total_seconds() / 60)
                hh_updated_str = (
                    f"{ago}м назад" if ago < 60 else f"{ago // 60}ч{ago % 60}м назад"
                )

            with s._state_lock:
                _status = s.status
                _status_detail = s.status_detail
                _hh_interviews = s.hh_interviews
                _hh_interviews_recent = s.hh_interviews_recent
                _hh_viewed = s.hh_viewed
                _hh_discards = s.hh_discards
                _hh_not_viewed = s.hh_not_viewed
                _hh_unread_by_employer = s.hh_unread_by_employer
                _hh_interviews_list = s.hh_interviews_list[:20]
                _current_vacancy_idx = s.current_vacancy_idx
                _total_vacancies = s.total_vacancies

            _total_applied = storage_stats["by_acc"].get(s.name, 0)

            accounts.append({
                "idx": i,
                "name": s.name,
                "short": s.short,
                "resume_hash": s.acc.get("resume_hash", ""),
                "all_resumes": s.acc.get("all_resumes", []),
                "resume_filters": normalize_resume_filters(s.acc.get("resume_filters")),
                "title_include_keywords": s.acc.get("title_include_keywords", []),
                "title_exclude_keywords": s.acc.get("title_exclude_keywords", []),
                "employer_exclude_keywords": s.acc.get("employer_exclude_keywords", []),
                "experience": s.acc.get("experience", []),
                "color": s.color,
                "status": _status,
                "status_detail": _status_detail,
                "can_run_now": not self._run_now_error(s),
                "sent": _total_applied,
                "session_sent": s.sent,
                "total_applied": _total_applied,
                "tests": s.tests,
                "errors": s.errors,
                "already_applied": s.already_applied,
                "found_vacancies": s.found_vacancies,
                "current_vacancy_title": s.current_vacancy_title,
                "current_vacancy_company": s.current_vacancy_company,
                "current_vacancy_idx": _current_vacancy_idx,
                "total_vacancies": _total_vacancies,
                "salary_skipped": s.salary_skipped,
                "questionnaire_sent": s.questionnaire_sent,
                "limit_exceeded": s.limit_exceeded,
                "paused": s.paused,
                "next_resume_touch": next_touch_str,
                "resume_touch_status": s.resume_touch_status,
                "resume_touch_enabled": s.resume_touch_enabled,
                "letter": s.acc.get("letter", ""),
                "urls": s.acc.get("urls", []),
                "url_pages": s.acc.get("url_pages", {}),
                "hh_interviews": _hh_interviews,
                "hh_interviews_recent": _hh_interviews_recent,
                "hh_viewed": _hh_viewed,
                "hh_discards": _hh_discards,
                "hh_not_viewed": _hh_not_viewed,
                "hh_unread_by_employer": _hh_unread_by_employer,
                "hh_stats_updated": hh_updated_str,
                "hh_stats_loading": s.hh_stats_loading,
                "hh_interviews_list": _hh_interviews_list,
                "hh_possible_offers": s.hh_possible_offers[:10],
                "action_history": self._snap_deque(s.action_history, s._deque_lock),
                "resume_views_7d": s.resume_views_7d,
                "resume_views_new": s.resume_views_new,
                "resume_shows_7d": s.resume_shows_7d,
                "resume_invitations_7d": s.resume_invitations_7d,
                "resume_invitations_new": s.resume_invitations_new,
                "resume_next_touch_seconds": s.resume_next_touch_seconds,
                "resume_free_touches": s.resume_free_touches,
                "resume_global_invitations": s.resume_global_invitations,
                "resume_new_invitations_total": s.resume_new_invitations_total,
                "acc_event_log": self._snap_deque(s.acc_event_log, s._deque_lock),
                "apply_errors": self._snap_deque(s.apply_errors, s._deque_lock),
                "apply_tests": s.apply_tests,
                "safety_enabled": s.safety_enabled,
                "safety_inconsistent_skipped": s.safety_inconsistent_skipped,
                "safety_misleading_skipped": s.safety_misleading_skipped,
                "safety_redirect_skipped": s.safety_redirect_skipped,
                "safety_last_reason": s.safety_last_reason,
                "consecutive_errors": s.consecutive_errors,
                "url_stats": dict(s.url_stats),
                "cookies_expired": s.cookies_expired,
                "degraded_mode": s.degraded_mode,
                "degraded_skipped": s.degraded_skipped,
                "mode": str(s.acc.get("mode", "") or "").strip().lower(),
                "hh_user_id": str(s.acc.get("user_id") or ""),
                "degraded_fallback_enabled": s.degraded_fallback_enabled,
                "resume_status_oauth": dict(s.resume_status or {}),
                "hh_today_applies": s.hh_today_applies,
                "hh_today_applies_updated": s.hh_today_applies_updated,
                "hh_daily_limit": CONFIG.hh_daily_limit or 200,
                "responses_streak_count": getattr(s, "responses_streak_count", 0),
                "responses_streak_required": getattr(s, "responses_streak_required", 0),
                "oauth_status": get_oauth_status(s.acc.get("resume_hash", "")),
                "llm_enabled": s.llm_enabled,
                "llm_status": s.llm_status,
                "llm_replied_count": s.llm_replied_count,
                "llm_pending_chats": s.llm_pending_chats,
                "llm_current_neg_id": getattr(s, "llm_current_neg_id", ""),
                "llm_current_employer": getattr(s, "llm_current_employer", ""),
                "llm_current_idx": getattr(s, "llm_current_idx", 0),
                "llm_current_total": getattr(s, "llm_current_total", 0),
                "llm_last_check_at": getattr(s, "llm_last_check_at", ""),
                "llm_next_check_at": getattr(s, "llm_next_check_at", ""),
                "use_oauth": s.use_oauth,
                "daily_sent": s.daily_sent,
                "daily_limit": CONFIG.daily_apply_limit,
                "hard_stopped": s.hard_stopped,
                "last_apply_at": s.last_apply_at,
                "last_apply_attempt_at": s.last_apply_attempt_at,
                "paused_reason": s.paused_reason,
                "captcha_url": s.captcha_url,
            })

        # Temp browser sessions — append after regular accounts
        base_idx = len(self.account_states)
        for i, ts in enumerate(self.temp_sessions):
            idx = base_idx + i
            state = self.temp_states.get(i)
            if state:
                # Активная сессия — реальные данные из AccountState
                s = state
                nrt = s.next_resume_touch.strftime("%H:%M") if s.next_resume_touch else ""
                ts_hh_updated_str = ""
                if s.hh_stats_updated:
                    ago = int((now - s.hh_stats_updated).total_seconds() / 60)
                    ts_hh_updated_str = (
                        f"{ago}м назад" if ago < 60 else f"{ago // 60}ч{ago % 60}м назад"
                    )
                with s._state_lock:
                    _status = s.status
                    _status_detail = s.status_detail
                    _hh_interviews = s.hh_interviews
                    _hh_interviews_recent = s.hh_interviews_recent
                    _hh_viewed = s.hh_viewed
                    _hh_discards = s.hh_discards
                    _hh_not_viewed = s.hh_not_viewed
                    _hh_unread_by_employer = s.hh_unread_by_employer
                    _hh_interviews_list = s.hh_interviews_list[:20]
                    _current_vacancy_idx = s.current_vacancy_idx
                    _total_vacancies = s.total_vacancies

                _total_applied = storage_stats["by_acc"].get(s.acc["name"], 0)

                accounts.append({
                    "idx": idx,
                    "name": s.acc["name"],
                    "short": s.acc.get("short", ""),
                    "color": "yellow",
                    "temp": True,
                    "bot_active": True,
                    "resume_hash": s.acc.get("resume_hash", ""),
                    "all_resumes": ts.get("all_resumes", []),
                    "resume_filters": normalize_resume_filters(s.acc.get("resume_filters")),
                    "title_include_keywords": s.acc.get("title_include_keywords", []),
                    "title_exclude_keywords": s.acc.get("title_exclude_keywords", []),
                    "employer_exclude_keywords": s.acc.get("employer_exclude_keywords", []),
                    "experience": s.acc.get("experience", []),
                    "letter": s.acc.get("letter", ""),
                    "urls": s.acc.get("urls", []),
                    "url_pages": s.acc.get("url_pages", {}),
                    "status": _status,
                    "status_detail": _status_detail,
                    "can_run_now": not self._run_now_error(s),
                    "sent": _total_applied,
                    "session_sent": s.sent,
                    "total_applied": _total_applied,
                    "tests": s.tests,
                    "errors": s.errors,
                    "already_applied": s.already_applied,
                    "found_vacancies": s.found_vacancies,
                    "current_vacancy_title": s.current_vacancy_title,
                    "current_vacancy_company": s.current_vacancy_company,
                    "current_vacancy_idx": _current_vacancy_idx,
                    "total_vacancies": _total_vacancies,
                    "salary_skipped": s.salary_skipped,
                    "questionnaire_sent": s.questionnaire_sent,
                    "limit_exceeded": s.limit_exceeded,
                    "paused": s.paused,
                    "next_resume_touch": nrt,
                    "resume_touch_status": s.resume_touch_status,
                    "resume_touch_enabled": s.resume_touch_enabled,
                    "hh_interviews": _hh_interviews,
                    "hh_interviews_recent": _hh_interviews_recent,
                    "hh_viewed": _hh_viewed,
                    "hh_discards": _hh_discards,
                    "hh_not_viewed": _hh_not_viewed,
                    "hh_unread_by_employer": _hh_unread_by_employer,
                    "hh_stats_updated": ts_hh_updated_str,
                    "hh_stats_loading": s.hh_stats_loading,
                    "hh_interviews_list": _hh_interviews_list,
                    "hh_possible_offers": s.hh_possible_offers[:10],
                    "action_history": self._snap_deque(s.action_history, s._deque_lock),
                    "resume_views_7d": s.resume_views_7d,
                    "resume_views_new": s.resume_views_new,
                    "resume_shows_7d": s.resume_shows_7d,
                    "resume_invitations_7d": s.resume_invitations_7d,
                    "resume_invitations_new": s.resume_invitations_new,
                    "resume_next_touch_seconds": s.resume_next_touch_seconds,
                    "resume_free_touches": s.resume_free_touches,
                    "resume_global_invitations": s.resume_global_invitations,
                    "resume_new_invitations_total": s.resume_new_invitations_total,
                    "acc_event_log": self._snap_deque(s.acc_event_log, s._deque_lock),
                    "apply_errors": self._snap_deque(s.apply_errors, s._deque_lock),
                    "apply_tests": s.apply_tests,
                    "safety_enabled": s.safety_enabled,
                    "safety_inconsistent_skipped": s.safety_inconsistent_skipped,
                    "safety_misleading_skipped": s.safety_misleading_skipped,
                    "safety_redirect_skipped": s.safety_redirect_skipped,
                    "safety_last_reason": s.safety_last_reason,
                    "consecutive_errors": s.consecutive_errors,
                    "url_stats": dict(s.url_stats),
                    "cookies_expired": s.cookies_expired,
                    "degraded_mode": s.degraded_mode,
                    "degraded_skipped": s.degraded_skipped,
                    "degraded_fallback_enabled": s.degraded_fallback_enabled,
                    "mode": str(s.acc.get("mode", "") or "").strip().lower(),
                    "hh_user_id": str(s.acc.get("user_id") or ""),
                    "resume_status_oauth": dict(s.resume_status or {}),
                    "hh_today_applies": s.hh_today_applies,
                    "hh_today_applies_updated": s.hh_today_applies_updated,
                    "hh_daily_limit": CONFIG.hh_daily_limit or 200,
                    "oauth_status": get_oauth_status(s.acc.get("resume_hash", "")),
                    "llm_enabled": s.llm_enabled,
                    "llm_status": s.llm_status,
                    "llm_pending_chats": s.llm_pending_chats,
                    "llm_current_neg_id": getattr(s, "llm_current_neg_id", ""),
                    "llm_current_employer": getattr(s, "llm_current_employer", ""),
                    "llm_current_idx": getattr(s, "llm_current_idx", 0),
                    "llm_current_total": getattr(s, "llm_current_total", 0),
                    "llm_last_check_at": getattr(s, "llm_last_check_at", ""),
                    "llm_next_check_at": getattr(s, "llm_next_check_at", ""),
                    "use_oauth": s.use_oauth,
                    "daily_sent": s.daily_sent,
                    "daily_limit": CONFIG.daily_apply_limit,
                    "hard_stopped": s.hard_stopped,
                    "last_apply_at": s.last_apply_at,
                    "last_apply_attempt_at": s.last_apply_attempt_at,
                    "paused_reason": s.paused_reason,
                    "captcha_url": s.captcha_url,
                })
            else:
                # Неактивная сессия — заглушка
                accounts.append({
                    "idx": idx,
                    "name": ts.get("name", f"Браузер #{i+1}"),
                    "short": ts.get("short", f"Браузер#{i+1}"),
                    "color": "yellow",
                    "temp": True,
                    "bot_active": False,
                    "mode": str(ts.get("mode", "") or "").strip().lower(),
                    "hh_user_id": str(ts.get("user_id") or ""),
                    "resume_hash": ts.get("resume_hash", ""),
                    "all_resumes": ts.get("all_resumes", []),
                    "resume_filters": normalize_resume_filters(ts.get("resume_filters")),
                    "title_include_keywords": ts.get("title_include_keywords", []),
                    "title_exclude_keywords": ts.get("title_exclude_keywords", []),
                    "employer_exclude_keywords": ts.get("employer_exclude_keywords", []),
                    "experience": ts.get("experience", []),
                    "letter": ts.get("letter", ""),
                    "status": "—", "status_detail": "",
                    "sent": storage_stats["by_acc"].get(ts.get("name", ""), 0),
                    "total_applied": storage_stats["by_acc"].get(ts.get("name", ""), 0),
                    "session_sent": 0, "tests": 0,
                    "errors": 0, "already_applied": 0, "found_vacancies": 0,
                    "current_vacancy_title": "", "current_vacancy_company": "",
                    "current_vacancy_idx": 0, "total_vacancies": 0,
                    "salary_skipped": 0, "questionnaire_sent": 0,
                    "limit_exceeded": False, "paused": False,
                    "next_resume_touch": "", "resume_touch_status": "",
                    "hh_interviews": 0, "hh_viewed": 0, "hh_discards": 0,
                    "hh_not_viewed": 0, "hh_unread_by_employer": 0,
                    "hh_stats_updated": "", "hh_stats_loading": False,
                    "hh_interviews_list": [], "hh_possible_offers": [], "action_history": [],
                    "resume_views_7d": 0, "resume_views_new": 0, "resume_shows_7d": 0,
                    "resume_invitations_7d": 0, "resume_invitations_new": 0,
                    "resume_next_touch_seconds": 0, "resume_free_touches": 0,
                    "resume_global_invitations": 0, "resume_new_invitations_total": 0,
                    "acc_event_log": [],
                    "apply_tests": bool(ts.get("apply_tests", False)),
                    "safety_enabled": bool(ts.get("safety_enabled", CONFIG.skip_inconsistent)),
                    "safety_inconsistent_skipped": 0,
                    "safety_misleading_skipped": 0,
                    "safety_redirect_skipped": 0,
                    "safety_last_reason": "",
                    "consecutive_errors": 0,
                    "url_stats": {},
                    "cookies_expired": False,
                    "degraded_mode": False,
                    "degraded_skipped": 0,
                    "degraded_fallback_enabled": bool(ts.get("degraded_fallback_enabled", True)),
                    "resume_status_oauth": {},
                    "hh_today_applies": 0,
                    "hh_today_applies_updated": "",
                    "hh_daily_limit": CONFIG.hh_daily_limit or 200,
                    "responses_streak_count": 0,
                    "responses_streak_required": 0,
                    "llm_enabled": bool(ts.get("llm_enabled", True)),
                    "use_oauth": bool(ts.get("use_oauth", False)),
                    "daily_sent": 0,
                    "daily_limit": CONFIG.daily_apply_limit,
                    "hard_stopped": False,
                })

        _vacancy_queues = {}
        for s in all_states:
            with s._state_lock:
                _current_vacancy_idx = s.current_vacancy_idx
                _vacancies_queue = list(s.vacancies_queue)
            _vacancy_queues[s.short] = {
                "remaining": max(0, len(_vacancies_queue) - _current_vacancy_idx),
                "next": _vacancies_queue[_current_vacancy_idx: _current_vacancy_idx + 5]
                if _vacancies_queue
                else [],
            }

        state_by_idx = {i: s for i, s in enumerate(self.account_states)}
        state_by_idx.update({len(self.account_states) + i: s for i, s in self.temp_states.items()})
        for item in accounts:
            st = state_by_idx.get(item["idx"])
            raw = st.acc if st else self.temp_sessions[item["idx"] - len(self.account_states)]
            item["profile_filter_keys"] = [k for k in ("title_include_keywords", "title_exclude_keywords", "employer_exclude_keywords") if isinstance(raw.get(k), list)]
            item["search_source_mode"] = raw.get("search_source_mode", "selected" if raw.get("urls") else "inherit")
            item["include_saved_searches"] = raw.get("include_saved_searches", True)
            item["active_search_urls"] = list(getattr(st, "active_search_urls", [])) if st else []
            persisted = metrics["by_account"].get(st.name if st else item["name"], {})
            item.update({
                "sent_today": persisted.get("today", 0),
                "last_sent_at": persisted.get("last_sent_at", ""),
                "unique_tests": len(st.seen_tests) if st else 0,
                "unique_already": len(st.seen_already) if st else 0,
                "next_search_at": st.next_search_at if st else "",
                "last_search_at": st.last_search_at if st else "",
                "hh_stats_checked_at": st.hh_stats_updated.astimezone().isoformat() if st and st.hh_stats_updated else "",
                "cycle_summary": dict(st.cycle_summary) if st else {},
                "effective_oauth": bool(item.get("use_oauth") or CONFIG.use_oauth_apply or item.get("degraded_mode") or item.get("mode") == "oauth"),
            })
            raw_updated = item.get("hh_today_applies_updated")
            if raw_updated:
                from app.dashboard import timestamp
                stamp = timestamp(raw_updated)
                item["hh_today_applies_updated"] = stamp.isoformat() if stamp else ""

        return {
            "type": "state_update",
            "dashboard": {k: v for k, v in metrics.items() if k != "by_account"},
            "uptime_seconds": uptime,
            "paused": self.paused,
            "accounts": accounts,
            "recent_responses": self._snap_deque(self.recent_responses, self._deque_lock),
            # Аудит 2026-08-17 #23: list(deque) без lock даёт RuntimeError или
            # неполный/повреждённый snapshot если writer в этот момент делает
            # append/appendleft. Оборачиваем в _snap_deque как recent_responses.
            "log": self._snap_deque(self.activity_log, self._deque_lock),
            "llm_log": self._snap_deque(self.llm_log, self._deque_lock),
            "config": {
                "pages_per_url": CONFIG.pages_per_url,
                "response_delay": CONFIG.response_delay,
                "pause_between_cycles": CONFIG.pause_between_cycles,
                "batch_responses": CONFIG.batch_responses,
                "limit_check_interval": CONFIG.limit_check_interval,
                "min_salary": CONFIG.min_salary,
                "auto_pause_errors": CONFIG.auto_pause_errors,
                "auto_apply_tests": CONFIG.auto_apply_tests,
                "use_oauth_apply": CONFIG.use_oauth_apply,
                "daily_apply_limit": CONFIG.daily_apply_limit,
                "hh_daily_limit": CONFIG.hh_daily_limit,
                "fresh_vacancies_mode": CONFIG.fresh_vacancies_mode,
                "fresh_vacancy_hours": CONFIG.fresh_vacancy_hours,
                "fresh_apply_reserve": CONFIG.fresh_apply_reserve,
                "stop_on_hh_limit": CONFIG.stop_on_hh_limit,
                "llm_check_interval": CONFIG.llm_check_interval,
                "allowed_schedules": CONFIG.allowed_schedules,
                "title_include_keywords": getattr(CONFIG, "title_include_keywords", []),
                "title_exclude_keywords": getattr(CONFIG, "title_exclude_keywords", []),
                "questionnaire_templates": CONFIG.questionnaire_templates,
                "questionnaire_default_answer": questionnaire_default_answer(),
                "letter_templates": CONFIG.letter_templates,
                "url_pool": CONFIG.url_pool,
                "skip_inconsistent": CONFIG.skip_inconsistent,
                "filter_agencies": CONFIG.filter_agencies,
                "filter_low_competition": CONFIG.filter_low_competition,
                "search_period_days": CONFIG.search_period_days,
                "llm_enabled": CONFIG.llm_enabled,
                "llm_auto_send": CONFIG.llm_auto_send,
                "llm_fill_questionnaire": CONFIG.llm_fill_questionnaire,
                "llm_use_cover_letter": CONFIG.llm_use_cover_letter,
                "llm_use_resume": CONFIG.llm_use_resume,
                "llm_use_quick_replies": getattr(CONFIG, "llm_use_quick_replies", True),
                "hh_ai_letter_first_try": getattr(CONFIG, "hh_ai_letter_first_try", True),
                "related_vacancies_enabled": getattr(CONFIG, "related_vacancies_enabled", True),
                "llm_model": CONFIG.llm_model,
                "llm_base_url": CONFIG.llm_base_url,
                "llm_status_summary": get_llm_status_summary(),
                # Системный промпт нужен в снимке: после релоада фронт инитит
                # textarea дефолтом, а потом любая правка ругого поля LLM
                # autosave'ила бы этот дефолт обратно на диск. Снимок служит
                # источником истины для UI.
                "llm_system_prompt": CONFIG.llm_system_prompt,
                # Note: don't include llm_api_key in snapshot for security,
                # но кладём fingerprint + key_set, чтобы UI мог показать
                # «✓ ключ сохранён (sk-p…wxyz, 164 симв.)» после релоада —
                # type=password input не покажет значение даже если бы оно было.
                "llm_api_key_set": bool((CONFIG.llm_api_key or "").strip()),
                "llm_api_key_fingerprint": _fingerprint_key(CONFIG.llm_api_key),
                "llm_profiles": [
                    {
                        "name": p.get("name", ""),
                        "base_url": p.get("base_url", ""),
                        "model": p.get("model", ""),
                        "enabled": p.get("enabled", True),
                        "key_set": bool((p.get("api_key") or "").strip()),
                        "key_fingerprint": _fingerprint_key(p.get("api_key", "")),
                        "key_len": len((p.get("api_key") or "").strip()),
                    }
                    for p in (CONFIG.llm_profiles or [])
                ],
                "llm_profile_mode": CONFIG.llm_profile_mode,
            },
            "global_stats": {
                "total_sent": storage_stats["total"],
                "session_sent": sum(s.sent for s in all_states),
                "total_tests": sum(s.tests for s in all_states),
                "total_errors": sum(s.errors for s in all_states),
                "total_found": sum(s.found_vacancies for s in all_states),
                "storage_total": storage_stats["total"],
                "storage_tests": storage_stats["tests"],
            },
            "vacancy_queues": _vacancy_queues,
        }

    def _run_now_error(self, state: AccountState) -> str:
        if self._stop_event.is_set() or state._deleted:
            return "Профиль остановлен"
        if self.paused or state.paused:
            return "Сначала снимите паузу"
        if state.captcha_url or state.paused_reason in ("captcha", "auth", "auto_errors"):
            return "Сначала устраните причину остановки профиля"
        if (state.hard_stopped or state.limit_exceeded
                or (CONFIG.daily_apply_limit > 0 and state.daily_sent >= CONFIG.daily_apply_limit)
                or (CONFIG.hh_daily_limit > 0 and state.hh_today_applies >= CONFIG.hh_daily_limit)):
            return "Достигнут лимит откликов"
        if not state.cycle_waiting:
            return "Проверка уже выполняется или профиль ещё не готов"
        if state._cycle_wakeup.is_set():
            return "Проверка уже запрошена"
        return ""

    def request_account_cycle(self, idx: int) -> dict:
        """Wake the existing worker; never create a parallel application cycle."""
        if 0 <= idx < len(self.account_states):
            state = self.account_states[idx]
        else:
            state = self.temp_states.get(idx - len(self.account_states))
        if state is None:
            return {"ok": False, "error": "Активный профиль не найден"}
        with state._state_lock:
            error = self._run_now_error(state)
            if error:
                return {"ok": False, "error": error}
            state._cycle_wakeup.set()
        return {"ok": True}

    def _wait_between_cycles(self, state: AccountState, seconds: float) -> bool:
        """Wait interruptibly, preserving the usual pause/limit checks next cycle."""
        with state._state_lock:
            state._cycle_wakeup.clear()
            state.cycle_waiting = True
            state.next_search_at = (datetime.now().astimezone() + timedelta(seconds=max(0, seconds))).isoformat()
        deadline = time.monotonic() + max(0, seconds)
        try:
            while not self._stop_event.is_set() and not state._deleted:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or state._cycle_wakeup.wait(min(remaining, 0.5)):
                    break
        finally:
            with state._state_lock:
                state.cycle_waiting = False
                state.next_search_at = ""
                state._cycle_wakeup.clear()
        return self._stop_event.is_set() or state._deleted

    def _run_account_worker(self, idx: int, state: AccountState) -> None:
        """Thread worker for an account — auto-restarts on crash"""
        while not self._stop_event.is_set() and not getattr(state, '_deleted', False):
            try:
                self._run_account_worker_inner(idx, state)
                break  # normal exit
            except Exception as e:
                log_exception(f"WORKER CRASHED [{state.short}]", e)
                state.status = "error"
                state.status_detail = f"Перезапуск через 30с ({str(e)[:30]})"
                self._add_log(state.short, state.color, f"⚠️ Worker упал: {str(e)[:50]}. Перезапуск через 30с", "error")
                time.sleep(30)
                state.status = "idle"
                state.status_detail = "Перезапущен после ошибки"
                self._add_log(state.short, state.color, "\U0001f504 Worker перезапущен", "info")

    def _maybe_touch_resume(self, state: AccountState, acc: dict) -> None:
        """Автоподнятие резюме. Не зависит от лимита откликов: вызывается и из
        основного цикла, и пока профиль стоит на паузе из-за лимита/капчи."""
        now = datetime.now()
        if state.resume_touch_enabled:
            should_touch = False
            if state.next_resume_touch is None:
                should_touch = True
            elif now >= state.next_resume_touch:
                should_touch = True

            if should_touch:
                # Всегда сверяемся с сервером непосредственно перед publish:
                # UI/фоновая статистика используют 5-минутный cache и после
                # предыдущего touch могут ещё показывать устаревшее `true`.
                fresh_status = get_client(acc).fetch_resume_status(force=True) or {}
                server_next = _server_next_publish_datetime(fresh_status)
                if fresh_status and not fresh_status.get("can_publish_or_update"):
                    state.resume_free_touches = 0
                    if server_next and server_next > now:
                        state.next_resume_touch = server_next
                        state.resume_touch_status = f"⏳ Доступно в {server_next.strftime('%H:%M')}"
                    else:
                        # Сервер запретил publish, но не отдал время. Не вызываем
                        # publish в этом проходе; свежий статус проверится в
                        # следующем обычном цикле без ложного запроса на поднятие.
                        state.next_resume_touch = now + timedelta(minutes=5)
                        state.resume_touch_status = "⏳ HH пока не разрешает поднятие"
                elif fresh_status.get("can_publish_or_update"):
                    self._add_log(state.short, state.color, "\U0001f4e4 Поднимаю резюме...", "info")
                    success, message, touch_cooldown = _normalize_touch_result(
                        get_client(acc).touch_resume())
                    # Результат publish немедленно делает прежний cache статуса
                    # недействительным. Следующее время берём только у HH.
                    after_status = get_client(acc).fetch_resume_status(force=True) or {}
                    server_next = _server_next_publish_datetime(after_status)
                    state.resume_free_touches = int(bool(after_status.get("can_publish_or_update")))
                    if server_next and server_next > now:
                        state.next_resume_touch = server_next
                    else:
                        # Защита на случай eventual consistency API: повторно
                        # читаем статус позже, но publish без разрешения не шлём.
                        state.next_resume_touch = now + timedelta(minutes=5)
                    if touch_cooldown and touch_cooldown > state.next_resume_touch:
                        state.next_resume_touch = touch_cooldown
                    if success:
                        state.resume_touch_status = "✅ Поднято!"
                        self._add_log(
                            state.short, state.color,
                            f"✅ Резюме поднято! Следующая проверка в {state.next_resume_touch.strftime('%H:%M')}",
                            "success",
                        )
                    else:
                        state.resume_touch_status = f"⏳ {message}"
                        self._add_log(
                            state.short, state.color,
                            f"\U0001f4e4 {message}. Следующая проверка статуса в {state.next_resume_touch.strftime('%H:%M')}",
                            "warning",
                        )
                else:
                    # Без подтверждённого разрешения от HH ручку publish не
                    # вызываем. Сетевая ошибка статуса не должна вести к 429.
                    state.next_resume_touch = now + timedelta(minutes=5)
                    state.resume_touch_status = "⏳ Не удалось проверить доступность"

    def _hot_lead_vids(self, acc: dict) -> set:
        """id вакансий работодателей, готовых пригласить (possible_job_offers).
        Mobile-профили — через mobile API, web — через web-эндпоинт."""
        mode = str(acc.get("mode", "")).strip().lower()
        if mode in ("mobile", "oauth"):
            vids = set()
            for o in get_client(acc).fetch_possible_offers() or []:
                for v in (o.get("vacancyIds") or ([o["vacancyId"]] if o.get("vacancyId") else [])):
                    vids.add(str(v))
            return vids
        r_offers = HH.get(
            hh_base() + "/shards/applicant/negotiations/possible_job_offers",
            headers={
                "User-Agent": webview_user_agent(),
                "Accept": "application/json",
                "X-Xsrftoken": acc.get("cookies", {}).get("_xsrf", ""),
                "Referer": hh_base() + "/applicant/negotiations",
            },
            cookies=acc.get("cookies", {}), cookie_jar_key=_token_key(acc) or None,
            timeout=10,
        )
        if r_offers.status_code != 200:
            return set()
        offers_data = r_offers.json()
        offer_items = offers_data if isinstance(offers_data, list) else offers_data.get("possibleJobOffers", [])
        return {str(o.get("vacancyId")) for o in offer_items if o.get("vacancyId")}

    def _enrich_missing_meta(self, state: AccountState, acc: dict, vids: set,
                             salary_map: dict, schedule_map: dict, limit: int = 40) -> int:
        """Заполнить vacancy_meta для вакансий, у которых нет названия
        (избранное, похожие). Не больше `limit` запросов за цикл."""
        missing = [v for v in vids if not (state.vacancy_meta.get(v) or {}).get("title")]
        filled = 0
        for vid in missing[:limit]:
            if self._stop_event.is_set() or state._deleted:
                break
            try:
                det = fetch_vacancy_details(acc, vid)
            except Exception as e:
                log_debug(f"enrich meta {vid} [{state.short}]: {e}")
                continue
            if not det or not det.get("title"):
                if det.get("archived") if det else False:
                    state.vacancy_meta.setdefault(vid, {})["archived"] = True
                continue
            meta = state.vacancy_meta.setdefault(vid, {})
            meta.update({
                "title": det.get("title", ""),
                "experience": det.get("experience", ""),
                "company": det.get("company", ""),
                "employer_id": str(det.get("employer_id") or ""),
                "published_at": det.get("published_at", ""),
                "has_test": bool(det.get("has_test")),
                "response_letter_required": bool(det.get("response_letter_required")),
                "archived": bool(det.get("archived")),
            })
            if det.get("work_format"):
                meta["work_formats"] = [str(w).upper() for w in det["work_format"] if w]
            if det.get("schedule"):
                schedule_map.setdefault(vid, set()).add(det["schedule"])
            salary_map[vid] = _salary_rub(det.get("salary"))
            filled += 1
        if missing:
            log_debug(f"enrich meta [{state.short}]: {filled}/{len(missing)} карточек дотянуто")
        return filled

    def _dispatch_allowed(self, state: AccountState, context: str) -> bool:
        return not (self.paused or self._stop_event.is_set() or state.paused
                    or state.limit_exceeded or state.hard_stopped or state._deleted
                    or _apply_context_key(state.acc) != context)

    def _send_oauth_batch(self, state: AccountState, acc: dict, batch: list, context: str) -> list:
        acc = {**acc, "_dispatch_guard": lambda: self._dispatch_allowed(state, context)}
        results = []
        for vid in batch:
            if not self._dispatch_allowed(state, context):
                break
            try:
                result = _oauth_apply(acc, vid, acc.get("letter", ""))
                results.append(result)
                if result[0] in ("captcha", "limit", "auth_error"):
                    break
                if result[0] == "error" and result[1].get("review_required"):
                    break
            except Exception as exc:
                results.append(exc)
            if CONFIG.response_delay > 0:
                time.sleep(CONFIG.response_delay)
        return results

    def _hold_unconfirmed_submission(self, state, acc, vid):
        """Pause and durably hold an ambiguous write before another cycle."""
        state.paused = True
        state.paused_reason = "review"
        self._persist_protective_pause(state)
        meta = state.vacancy_meta.get(vid, {})
        add_test_vacancy(vid, meta.get("title", ""), meta.get("company", ""),
                         acc["name"], acc.get("resume_hash", ""), status="review")

    def _run_account_worker_inner(self, idx: int, state: AccountState) -> None:
        acc = state.acc

        if not state._active_search_forced:
            try:
                r = get_client(acc).set_job_search_status("active_search")
                if r.get("ok"):
                    state._active_search_forced = True
                    self._add_log(state.short, state.color,
                                  "\U0001f7e2 Статус: активный поиск", "info")
                else:
                    # Транзиентный fail — не выставляем флаг, попробуем на следующем
                    # перезапуске воркера (после crash или ручной паузы).
                    log_debug(f"active_search [{state.short}]: {r.get('error', '?')[:80]}")
            except Exception as e:
                log_debug(f"active_search [{state.short}] exception: {e}")

        while not self._stop_event.is_set() and not state._deleted:
            # Global + per-account pause
            while (self.paused or state.paused) and not self._stop_event.is_set() and not state._deleted:
                # Auto-reset daily limit pause when new day starts
                if state.hard_stopped:
                    if self._maybe_roll_daily_counter(state):
                        # Не снимаем manual pause — если юзер сам остановил аккаунт,
                        # midnight-rollover не должен его перезапускать (swarm-12 #8).
                        if state.paused_reason in ("", "limit"):
                            state.paused = False
                            state.paused_reason = ""
                        state.limit_exceeded = False
                        state.limit_reset_time = None
                        state.status = "idle"
                        state.status_detail = "Новый день — лимит сброшен"
                        self._add_log(state.short, state.color,
                            "\U0001f305 Новый день! Лимит сброшен" + (
                                "" if state.paused_reason != "manual" else ", аккаунт остался на manual pause"),
                            "success")
                        break
                if state.hard_stopped:
                    state.status = "limit"
                    if CONFIG.daily_apply_limit > 0 and state.daily_sent >= CONFIG.daily_apply_limit:
                        state.status_detail = f"Дневной лимит: {state.daily_sent}/{CONFIG.daily_apply_limit}. Сброс завтра в 00:00"
                    else:
                        state.status_detail = "Лимит HH. Сброс завтра в 00:00"
                elif state.limit_exceeded:
                    state.status = "limit"
                    if state.limit_reset_time:
                        remaining = int((state.limit_reset_time - datetime.now()).total_seconds())
                        if remaining > 0:
                            state.status_detail = f"Лимит HH. Проверка через {remaining // 60}м{remaining % 60:02d}с"
                        else:
                            state.status_detail = "Лимит HH. Проверка сейчас..."
                    else:
                        state.status_detail = "Лимит HH. Проверка через 1м"
                else:
                    state.status = "idle"
                    state.status_detail = {
                        "captcha": "HH требует проверку при отправке отклика. Пройдите её по ссылке ниже и снимите паузу.",
                        "auto_errors": "Авто-пауза после ошибок отправки. Проверьте журнал.",
                        "auth": "Пауза: требуется авторизация HH.",
                        "review": "Результат отправки не подтверждён. Проверьте отклик в HH перед продолжением.",
                    }.get(state.paused_reason, "Пауза пользователем")
                # Лимит/капча/ошибки откликов не мешают поднимать резюме.
                if (not self.paused and state.paused
                        and state.paused_reason in ("limit", "captcha", "auto_errors", "review")):
                    try:
                        self._maybe_touch_resume(state, acc)
                    except Exception as e:
                        log_debug(f"resume touch on pause [{state.short}]: {e}")
                time.sleep(1)

            if self._stop_event.is_set():
                break

            # Freeze dispatch settings for this cycle. Edits invalidate the
            # queue; they must never change the resume of a selected vacancy.
            with state._state_lock:
                cycle_context = _apply_context_key(state.acc)
                acc = dict(state.acc)
                acc["resume_filters"] = copy.deepcopy(state.acc.get("resume_filters"))
                acc["_dispatch_guard"] = lambda context=cycle_context: self._dispatch_allowed(state, context)

            now = datetime.now()

            # === АВТОПОДНЯТИЕ РЕЗЮМЕ ===
            self._maybe_touch_resume(state, acc)

            # === ПРОВЕРКА ЛИМИТА ===
            if state.limit_exceeded:
                # If no reset time set, schedule a check soon
                if not state.limit_reset_time:
                    state.limit_reset_time = now + timedelta(minutes=1)

                if now >= state.limit_reset_time:
                    state.status = "checking"
                    state.status_detail = "Проверка сброса лимита..."
                    self._add_log(state.short, state.color, "\U0001f50d Проверяю сброс лимита...", "info")

                    if not get_client(acc).check_limit():
                        state.limit_exceeded = False
                        state.limit_reset_time = None
                        # Ручную паузу, поставленную во время проверки, не снимаем.
                        if state.paused_reason in ("", "limit"):
                            state.paused = False
                            state.paused_reason = ""
                        state.hard_stopped = False
                        state.status_detail = ""
                        self._add_log(
                            state.short, state.color, "✅ Лимит сброшен! Продолжаю работу", "success"
                        )
                    else:
                        state.limit_reset_time = now + timedelta(minutes=CONFIG.limit_check_interval)
                        state.status = "limit"
                        state.status_detail = f"Проверка в {state.limit_reset_time.strftime('%H:%M')}"
                        self._add_log(
                            state.short, state.color,
                            f"⏳ Лимит ещё активен, попробую в {state.limit_reset_time.strftime('%H:%M')}",
                            "warning",
                        )
                        time.sleep(60)
                        continue
                else:
                    state.status = "limit"
                    remaining = int((state.limit_reset_time - now).total_seconds())
                    state.status_detail = f"Проверка через {remaining}с"
                    time.sleep(30)
                    continue

            # === СБОР ВАКАНСИЙ (ПАРАЛЛЕЛЬНО) ===
            # Если у аккаунта нет своих URL — используем глобальный пул
            effective_urls = _search_urls(acc)
            # Auto-merge сохранённых поисков юзера с hh.ru (cached 1h) — добавляются
            # к существующему пулу. items_url у HH возвращается в api.hh.ru-домене;
            # cookie-collector использует hh.ru/search/vacancy, поэтому конвертируем.
            try:
                for ss in (fetch_saved_vacancy_searches(acc) if acc.get("include_saved_searches", True) else []):
                    iu = ss.get("items_url", "") or ""
                    if not iu:
                        continue
                    web_url = iu.replace("api.hh.ru/vacancies", "hh.ru/search/vacancy")
                    if web_url not in effective_urls:
                        effective_urls.append(web_url)
            except Exception as e:
                log_debug(f"saved_searches merge error [{state.short}]: {e}")
            state.total_urls = len(effective_urls)
            acc["_cycle_search_urls"] = list(effective_urls)
            state.active_search_urls = list(effective_urls)
            if not effective_urls:
                state.status = "waiting"
                state.status_detail = "Поиски не выбраны — отклики не отправляются"
                state.cycle_summary = {"found": 0, "eligible": 0, "already": 0, "tests": 0, "filtered": 0}
                if self._wait_between_cycles(state, CONFIG.pause_between_cycles):
                    return
                continue

            state.status = "collecting"
            state.status_detail = "Начинаю параллельный сбор..."
            state.vacancies_by_url = {}
            state.vacancy_meta = {}  # Сброс метаданных вакансий для нового цикла

            self._add_log(
                state.short, state.color,
                f"\U0001f4e5 Параллельный сбор: {len(effective_urls)} URL × {CONFIG.pages_per_url} стр",
                "info",
            )

            # Degraded mode: cookies протухли, но OAuth refresh_token живой.
            # Используем api.hh.ru/vacancies вместо cookie-based scraping.
            # Per-account тумблер degraded_fallback_enabled (default True) даёт
            # юзеру отключить авто-fallback для конкретного аккаунта.
            use_oauth_collect = _uses_api_search(acc, state)
            try:
                if use_oauth_collect:
                    results_by_url, salary_map, schedule_map = self._collect_via_oauth_api(state, acc=acc)
                    # degraded_mode = "web cookies были живые и умерли, теперь
                    # едем на OAuth-fallback". Для чисто mobile-flow (OTP-логин,
                    # никогда не было web cookies) это НЕ degraded — это штатный
                    # native mode. UI-баджа с "⚠️ Degraded" пугала юзеров без
                    # реальной проблемы.
                    is_mobile_native = str(acc.get("mode", "")).strip().lower() in ("mobile", "oauth")
                    has_results = bool(any(v for v in results_by_url.values()))
                    state.degraded_mode = has_results and not is_mobile_native
                    if state.degraded_mode:
                        self._add_log(
                            state.short, state.color,
                            "⚠️ Cookies dead → degraded OAuth-режим (без опросников/тестов)",
                            "warning",
                        )
                else:
                    results_by_url, salary_map, schedule_map = asyncio.run(self._collect_all_urls_parallel(state, acc=acc))
                    if not state.cookies_expired:
                        # Снимаем degraded флаг если cookies снова валидны.
                        state.degraded_mode = False
            except Exception as e:
                log_exception(f"COLLECT CRASH [{state.short}]", e)
                state.status = "error"
                state.status_detail = f"Ошибка сбора: {str(e)[:50]}"
                time.sleep(60)
                continue

            all_vacancies = []
            for url in effective_urls:
                url_vacancies = results_by_url.get(url, set())
                state.vacancies_by_url[url] = len(url_vacancies)
                all_vacancies.extend(url_vacancies)

                query = extract_search_query(url)
                if url_vacancies:
                    self._add_log(state.short, state.color, f"\U0001f4ca {query}: {len(url_vacancies)}", "info")
            # Сохраняем статистику по URL для снапшота
            state.url_stats = dict(state.vacancies_by_url)

            unique_vacancies = set(all_vacancies)
            # related_vacancies — рекомендательный фид HH под seed-вакансию.
            # Обычно match'ит лучше чем текстовый поиск (внутренний ML ranker).
            # Один запрос на цикл — берём последнюю applied как seed.
            if CONFIG.related_vacancies_enabled and unique_vacancies:
                seed_vid = None
                for rr in self._snap_deque(self.recent_responses, self._deque_lock)[:20]:
                    if rr.get("acc") == state.short:
                        cand = str(rr.get("id") or "")
                        if cand:
                            seed_vid = cand
                            break
                if not seed_vid:
                    seed_vid = next(iter(unique_vacancies), None)
                if seed_vid:
                    try:
                        related = get_client(acc).fetch_related_vacancies(str(seed_vid), max_pages=1)
                        if related:
                            new_ids = set(related) - unique_vacancies
                            unique_vacancies |= set(related)
                            if new_ids:
                                self._add_log(state.short, state.color,
                                    f"\U0001f517 Related: +{len(new_ids)} вакансий (seed {seed_vid})", "info")
                    except Exception as e:
                        log_debug(f"related_vacancies error [{state.short}]: {e}")
            # Favorited из HH — приоритетные кандидаты юзера. Подмешиваем в общий
            # пул (фильтры применятся как обычно — has_test и т.д.). Хранятся
            # отдельно чтобы apply phase могла отсортировать их вперёд.
            favorited_ids: set = set()
            try:
                fav = fetch_favorited_vacancies(acc)
                if fav:
                    favorited_ids = set(fav)
                    new_count = len(favorited_ids - unique_vacancies)
                    unique_vacancies |= favorited_ids
                    if new_count:
                        self._add_log(
                            state.short, state.color,
                            f"⭐ Избранное: +{new_count} вакансий из HH",
                            "info",
                        )
            except Exception as e:
                log_debug(f"favorited merge error [{state.short}]: {e}")
            # Blacklisted из HH — фильтруем сразу
            try:
                bl = fetch_blacklisted_vacancies(acc)
                if bl:
                    blocked_count = len(unique_vacancies & bl)
                    unique_vacancies -= bl
                    if blocked_count:
                        self._add_log(
                            state.short, state.color,
                            f"🚫 HH-blacklist: -{blocked_count} вакансий",
                            "info",
                        )
            except Exception as e:
                log_debug(f"blacklist filter error [{state.short}]: {e}")
            state._favorited_ids = favorited_ids  # для приоритизации в apply
            # «Избранное» и «Похожие» приходят только id — без названия фильтр
            # ниже их молча отбрасывал. Дотягиваем карточку через OAuth.
            self._enrich_missing_meta(state, acc, unique_vacancies, salary_map, schedule_map)
            total_collected = len(unique_vacancies)

            self._add_log(
                state.short, state.color,
                f"\U0001f4ca Всего собрано: {len(all_vacancies)} ({total_collected} уникальных)",
                "info",
            )

            if not unique_vacancies:
                if state.cookies_expired and not state.degraded_mode:
                    # Cookies dead AND OAuth fallback тоже не вернул ничего —
                    # тогда уже честная пауза до обновления кук.
                    state.paused = True
                    state.paused_reason = "auth"
                    self._persist_protective_pause(state)
                    self._add_log(
                        state.short, state.color,
                        "⚠️ Куки протухли и OAuth-fallback пуст. Обновите куки.", "error",
                    )
                    self._add_acc_event(state, "⚠️", "error", "Авторизация", "", "Обновите куки")
                    continue
                state.status = "waiting"
                state.status_detail = "Нет вакансий"
                self._add_log(
                    state.short, state.color,
                    "⚠️ Не найдено ни одной вакансии, пауза 2 мин",
                    "warning",
                )
                if self._wait_between_cycles(state, 120):
                    return
                continue

            # Фильтрация
            filtered = []
            already_count = 0
            test_count = 0
            salary_skipped = 0
            schedule_skipped = 0
            title_skipped = 0
            employer_skipped = 0
            state.rating_skipped = 0  # per-cycle counter, reset here
            apply_tests = state.apply_tests or CONFIG.auto_apply_tests
            configured_title_include = resume_filter_value(
                acc, acc.get("resume_hash", ""), "title_include_keywords"
            )
            configured_title_exclude = resume_filter_value(
                acc, acc.get("resume_hash", ""), "title_exclude_keywords"
            )
            resume_profile = normalize_resume_filters(acc.get("resume_filters")).get(
                str(acc.get("resume_hash", "")), {}
            )
            resume_work_formats = set(resume_profile.get("allowed_work_formats") or [])
            has_resume_work_format_rule = "allowed_work_formats" in resume_profile
            title_include_keywords = [
                str(k).strip().lower()
                for k in configured_title_include
                if str(k).strip()
            ]
            title_exclude_keywords = [
                str(k).strip().lower()
                for k in configured_title_exclude
                if str(k).strip()
            ]
            employer_exclude_keywords = [
                str(k).strip().lower()
                for k in resume_filter_value(
                    acc, acc.get("resume_hash", ""), "employer_exclude_keywords"
                )
                if str(k).strip()
            ]

            discard_skipped = 0
            unsafe_skipped = 0
            old_skipped = 0
            for vid in unique_vacancies:
                meta = state.vacancy_meta.get(vid, {})
                title = (meta.get("title") or "").lower()
                log_debug(f"Processing vacancy {vid}: {title}")
                if not title:
                    continue
                if meta.get("archived"):
                    continue
                company = (meta.get("company") or "").lower()
                if employer_exclude_keywords and any(k in company for k in employer_exclude_keywords):
                    employer_skipped += 1
                    continue
                # Android requests these flags on resume-based searches. A
                # misleading vacancy needs a human decision; an immediate
                # redirect is an obsolete/duplicate vacancy shell.
                if state.safety_enabled and meta.get("misleading_vacancy_alert"):
                    unsafe_skipped += 1
                    state.safety_misleading_skipped += 1
                    state.safety_last_reason = f"{vid}: предупреждение HH о вакансии"
                    continue
                if state.safety_enabled and meta.get("immediate_redirect_vacancy_id"):
                    unsafe_skipped += 1
                    state.safety_redirect_skipped += 1
                    state.safety_last_reason = (
                        f"{vid}: redirect → {meta.get('immediate_redirect_vacancy_id')}"
                    )
                    continue
                allowed_experience = resume_profile.get("experience") or []
                # Missing experience is not permission to bypass a strict rule.
                if not _experience_allowed(acc, meta, vid, allowed_experience):
                    title_skipped += 1
                    continue
                experience_filters = _experience_ids(meta.get("experience")) or list(meta.get("experience_filters") or [])
                if not _title_allowed(title, title_include_keywords, title_exclude_keywords, experience_filters,
                                      role_include=acc.get("title_include_keywords") or []):
                    title_skipped += 1
                    continue
                # HH сам метит вакансии меткой DISCARD когда нас уже отвергли —
                # повторный отклик чаще всего бесполезен, экономим лимит/токены.
                hh_labels = meta.get("hh_labels") or []
                if "DISCARD" in hh_labels:
                    discard_skipped += 1
                    continue
                # В strict OAuth/mobile режиме анкета открывается через штатный
                # autologin WebView bridge. Только degraded web-сессия без этого
                # flow должна заранее пропускать web-only формы.
                if state.degraded_mode and (
                    meta.get("has_test") or meta.get("response_letter_required")
                ):
                    state.degraded_skipped += 1
                    continue
                if _too_old_for_period(meta):
                    old_skipped += 1
                    continue
                # Дешёвые локальные проверки — ДО сетевых запросов деталей и
                # рейтинга: раньше они шли для каждой вакансии, включая те, на
                # которые уже откликались (лишняя нагрузка на HH → капча/429).
                if is_applied(acc["name"], vid):
                    already_count += 1
                    state.seen_already.add(vid)
                    state.already_applied += 1
                    continue
                if is_review_pending(acc["name"], vid):
                    continue
                if (is_test(vid, acc["name"], acc.get("resume_hash", "")) or state._test_failures.get(vid, 0) >= 2) and not apply_tests:
                    test_count += 1
                    state.seen_tests.add(vid)
                    state.tests += 1
                    continue
                if has_resume_work_format_rule and resume_work_formats:
                    actual_formats = {
                        str(value).strip().upper()
                        for value in (meta.get("work_formats") or meta.get("work_format_filters") or [])
                        if str(value).strip()
                    }
                    if actual_formats and not actual_formats.intersection(resume_work_formats):
                        schedule_skipped += 1
                        continue
                elif not has_resume_work_format_rule and CONFIG.allowed_schedules:
                    # Пустой список форматов у резюме явно отключает глобальный фильтр.
                    sched = schedule_map.get(vid, set())
                    if sched and not sched.intersection(CONFIG.allowed_schedules):
                        schedule_skipped += 1
                        continue
                if _salary_too_low(salary_map, vid):
                    salary_skipped += 1
                    state.salary_skipped += 1
                    continue
                # Vacancy quality gates через GET /vacancies/{vid} — lazy: вызываем
                # только если хотя бы один из флагов включён (иначе extra-fetch для
                # каждой вакансии слишком дорог).
                need_details = (
                    CONFIG.skip_auto_response_vacancies
                    or CONFIG.accredited_it_only
                    or CONFIG.prefer_quick_responses
                )
                if need_details:
                    det = fetch_vacancy_details(acc, vid)
                    if det:
                        meta["auto_response"] = det.get("auto_response")
                        meta["quick_responses_allowed"] = det.get("quick_responses_allowed")
                        meta["accredited_it_employer"] = det.get("accredited_it_employer")
                        meta["key_skills"] = det.get("key_skills") or []
                        if det.get("archived"):
                            continue
                        if CONFIG.skip_auto_response_vacancies and det.get("auto_response"):
                            state.rating_skipped = getattr(state, "rating_skipped", 0) + 1
                            continue
                        if CONFIG.accredited_it_only and not det.get("accredited_it_employer"):
                            state.rating_skipped = getattr(state, "rating_skipped", 0) + 1
                            continue
                # Employer rating gate: пропускаем низкорейтинговых работодателей.
                # Только если у нас есть employer_id (OAuth-сбор всегда даёт,
                # cookie-сбор — если SSR HTML содержит /employer/{id} ссылку).
                if (CONFIG.min_employer_rating > 0 or CONFIG.min_recommendations_percent > 0):
                    eid = meta.get("employer_id", "")
                    if eid:
                        rating_info = fetch_employer_rating(acc, eid)
                        if rating_info and rating_info.get("reviews_count", 0) >= CONFIG.min_employer_reviews:
                            if (CONFIG.min_employer_rating > 0
                                and rating_info.get("rating", 0) < CONFIG.min_employer_rating):
                                state.rating_skipped = getattr(state, "rating_skipped", 0) + 1
                                continue
                            if (CONFIG.min_recommendations_percent > 0
                                and rating_info.get("recommendations_percent", 0) < CONFIG.min_recommendations_percent):
                                state.rating_skipped = getattr(state, "rating_skipped", 0) + 1
                                continue
                        # Cache hit для UI / Apply tab
                        if rating_info:
                            meta["employer_rating"] = rating_info
                filtered.append(vid)

            state.last_search_at = datetime.now().astimezone().isoformat()
            state.cycle_summary = {"found": len(unique_vacancies), "eligible": len(filtered),
                                   "already": already_count, "tests": test_count,
                                   "filtered": max(0, len(unique_vacancies) - len(filtered) - already_count - test_count)}

            # Приоритизация: свежие → favorited → quick-response → остальные.
            # Сначала перемешиваем, чтобы старые вакансии одного класса не имели
            # постоянного перекоса из-за порядка set, затем stable-sort по стратегии.
            fav_set = getattr(state, "_favorited_ids", set()) or set()
            if filtered:
                random.shuffle(filtered)
                def _bucket(v):
                    meta = state.vacancy_meta.get(v, {}) or {}
                    fresh = CONFIG.fresh_vacancies_mode and _is_fresh_vacancy(
                        meta, CONFIG.fresh_vacancy_hours)
                    published = _vacancy_published_at(meta)
                    published_score = -(published.timestamp()) if published else 0
                    return (
                        0 if fresh else 1,
                        0 if v in fav_set else 1,
                        0 if CONFIG.prefer_quick_responses and meta.get("quick_responses_allowed") else 1,
                        published_score if fresh else 0,
                    )
                filtered.sort(key=_bucket)

            sal_msg = f", \U0001f4b0 зарплата {salary_skipped}" if CONFIG.min_salary > 0 else ""
            sched_msg = (
                f", \U0001f3e2 формат {schedule_skipped}"
                if (CONFIG.allowed_schedules or (has_resume_work_format_rule and resume_work_formats))
                else ""
            )
            title_msg = f", \U0001f3f7️ заголовок {title_skipped}" if title_skipped else ""
            employer_msg = f", \U0001f3e2 работодатель {employer_skipped}" if employer_skipped else ""
            discard_msg = f", \U0001f6ab отказали {discard_skipped}" if discard_skipped else ""
            unsafe_msg = f", \u26a0\ufe0f сомнительные/redirect {unsafe_skipped}" if unsafe_skipped else ""
            rating_msg = f", ⭐ рейтинг {state.rating_skipped}" if state.rating_skipped else ""
            rating_msg += f", 📅 старше {CONFIG.search_period_days} дн {old_skipped}" if old_skipped else ""
            self._add_log(
                state.short, state.color,
                f"\U0001f50d Фильтрация: ✅ уже {already_count}, \U0001f9ea тест {test_count}{sal_msg}{sched_msg}{title_msg}{employer_msg}{discard_msg}{unsafe_msg}{rating_msg}, \U0001f195 новые {len(filtered)}",
                "info",
            )

            if not filtered:
                state.status = "waiting"
                state.status_detail = "Нет новых вакансий"
                self._add_log(
                    state.short, state.color,
                    f"⚠️ Все вакансии уже обработаны ({already_count} откликов, {test_count} тестов), пауза 2 мин",
                    "warning",
                )
                if self._wait_between_cycles(state, 120):
                    return
                continue

            # Hot leads priority: fetch possible_job_offers and put matching vacancies first
            try:
                offer_vids = self._hot_lead_vids(acc)
                if offer_vids:
                    # Hot leads выше внутри своей freshness-категории, но
                    # старый hot lead не вытесняет только что опубликованную вакансию.
                    filtered.sort(key=lambda v: (
                        0 if (CONFIG.fresh_vacancies_mode and _is_fresh_vacancy(
                            state.vacancy_meta.get(v, {}) or {}, CONFIG.fresh_vacancy_hours)) else 1,
                        0 if v in offer_vids else 1,
                    ))
                    hot = [v for v in filtered if v in offer_vids]
                    if hot:
                        self._add_log(state.short, state.color,
                            f"\U0001f525 {len(hot)} горячих лидов в начале очереди", "success")
            except Exception:
                pass

            state.vacancies_queue = filtered
            state.total_vacancies = len(filtered)
            state.found_vacancies += len(all_vacancies)

            self._add_log(
                state.short, state.color,
                f"✅ Найдено {len(filtered)} новых вакансий для отклика!",
                "success",
            )
            self.vacancy_queues[state.short] = {
                "vacancies": filtered,
                "current": 0,
                "color": state.color,
            }

            # === ОТПРАВКА ОТКЛИКОВ (ПАКЕТАМИ) ===
            state.status = "applying"
            state.status_detail = f"0/{state.total_vacancies}"

            batch_size = CONFIG.batch_responses
            i = 0

            while i < len(filtered):
                if (self._stop_event.is_set() or self.paused or state.paused
                        or state.limit_exceeded or getattr(state, "_deleted", False)
                        or _apply_context_key(state.acc) != cycle_context):
                    break

                self._maybe_roll_daily_counter(state)
                batch = _cap_apply_batch(filtered[i: i + batch_size],
                                         state.daily_sent, state.hh_today_applies)
                if not batch:
                    break
                state.current_vacancy_idx = i + 1
                state.status_detail = (
                    f"{i + 1}-{min(i + batch_size, len(filtered))}/{state.total_vacancies}"
                )

                if state.short in self.vacancy_queues:
                    self.vacancy_queues[state.short]["current"] = i

                # Daily limit check
                if self._maybe_roll_daily_counter(state):
                    # Cleanup unbounded dicts on new day
                    if len(state._test_failures) > 500:
                        state._test_failures.clear()
                    if len(state._msg_consecutive) > 500:
                        state._msg_consecutive.clear()
                if CONFIG.daily_apply_limit > 0 and state.daily_sent >= CONFIG.daily_apply_limit:
                    state.hard_stopped = True
                    state.paused = True
                    state.paused_reason = "limit"  # чтобы midnight-rollover мог снять
                    state.status = "limit"
                    state.status_detail = f"Дневной лимит: {state.daily_sent}/{CONFIG.daily_apply_limit}. Сброс завтра в 00:00"
                    self._add_log(state.short, state.color,
                        f"\U0001f6d1 Дневной лимит {CONFIG.daily_apply_limit} откликов. Пауза до завтра 00:00.", "error")
                    break
                # Pre-flight HH-лимит: если фактический счётчик от HH достиг порога —
                # не сжигаем «холостой» отклик чтобы узнать. Дождёмся либо tracker
                # сброса либо ручного toggle.
                _hh_limit = CONFIG.hh_daily_limit or 200
                if state.hh_today_applies and state.hh_today_applies >= _hh_limit:
                    state.hard_stopped = True
                    state.paused = True
                    state.paused_reason = "limit"
                    state.status = "limit"
                    state.status_detail = f"HH-лимит: {state.hh_today_applies}/{_hh_limit}. Сброс в 00:00 МСК"
                    self._add_log(state.short, state.color,
                        f"\U0001f6d1 HH daily-limit {_hh_limit} достигнут ({state.hh_today_applies} откликов). Пауза.", "error")
                    break

                # Защищённый остаток: старые вакансии могут расходовать лимит
                # только до ceiling-reserve. Свежие допускаются до полного
                # дневного ceiling. Это ожидание, не pause: следующий цикл снова
                # соберёт поиск и немедленно увидит новые публикации.
                if CONFIG.fresh_vacancies_mode:
                    ceiling = _effective_daily_ceiling()
                    reserve = min(max(int(CONFIG.fresh_apply_reserve), 0), ceiling)
                    used = max(int(state.daily_sent or 0), int(state.hh_today_applies or 0))
                    # Перед границей резерва принудительно учитываем ручные
                    # отклики и отклики из другого процесса/устройства.
                    if used >= max(0, ceiling - reserve - max(int(batch_size), 1)):
                        exact = fetch_negotiations_today_count(acc, force=True)
                        if exact and exact.get("msk_date") == _today_msk():
                            server_used = max(int(exact.get("today") or 0), 0)
                            with state._state_lock:
                                state.hh_today_applies = server_used
                                state.hh_today_applies_updated = datetime.now().isoformat(timespec="seconds")
                            used = max(used, server_used)
                    protected_batch, deferred_old = _protect_fresh_batch(
                        batch, state.vacancy_meta,
                        hours=CONFIG.fresh_vacancy_hours,
                        ceiling=ceiling,
                        reserve=reserve,
                        used=used,
                    )
                    if deferred_old:
                        state.fresh_reserved_skipped += deferred_old
                    batch = protected_batch
                    if not batch:
                        state.status = "waiting"
                        state.status_detail = f"Резерв {reserve} откликов для свежих вакансий"
                        self._add_log(
                            state.short, state.color,
                            f"🆕 Резерв: старые вакансии отложены; {reserve} слотов сохранено для публикаций ≤{CONFIG.fresh_vacancy_hours}ч",
                            "info",
                        )
                        break

                # Pre-check: skip inconsistent vacancies if enabled
                if state.safety_enabled:
                    checked_batch = []
                    for vid in batch:
                        if (self.paused or self._stop_event.is_set() or state.paused
                                or getattr(state, "_deleted", False)
                                or _apply_context_key(state.acc) != cycle_context):
                            break
                        precheck = get_client(acc).check_vacancy_before_apply(vid)
                        if not precheck["ok"]:
                            reason = precheck.get('reason') or ', '.join(precheck.get('hard_missing', []))
                            state.safety_inconsistent_skipped += 1
                            state.safety_last_reason = f"{vid}: {reason}"
                            meta = state.vacancy_meta.get(vid, {})
                            display_title = (meta.get("title") or vid)[:40]
                            self._add_log(state.short, state.color,
                                f"⏭ {display_title}: пропуск ({reason})", "warning")
                        else:
                            if precheck.get("soft_missing"):
                                self._add_log(state.short, state.color,
                                    f"⚠️ {vid}: можно откликнуться; рекомендуется: {', '.join(precheck['soft_missing'])}", "warning")
                            checked_batch.append(vid)
                            # Обогащаем vacancy_meta полями popup'а (letter_max_length,
                            # test_required, ai_assistant_enabled) — используются на этапе
                            # отправки для обрезки письма и адаптации LLM-prompt'а.
                            extras = precheck.get("extras") or {}
                            if extras:
                                meta = state.vacancy_meta.setdefault(vid, {})
                                for k, v in extras.items():
                                    if v is not None:
                                        meta[k] = v
                            # Collect HR contact info if available
                            contact = precheck.get("contact")
                            if contact and (contact.get("email") or contact.get("fio")):
                                meta = state.vacancy_meta.get(vid, {})
                                entry = {
                                    "vacancy_id": vid,
                                    "title": meta.get("title", ""),
                                    "company": meta.get("company", ""),
                                    "fio": contact.get("fio", ""),
                                    "email": contact.get("email", ""),
                                    "phone": contact.get("phone", ""),
                                    "time": datetime.now().strftime("%Y-%m-%d %H:%M"),
                                    "account": state.short,
                                }
                                with self._hr_contacts_lock:
                                    if len(self.hr_contacts) < 500:
                                        self.hr_contacts.append(entry)
                    batch = checked_batch
                    if not batch:
                        i += batch_size
                        continue

                if len(batch) > 1:
                    self._add_log(
                        state.short, state.color,
                        f"\U0001f4e4 Пакет {len(batch)} откликов: {', '.join(batch[:3])}{'...' if len(batch) > 3 else ''}",
                        "info",
                    )

                # Choose apply method: OAuth API or Web (per-account or global).
                # Также форс-OAuth в degraded mode (cookies dead, токен живой).
                if self.paused or self._stop_event.is_set() or state.paused or state._deleted:
                    break
                if state.use_oauth or CONFIG.use_oauth_apply or state.degraded_mode:
                    # OAuth: synchronous, one by one (API doesn't support batch)
                    results = self._send_oauth_batch(state, acc, batch, cycle_context)
                else:
                    # Web: async batch via aiohttp
                    client = get_client(acc)
                    def _make_send_batch(b):
                        async def guarded_send(vid):
                            if not self._dispatch_allowed(state, cycle_context):
                                return "cancelled", {}
                            return await client.submit_response(
                                vid, letter_max_length=state.vacancy_meta.get(vid, {}).get("letter_max_length"))
                        async def send_batch():
                            tasks = [guarded_send(vid) for vid in b]
                            return await asyncio.gather(*tasks, return_exceptions=True)
                        return send_batch
                    results = asyncio.run(_make_send_batch(batch)())

                # Persist confirmed successes first, even if stop/limit arrives
                # while requests are in flight. Error handling below may break.
                completed = _completed_apply_results(batch, results)
                for j, (vid, result_data) in enumerate(completed):
                    # A pause cancels future sends, never accounting for replies
                    # already received from HH.
                    # Любая итерация — это попытка отклика. Запоминаем время,
                    # чтобы UI мог показать «бот живой, последний раз пробовал
                    # 30с назад» даже когда удачных откликов давно не было.
                    state.last_apply_attempt_at = datetime.now().isoformat(timespec="seconds")
                    if isinstance(result_data, Exception):
                        self._record_apply_error(state, vid, "transport_error")
                        self._hold_unconfirmed_submission(state, acc, vid)
                        state.consecutive_errors += 1
                        err_msg = str(result_data)[:60]
                        self._add_log(state.short, state.color, f"❌ {vid}: {err_msg}", "error")
                        self._add_acc_event(state, "❌", "error", vid, "", err_msg)
                        self._check_auto_pause(state)
                        continue

                    result, info = result_data

                    if result == "cancelled":
                        continue

                    if result == "sent":
                        state.sent += 1
                        # Daily counter
                        self._maybe_roll_daily_counter(state)
                        state.daily_sent += 1
                        state.consecutive_errors = 0  # сброс счётчика ошибок
                        state.last_apply_at = datetime.now().isoformat(timespec="seconds")
                        # Дополняем info мета-данными из поиска если API не вернул title
                        if not info.get("title"):
                            meta_fb = state.vacancy_meta.get(vid, {})
                            info = {**meta_fb, **info}
                        add_applied(acc["name"], vid, info)

                        # Collect HR contact if available
                        contact = info.get("contact", {})
                        if contact and (contact.get("email") or contact.get("fio")):
                            with self._hr_contacts_lock:
                                if len(self.hr_contacts) < 500:
                                    self.hr_contacts.append({
                                        "vacancy_id": vid,
                                        "title": info.get("title", ""),
                                        "company": info.get("company", ""),
                                        "fio": contact.get("fio", ""),
                                        "email": contact.get("email", ""),
                                        "phone": contact.get("phone", ""),
                                        "time": datetime.now().strftime("%Y-%m-%d %H:%M"),
                                        "acc": state.short,
                                    })

                        title = info.get("title", "Неизвестно")
                        company = info.get("company", "?")
                        sal_from = info.get("salary_from")
                        sal_to = info.get("salary_to")
                        salary = ""
                        if sal_from or sal_to:
                            salary = f"{sal_from or '?'} - {sal_to or '?'}"

                        state.current_vacancy_title = title
                        state.current_vacancy_company = company
                        self._push_action(state, f"✅ {title[:30]}")

                        self._add_response(state, vid, title, company, "sent", salary)
                        self._add_log(
                            state.short, state.color,
                            f"✅ {title[:40]} @ {company[:20]}",
                            "success",
                        )
                        self._add_acc_event(state, "✅", "sent", title or vid, company,
                                            salary if salary else "")

                    elif result == "test":
                        if not self._dispatch_allowed(state, cycle_context):
                            continue
                        title = info.get("title", "")
                        company = info.get("company", "")
                        display_title = title[:40] if title else vid

                        if not (state.apply_tests or CONFIG.auto_apply_tests):
                            # Откликаться на тесты выключено — пропускаем
                            state.tests += 1
                            add_test_vacancy(vid, title, company,
                                             acc["name"], acc.get("resume_hash", ""))
                            self._push_action(state, f"⏭️ {display_title[:25]}")
                            self._add_response(state, vid, title, company, "test")
                            self._add_log(state.short, state.color,
                                          f"⏭️ Тест пропущен: {display_title}", "info")
                            self._add_acc_event(state, "⏭️", "test_skip",
                                                title or vid, company, "пропущено")
                        else:
                            # Пробуем автозаполнить опрос
                            q_result, q_info = asyncio.run(get_client(acc).fill_questionnaire(
                                vid, vacancy_title=title, company=company))
                            if q_result == "cancelled":
                                continue
                            if q_result == "sent":
                                state.sent += 1
                                state.questionnaire_sent += 1
                                state.consecutive_errors = 0
                                # Daily counter
                                self._maybe_roll_daily_counter(state)
                                state.daily_sent += 1
                                state.current_vacancy_title = title
                                state.current_vacancy_company = company
                                self._push_action(state, f"\U0001f4dd {display_title[:25]}")
                                self._add_response(state, vid, title, company, "sent")
                                self._add_log(state.short, state.color,
                                              f"\U0001f4dd Опрос пройден: {display_title}", "success")
                                q_info_full = {**state.vacancy_meta.get(vid, {}), **info}
                                add_applied(acc["name"], vid, q_info_full)
                                answer_preview = questionnaire_default_answer()[:50]
                                self._add_acc_event(state, "\U0001f4dd", "questionnaire",
                                                    title or vid, company,
                                                    f"Ответ: {answer_preview}")
                            elif q_result == "limit":
                                state.limit_exceeded = True
                                state.limit_reset_time = datetime.now() + timedelta(
                                    minutes=CONFIG.limit_check_interval
                                )
                                state.status = "limit"
                                state.status_detail = f"Проверка в {state.limit_reset_time.strftime('%H:%M')}"
                                self._add_log(state.short, state.color,
                                              f"\U0001f6ab ЛИМИТ при опросе! Повторная попытка в {state.limit_reset_time.strftime('%H:%M')}",
                                              "error")
                                continue
                            elif q_result == "auth_error":
                                log_debug(f"AUTH_ERROR [{state.short}] vid={vid} flow=questionnaire")
                                state.cookies_expired = True
                                state.paused = True
                                state.paused_reason = "auth"
                                self._persist_protective_pause(state)
                                self._add_log(
                                    state.short, state.color,
                                    "⚠️ Куки протухли! Обновите куки и снимите паузу.", "error",
                                )
                                self._add_acc_event(state, "⚠️", "error", "Авторизация", "", "Обновите куки")
                                continue
                            elif q_result == 'error':
                                # A transport/confirmation error does not mean
                                # the applicant failed the employer's test.
                                reason = q_info.get('error_code') or q_info.get('exception') or 'HTTP error'
                                self._record_apply_error(state, vid, "questionnaire_unconfirmed", q_info)
                                state.paused = True
                                # Отдельная причина: это не ручная пауза пользователя,
                                # а анкета, судьбу которой надо проверить в HH.
                                state.paused_reason = 'review'
                                self._persist_protective_pause(state)
                                self._add_response(state, vid, title, company, 'error')
                                self._add_log(state.short, state.color,
                                              f'Анкета: результат не подтверждён ({reason}). Пауза: проверьте отклик в HH перед продолжением.', 'warning')
                                # Hold ambiguous submissions for manual review;
                                # never blindly resend a potentially accepted form.
                                add_test_vacancy(vid, title, company, acc['name'], acc.get('resume_hash', ''), status='review')
                            else:
                                # Не удалось — считаем неудачи
                                state._test_failures[vid] = state._test_failures.get(vid, 0) + 1
                                if state._test_failures[vid] >= 2:
                                    # Permanently mark as failed test after 2 attempts
                                    add_test_vacancy(vid, title, company,
                                                     acc["name"], acc.get("resume_hash", ""))
                                state.tests += 1
                                self._push_action(state, f"\U0001f9ea {display_title[:25]}")
                                self._add_response(state, vid, title, company, "test")
                                self._add_log(state.short, state.color,
                                              f"\U0001f9ea Тест (не пройден, попытка {state._test_failures[vid]}): {display_title}", "warning")
                                self._add_acc_event(state, "\U0001f9ea", "test",
                                                    title or vid, company, "не пройден")

                    elif result == "already":
                        state.already_applied += 1
                        already_info = state.vacancy_meta.get(vid, {})
                        add_applied(acc["name"], vid, already_info if already_info else None, confirmed=False)
                        self._push_action(state, f"\U0001f504 {vid}")
                        self._add_response(state, vid, "", "", "already")

                    elif result == "limit" and (info or {}).get("rate_limited"):
                        # 429: HH просит реже, дневной лимит тут ни при чём.
                        wait_s = max(int((info or {}).get("retry_after") or 0), 120)
                        log_debug(f"HH_RATE_LIMIT [{state.short}] vid={vid} wait={wait_s}s")
                        state.limit_exceeded = True
                        state.limit_reset_time = datetime.now() + timedelta(seconds=wait_s)
                        state.status = "limit"
                        state.status_detail = f"HH просит реже: пауза до {state.limit_reset_time.strftime('%H:%M')}"
                        self._add_log(
                            state.short, state.color,
                            f"🐢 HH ограничил частоту запросов (429). Продолжу в {state.limit_reset_time.strftime('%H:%M')}",
                            "warning",
                        )
                        continue

                    elif result == "limit":
                        log_debug(f"HH_LIMIT [{state.short}] vid={vid} retry_after={info.get('retry_after_seconds', '?')}")
                        state.limit_exceeded = True
                        if CONFIG.stop_on_hh_limit:
                            # Hard stop — no retries
                            state.hard_stopped = True
                            state.paused = True
                            # paused_reason="limit" — чтобы _maybe_roll_daily_counter
                            # автоматически снял паузу в полночь МСК. Без этого
                            # бот сидел на паузе несколько дней подряд (bug fix).
                            if state.paused_reason not in ("review", "captcha", "auth", "manual"):
                                state.paused_reason = "limit"
                            state.status = "limit"
                            state.status_detail = "\U0001f6d1 Лимит HH — остановлен до 00:00 МСК"
                            self._add_log(
                                state.short, state.color,
                                f"\U0001f6d1 ЛИМИТ HH! Бот остановлен. Автоматический сброс в 00:00 МСК.",
                                "error",
                            )
                        else:
                            state.limit_reset_time = datetime.now() + timedelta(
                                minutes=CONFIG.limit_check_interval
                            )
                            state.status = "limit"
                            state.status_detail = f"Проверка в {state.limit_reset_time.strftime('%H:%M')}"
                            self._add_log(
                                state.short, state.color,
                                f"\U0001f6ab ЛИМИТ! Повторная попытка в {state.limit_reset_time.strftime('%H:%M')}",
                                "error",
                            )
                        continue

                    elif result == "captcha":
                        with state._state_lock:
                            state.paused = True
                            if state.paused_reason != "review":
                                state.paused_reason = "captcha"
                            state.captcha_url = info.get("captcha_url", "")
                        self._persist_protective_pause(state)
                        self._add_log(state.short, state.color,
                                      "HH требует CAPTCHA при отклике. Откройте проверку в карточке профиля.", "warning")
                        self._add_acc_event(state, "⚠️", "error", "Проверка HH", "", "captcha_required")
                        continue

                    elif result == "auth_error":
                        oauth_capable = (
                            state.use_oauth
                            or CONFIG.use_oauth_apply
                            or (state.degraded_fallback_enabled and bool(acc.get("resume_hash")))
                        )
                        if oauth_capable:
                            # Cookies истекли, но OAuth доступен — переходим на degraded
                            # путь: выходим из батча, следующий цикл соберёт через
                            # api.hh.ru и применит через _oauth_apply.
                            if not getattr(state, '_web_auth_warned', False):
                                self._add_log(
                                    state.short, state.color,
                                    "⚠️ Web cookies истекли → переключаюсь на OAuth API", "warning",
                                )
                                state._web_auth_warned = True
                            log_debug(f"AUTH_ERROR [{state.short}] vid={vid} flow=apply → degraded")
                            state.cookies_expired = True
                            # Прервать текущий батч cookie-applies, не пытаемся снова
                            # тем же путём в этом цикле.
                            continue
                        else:
                            log_debug(f"AUTH_ERROR [{state.short}] vid={vid} flow=apply")
                            state.cookies_expired = True
                            state.paused = True
                            if state.paused_reason != "review":
                                state.paused_reason = "auth"
                            self._persist_protective_pause(state)
                            self._add_log(
                                state.short, state.color,
                                "⚠️ Куки протухли! Обновите куки и снимите паузу.", "error",
                            )
                            self._add_acc_event(state, "⚠️", "error", "Авторизация", "", "Обновите куки")
                            continue

                    elif result == "error":
                        self._record_apply_error(state, vid, "submission_unconfirmed", info)
                        if info.get("review_required"):
                            self._hold_unconfirmed_submission(state, acc, vid)
                        self._push_action(state, f"❌ {vid}")
                        self._add_response(state, vid, "", "", "error")
                        raw = info.get("raw", "")[:80] if info else ""
                        exc = info.get("exception", "") if info else ""
                        debug_info = raw or exc or "unknown"
                        # HH иногда возвращает {"error":"unknown"} — это его сервер-сайд сбой,
                        # не наша проблема (сеть/куки OK). Не растим consecutive_errors чтобы
                        # auto_pause не срабатывал зря — тогда все успешные отклики в этом
                        # батче не бракуются `if state.paused: break` циклом ниже.
                        transient = 'error_code' in (info or {}) and (info or {}).get('error_code') == 'unknown'
                        transient = transient or 'unknown' in raw.lower()[:40]
                        # Временные сбои HH (5xx), удалённая вакансия (404) и отказ
                        # по правилам конкретной вакансии (403) — не проблема
                        # профиля: не копим их в «ошибки подряд» → авто-паузу.
                        transient = transient or bool((info or {}).get("transient"))
                        transient = transient or (info or {}).get("http_status") in (403, 404)
                        if not transient:
                            state.consecutive_errors += 1
                        self._add_log(state.short, state.color, f"❌ {vid}: {debug_info}", "error")
                        self._add_acc_event(state, "❌", "error", vid, "", debug_info[:60])
                        self._check_auto_pause(state)

                if state.limit_exceeded:
                    break
                # Cookies протухли в этом цикле — выходим из всего apply-цикла,
                # на следующем тике воркер пойдёт OAuth-путём.
                if state.cookies_expired:
                    break

                i += batch_size
                if i < len(filtered):
                    time.sleep(CONFIG.response_delay)

            # Очистка
            state.current_vacancy_title = ""
            state.current_vacancy_company = ""
            if state.short in self.vacancy_queues:
                self.vacancy_queues[state.short] = {
                    "vacancies": [],
                    "current": 0,
                    "color": state.color,
                }

            if state.paused:
                # Show the pause reason immediately instead of hiding it behind
                # the normal (potentially long) inter-cycle sleep.
                continue
            if _apply_context_key(state.acc) != cycle_context:
                # A settings edit is not a completed cycle: rebuild immediately.
                continue
            if not state.limit_exceeded:
                state.status = "waiting"
                state.status_detail = "Цикл завершён"
                self._add_log(
                    state.short, state.color,
                    f"⏳ Цикл завершён, пауза {CONFIG.pause_between_cycles}с",
                    "info",
                )
                if self._wait_between_cycles(state, CONFIG.pause_between_cycles):
                    return

    def _hh_limit_tracker_worker(self):
        """Каждые 30 мин дёргает GET /negotiations через OAuth, считает реальное
        число сегодняшних откликов для каждого активного аккаунта.

        - Синхронизирует state.hh_today_applies = truth count из HH
        - Если бот был hard_stopped, но фактический count < CONFIG.hh_daily_limit —
          снимает hard_stopped/paused (auto-recovery, не ждём midnight).
        - На rollover в полночь MSK HH сам обнулит count → автоматически снимется.
        """
        # После рестарта быстро добираем из HH ручные/внешние отклики.
        if self._stop_event.wait(5):
            return
        while not self._stop_event.is_set():
            try:
                from datetime import datetime
                # Все активные state'ы (regular + temp)
                states = list(self.account_states) + list(self.temp_states.values())
                for state in states:
                    if not state.acc.get("resume_hash"):
                        continue
                    info = fetch_negotiations_today_count(state.acc, force=True)
                    if not info or info.get('msk_date') != _today_msk():
                        continue
                    count = info.get("today", 0)
                    with state._state_lock:
                        state.hh_today_applies = count
                        state.hh_today_applies_updated = datetime.now().isoformat(timespec="seconds")
                    # Streak-геймификация HH через mobile-endpoint (bonus поле для UI).
                    try:
                        streak = fetch_negotiations_statistic(state.acc)
                        if streak:
                            with state._state_lock:
                                state.responses_streak_count = streak.get("responses_count", 0)
                                state.responses_streak_required = streak.get("responses_required", 0)
                    except Exception as _e:
                        log_debug(f"streak fetch [{state.short}]: {_e}")
                    # Auto-recovery: если стоим в лимит-stop, а реально count < лимит
                    limit = _effective_daily_ceiling()
                    if (state.hard_stopped or state.paused_reason == "limit") and max(count, state.daily_sent) < limit - 5:
                        # 5-вакансиевый запас на гонку с in-flight откликами
                        with state._state_lock:
                            if state._deleted or max(count, state.daily_sent) >= limit - 5:
                                continue
                            state.hard_stopped = False
                            state.limit_exceeded = False
                            state.limit_reset_time = None
                            if state.paused and state.paused_reason == "limit":
                                state.paused = False
                                state.paused_reason = ""
                            # Local confirmed sends may be newer than this HTTP
                            # snapshot. Never roll them back during recovery.
                        self._add_log(
                            state.short, state.color,
                            f"✅ HH-лимит снят: фактически {count}/{limit} откликов сегодня (auto-recovery)",
                            "success",
                        )
            except Exception as e:
                log_debug(f"HH limit tracker error: {e}")
            # Пять минут: небольшой drift без лишней нагрузки на HH.
            if self._stop_event.wait(300):
                return

    def _oauth_refresh_worker(self):
        """Proactive OAuth refresh: каждые 6ч пробегает все сохранённые токены и
        обновляет те, у которых < 48ч до истечения. Идея — не дать
        refresh_token (TTL ~14 дней) самому истечь когда аккаунт не активен."""
        # Первый запуск через 60с после старта — даём lazy-refresh успеть
        # отработать после restart'а перед нашим вмешательством.
        if self._stop_event.wait(60):
            return
        while not self._stop_event.is_set():
            try:
                stats = refresh_oauth_tokens_proactive(min_ttl_hours=48)
                if stats["refreshed"] or stats["failed"]:
                    log_debug(
                        f"OAuth refresh worker: checked={stats['checked']} "
                        f"refreshed={stats['refreshed']} failed={stats['failed']}"
                    )
            except Exception as e:
                log_debug(f"OAuth refresh worker error: {e}")
            # 6 hours между запусками
            if self._stop_event.wait(6 * 3600):
                return

    def _collect_via_oauth_api(self, state: AccountState, acc: dict | None = None) -> tuple:
        """Degraded-mode collection via api.hh.ru/vacancies with Bearer token.
        Used when cookies are dead but OAuth refresh_token still valid.

        URL pool entries (hh.ru/search/vacancy?text=...) → api.hh.ru/vacancies?{same params}.
        HH preserves identical query-string parameter names between the search UI and
        the public OAuth API, so we can just swap host and forward the params.

        Returns the same (results_by_url, salary_map, schedule_map) shape as the cookie
        collector. Also writes has_test / response_letter_required into vacancy_meta so
        the apply loop can skip vacancies we can't fulfil without cookies.
        """
        acc = state.acc if acc is None else acc
        effective_urls = _search_urls(acc)
        results_by_url = {url: [] for url in effective_urls}
        salary_map: dict = {}
        schedule_map: dict = {}
        total_pages = 0
        completed = 0
        # Mobile collection has one authoritative page limit. Old
        # browser_sessions/url_pool overrides must not silently request more
        # pages than the value currently shown in Settings.
        try:
            configured_pages = max(1, min(int(CONFIG.pages_per_url), 20))
        except (TypeError, ValueError):
            configured_pages = 1
        resume_profile = normalize_resume_filters(acc.get("resume_filters")).get(
            str(acc.get("resume_hash", "")), {}
        )
        experience_override = "experience" in resume_profile
        experience_values = (
            list(resume_profile.get("experience") or [])
            if experience_override and resume_profile.get("experience")
            else [None]
        )
        format_override = "allowed_work_formats" in resume_profile
        work_format_values = (
            list(resume_profile.get("allowed_work_formats") or [])
            if format_override and resume_profile.get("allowed_work_formats")
            else [None]
        )
        total_pages = (
            len(effective_urls) * len(experience_values) * len(work_format_values)
        )
        log_debug(
            f"MOBILE_COLLECT_CONFIG [{state.short}] configured_pages={configured_pages} "
            f"urls={len(effective_urls)}"
        )
        # Translate one search URL → OAuth API request
        for url in effective_urls:
            pages = configured_pages
            text, area, query = parse_search_url(url)
            query = _mobile_search_filters(query)
            ids_for_url: set = set()
            if state._deleted:
                break
            for experience_value in experience_values:
                for work_format_value in work_format_values:
                    request_query = dict(query)
                    if experience_override:
                        request_query.pop("experience", None)
                        if experience_value:
                            request_query["experience"] = experience_value
                    if format_override:
                        request_query.pop("work_format", None)
                        request_query.pop("schedule", None)
                        if work_format_value:
                            request_query["work_format"] = work_format_value
                    try:
                        # Ограничение передаём внутрь клиента: он не должен сначала
                        # загрузить 20 страниц, а затем выбросить лишние результаты.
                        items = get_client(acc).search_vacancies(
                            text, area_id=area, per_page=50, page=0, filters=request_query,
                            max_pages=pages)
                        # Defensive cap для сторонних реализаций контракта.
                        items = items[:pages * 50]
                        completed += 1
                        state.status_detail = f"Поисковые запросы: {min(completed, total_pages)} из {total_pages}"
                        for it in items:
                            vid = str(it.get("id") or "")
                            if not vid:
                                continue
                            ids_for_url.add(vid)
                            # Build meta entry — mirror parse_vacancy_meta shape
                            meta_entry = state.vacancy_meta.setdefault(vid, {})
                            meta_entry["title"] = it.get("name", "") or meta_entry.get("title", "")
                            if it.get("experience"):
                                meta_entry["experience"] = it["experience"]
                            emp = it.get("employer") or {}
                            meta_entry["company"] = emp.get("name", "") or meta_entry.get("company", "")
                            meta_entry["employer_id"] = str(it.get("employer_id") or emp.get("id") or "") or meta_entry.get("employer_id", "")
                            meta_entry["has_test"] = bool(it.get("has_test"))
                            meta_entry["response_letter_required"] = bool(it.get("response_letter_required"))
                            meta_entry["published_at"] = it.get("published_at") or it.get("created_at") or ""
                            meta_entry["created_at"] = it.get("created_at") or ""
                            meta_entry["archived"] = bool(it.get("archived"))
                            meta_entry["misleading_vacancy_alert"] = bool(it.get("misleading_vacancy_alert"))
                            meta_entry["immediate_redirect_vacancy_id"] = str(
                                it.get("immediate_redirect_vacancy_id") or ""
                            )
                            meta_entry["is_adv"] = bool(it.get("is_adv"))
                            if experience_value:
                                buckets = list(meta_entry.get("experience_filters") or [])
                                if experience_value not in buckets:
                                    buckets.append(experience_value)
                                meta_entry["experience_filters"] = buckets
                            if work_format_value:
                                buckets = list(meta_entry.get("work_format_filters") or [])
                                if work_format_value not in buckets:
                                    buckets.append(work_format_value)
                                meta_entry["work_format_filters"] = buckets
                            actual_formats = _work_format_ids(it.get("work_format"))
                            if actual_formats:
                                buckets = list(meta_entry.get("work_formats") or [])
                                for actual_format in actual_formats:
                                    if actual_format not in buckets:
                                        buckets.append(actual_format)
                                meta_entry["work_formats"] = buckets
                            salary_map[vid] = _salary_rub(it.get("salary"))
                            sch = it.get("schedule")
                            if isinstance(sch, dict) and sch.get("id"):
                                schedule_map.setdefault(vid, set()).add(sch["id"])
                    except Exception as e:
                        log_debug(f"OAuth collect error [{state.short}]: {e}")
            results_by_url[url] = ids_for_url
        return results_by_url, salary_map, schedule_map

    async def _collect_all_urls_parallel(self, state: AccountState, acc: dict | None = None) -> tuple:
        """
        Параллельный сбор вакансий со ВСЕХ URL и страниц одновременно.
        Возвращает (results_by_url: dict[url, set[ids]], salary_map: dict[vid, int|None], schedule_map: dict[vid, set])
        """
        acc = state.acc if acc is None else acc
        xsrf = acc.get("cookies", {}).get("_xsrf", "")
        if not xsrf:
            return {}, {}, {}
        headers = get_headers(xsrf)
        sem = asyncio.Semaphore(CONFIG.max_concurrent * 3)

        # Единый egress: collect тоже идёт через HH_PROXY, если задан (audit HIGH #5).
        # Общие helpers из app.hh_http (split-egress): socks → ProxyConnector,
        # http(s) → proxy= на каждый запрос.
        from app.hh_http import _aio_proxy, _aio_session_connector
        proxy = _aio_proxy()
        # socks → ProxyConnector(limit=...); http(s)/пусто → None
        connector = _aio_session_connector(proxy, limit=CONFIG.max_concurrent * 3)
        collect_req_kw: dict = {}
        if connector is None:
            # enable_cleanup_closed=True — закрывает половинно-закрытые TCP keep-alive
            # подключения (HH иногда дропает их), иначе fetch падает с ServerDisconnectedError.
            connector = aiohttp.TCPConnector(
                limit=CONFIG.max_concurrent * 3,
                enable_cleanup_closed=True,
            )
            if proxy:
                collect_req_kw = {"proxy": proxy}

        all_tasks = []
        url_pages = _url_pages_map()
        acc_url_pages = acc.get("url_pages", {})  # per-account override
        effective_urls = _search_urls(acc)
        # Build extra search filter params from config
        # Note: HH only accepts ONE label param; low_competition takes priority
        extra_params = ""
        if CONFIG.filter_low_competition:
            extra_params += "&label=low_performance"
        elif CONFIG.filter_agencies:
            extra_params += "&label=not_from_agency"
        if CONFIG.search_period_days > 0:
            extra_params += f"&search_period={CONFIG.search_period_days}"
        resume_profile = normalize_resume_filters(acc.get("resume_filters")).get(
            str(acc.get("resume_hash", "")), {}
        )
        resume_experience = resume_profile.get("experience", [])
        experience_override = "experience" in resume_profile
        experience_values = (
            list(resume_experience)
            if experience_override and resume_experience
            else [None]
        )
        resume_formats = resume_profile.get("allowed_work_formats", [])
        format_override = "allowed_work_formats" in resume_profile
        work_format_values = (
            list(resume_formats)
            if format_override and resume_formats
            else [None]
        )
        for url_idx, url in enumerate(effective_urls):
            pages = acc_url_pages.get(url) or url_pages.get(url, CONFIG.pages_per_url)
            override_keys = set()
            if experience_override:
                override_keys.add("experience")
            if format_override:
                override_keys.add("work_format")
                override_keys.add("schedule")
            search_url = _without_query_keys(url, override_keys) if override_keys else url
            sep = "&" if "?" in search_url else "?"
            for experience_value in experience_values:
                experience_params = (
                    "&" + urllib.parse.urlencode({"experience": experience_value})
                    if experience_value
                    else ""
                )
                for work_format_value in work_format_values:
                    format_params = (
                        "&" + urllib.parse.urlencode({"work_format": work_format_value})
                        if work_format_value
                        else ""
                    )
                    for page in range(pages):
                        page_url = (
                            f"{search_url}{sep}page={page}{extra_params}"
                            f"{experience_params}{format_params}"
                        )
                        all_tasks.append(
                            (url_idx, url, page, page_url, experience_value, work_format_value)
                        )

        total_tasks = len(all_tasks)
        results_by_url = {url: [] for url in effective_urls}
        salary_map = {}
        completed = 0

        # connector передаётся явно — ClientSession его НЕ закрывает,
        # нужен ручной close, иначе утечка socket'ов на каждый цикл (swarm-11 #1).
        async with aiohttp.ClientSession(
            headers=headers, cookies=acc["cookies"], connector=connector,
            connector_owner=True,  # делегируем close обратно сессии
        ) as session:
            async def fetch_one(url_idx, url, page, page_url, experience_value, work_format_value):
                nonlocal completed
                if state._deleted:
                    return url, set(), {}, {}, {}, experience_value, work_format_value
                log_debug(
                    f"COLLECT_PAGE start [{state.short}] mode=web "
                    f"page={page + 1} page_index={page} url={page_url}"
                )
                html = await fetch_page(session, page_url, sem, collect_req_kw)
                completed += 1
                state.status_detail = f"Загрузка {completed}/{total_tasks}"
                if html and _is_login_page(html):
                    if not (state.use_oauth or CONFIG.use_oauth_apply):
                        log_debug(f"AUTH_ERROR [{state.short}] vid=- flow=collect")
                        state.cookies_expired = True
                    return url, set(), {}, {}, {}, experience_value, work_format_value
                if html:
                    ids = parse_ids(html)
                    log_debug(
                        f"COLLECT_PAGE parsed [{state.short}] mode=web "
                        f"page={page + 1} vacancies={len(ids)} url={page_url}"
                    )
                    salaries = parse_salaries(html, ids)
                    meta = parse_vacancy_meta(html)
                    if experience_value:
                        for meta_entry in meta.values():
                            meta_entry.setdefault("experience_filters", []).append(experience_value)
                    if work_format_value:
                        for meta_entry in meta.values():
                            meta_entry.setdefault("work_format_filters", []).append(work_format_value)
                    schedules = parse_work_schedules(html, ids)
                    # Pre-apply стратегические поля из SSR (autoResponse,
                    # chatWritePossibility, HR online). Без extra-fetch'ей —
                    # эти данные уже в HTML поисковой страницы.
                    strat = parse_apply_strategy_meta(html)
                    for vid, sm in strat.items():
                        if vid in meta:
                            meta[vid].update(sm)
                        else:
                            meta[vid] = sm
                    return url, ids, salaries, meta, schedules, experience_value, work_format_value
                log_debug(
                    f"COLLECT_PAGE empty [{state.short}] mode=web "
                    f"page={page + 1} url={page_url}"
                )
                return url, set(), {}, {}, {}, experience_value, work_format_value

            tasks = [
                fetch_one(url_idx, url, page, page_url, experience_value, work_format_value)
                for url_idx, url, page, page_url, experience_value, work_format_value in all_tasks
            ]
            task_results = await asyncio.gather(*tasks, return_exceptions=True)

            schedule_map = {}
            for result in task_results:
                if isinstance(result, Exception):
                    log_debug(f"❌ Ошибка при загрузке: {result}")
                    continue
                url, ids, salaries, meta, schedules, _experience_value, _work_format_value = result
                results_by_url[url].extend(ids)
                salary_map.update(salaries)
                _merge_vacancy_meta(state.vacancy_meta, meta)
                for vid, sched_set in schedules.items():
                    if sched_set:
                        schedule_map.setdefault(vid, set()).update(sched_set)

        return {url: set(ids) for url, ids in results_by_url.items()}, salary_map, schedule_map

    def _llm_processing_allowed(self, state: AccountState) -> bool:
        return bool(state.llm_enabled and CONFIG.llm_enabled
                    and not getattr(self, "paused", False) and not state.paused
                    and not getattr(state, "_deleted", False)
                    and not (getattr(self, "_stop_event", None) and self._stop_event.is_set()))

    def _llm_history(self, state: AccountState, neg_id: str) -> list:
        if state.cookies_expired or CONFIG.chat_use_oauth:
            history = fetch_negotiation_messages_oauth(state.acc, neg_id, max_messages=20)
            if history:
                return history
        return get_client(state.acc).fetch_chat_history(neg_id, max_messages=20)

    def _llm_conversation_unchanged(self, state: AccountState, neg_id: str, original: list) -> bool:
        """Fail closed if the conversation changed or cannot be reloaded."""
        def signature(messages):
            return [(m.get("sender"), m.get("text"), str(m.get("msg_id") or m.get("id") or ""),
                     m.get("actions") or {}) for m in messages]
        try:
            current = self._llm_history(state, neg_id)
            return bool(current) and signature(current) == signature(original)
        except Exception:
            return False

    def _llm_send_allowed(self, state: AccountState) -> bool:
        return self._llm_processing_allowed(state) and bool(CONFIG.llm_auto_send)

    def _process_llm_replies(self, state: AccountState) -> None:
        """Check recent unread negotiations for employer messages and auto-reply using LLM."""
        if not self._llm_processing_allowed(state):
            return
        # Non-blocking: if another thread is already processing this account, skip
        if not state._llm_lock.acquire(blocking=False):
            log_debug(f"LLM [{state.short}]: уже выполняется, пропуск")
            return
        try:
            try:
                self._process_llm_replies_inner(state)
            finally:
                # Live-статус для UI сбрасываем ВСЕГДА — иначе исключение внутри
                # (fetch_chat_list бросил MobileAPIError и т.п.) оставит UI
                # застрявшим на «обрабатывается 5/15» до следующего успешного
                # цикла. Юзер думает что бот повис.
                state.llm_current_neg_id = ""
                state.llm_current_employer = ""
                state.llm_current_idx = 0
                state.llm_current_total = 0
                state.llm_last_check_at = datetime.now().isoformat(timespec="seconds")
                state.llm_next_check_at = (
                    datetime.now() + timedelta(seconds=max(CONFIG.llm_check_interval * 60, 120))
                ).isoformat(timespec="seconds")
        finally:
            state._llm_lock.release()

    def _process_llm_replies_inner(self, state: AccountState) -> None:
        """Inner implementation — called only when _llm_lock is held."""
        replied = 0

        # Sync _llm_no_chat from persisted DB (catches 409 failures from previous sessions)
        state._llm_no_chat.update(get_no_chat_neg_ids())
        # Seed llm_replied_msgs from persisted store ONCE per worker lifetime —
        # повторный merge каждый цикл с обрезкой делал бы trim случайным (set без порядка)
        # и мог выкидывать только что записанные ключи.
        if not getattr(state, "_replied_seeded", False):
            # dict-init: ключи seeded из disk — для них insertion-order не важен (legacy).
            for _k in get_replied_keys():
                state.llm_replied_msgs[_k] = None
            state._replied_seeded = True

        # Memory leak prevention: purge expired temp_skip + cap in-memory sets.
        now_ts = time.time()
        state._llm_temp_skip = {
            k: v for k, v in state._llm_temp_skip.items() if v > now_ts
        }
        if len(state.llm_replied_msgs) > 5000:
            # Hard cap — dict сохраняет insertion order, [-2000:] retains *recent* keys
            # (раньше set делал случайный slice, mid-session re-reply, kimi-r14-2 #11).
            recent = list(state.llm_replied_msgs)[-2000:]
            state.llm_replied_msgs = dict.fromkeys(recent)
        with self._llm_sent_lock:
            if len(self._llm_sent_global) >= 10000:
                # Round-5 #1: раньше `> 10000` создавало boundary trap: ровно
                # на 10000 eviction не запускался, set застревал навсегда если
                # все текущие кандидаты уже в нём (новых add не будет).
                self._llm_sent_global = set(list(self._llm_sent_global)[-5000:])
                # перестраиваем индекс после массовой обрезки
                self._llm_sent_by_neg_id = {}
                for gk in self._llm_sent_global:
                    self._llm_sent_by_neg_id.setdefault(gk[1], set()).add(gk)

        # Fetch recent chat pages sorted by last activity. Chats needing reply
        # (employer just wrote) will always be near the top.
        self._add_log(state.short, state.color, "\U0001f916 LLM: загружаю список чатов…", "info")
        log_debug(f"LLM [{state.short}]: загружаю чат-лист")
        items_by_id, display_info, cur_pid = get_client(state.acc).fetch_chat_list(max_pages=3)
        log_debug(f"LLM [{state.short}]: чат-лист загружен, {len(items_by_id)} чатов")

        # Process items that need a reply: NEGOTIATION type, unread, from employer, not rejection
        candidates = []
        skipped_ours = 0
        skipped_system = 0
        skipped_read = 0
        skipped_locked = 0
        for item_id, item in items_by_id.items():
            if item.get("type") != "NEGOTIATION":
                continue
            unread = item.get("unreadCount", 0)
            last_msg = item.get("lastMessage") or {}
            sender_id = last_msg.get("participantId", "")
            last_text = (last_msg.get("text") or "")[:40]
            wf = last_msg.get("workflowTransition") or {}
            # Аудит 2026-08-17 #27: если cur_pid не определён (пустой ответ
            # /participants от mobile API), раньше from_employer всегда False
            # → чаты с unread=0 от работодателя (ключевой кейс: HR прочитал
            # твоё, ответил, HH сбросил unread) молча пропускались. Без cur_pid
            # достоверно определить нельзя — консервативно считаем sender_id
            # employer'ом (наш ответ всё равно ловится через _llm_sent_global /
            # llm_replied_msgs дедупом на уровне цикла).
            if cur_pid:
                from_employer = bool(sender_id and sender_id != cur_pid)
            else:
                from_employer = bool(sender_id)
            # Early check: known 409 (persisted from DB or current session)
            if item_id in state._llm_no_chat:
                skipped_locked += 1
                log_debug(f"LLM [{state.short}] {item_id}: 409-закрыт, пропуск кандидата")
                continue
            # Early check: HH пометил как DISCARD — нет смысла отвечать, экономим LLM API call.
            if item_id in state.hh_discard_neg_ids:
                skipped_locked += 1
                # Также добавляем в постоянный _llm_no_chat чтобы не проверять каждый цикл.
                state._llm_no_chat.add(item_id)
                log_debug(f"LLM [{state.short}] {item_id}: HH-DISCARD, пропуск кандидата")
                continue
            # Early check: chat locked via text/flags (employer disabled messaging or invite-only)
            if _check_chat_locked(item):
                skipped_locked += 1
                log_debug(f"LLM [{state.short}] {item_id}: чат заблокирован, пропуск кандидата len={len(last_text)}")
                continue
            # Early check: writePossibility from chatik API
            write_poss = (item.get("writePossibility") or {}).get("name", "")
            if write_poss not in ("ENABLED_FOR_ALL", "ENABLED_FOR_ALL_BY_EMPLOYER", ""):
                skipped_locked += 1
                log_debug(f"LLM [{state.short}] {item_id}: writePossibility={write_poss}, пропуск")
                continue
            if unread == 0:
                if from_employer and not wf:
                    last_msg_id_early = str((item.get("lastMessage") or {}).get("id", ""))
                    key_early = (str(item_id), last_msg_id_early)
                    if key_early not in state.llm_replied_msgs:
                        log_debug(f"LLM [{state.short}] {item_id}: unread=0 но от работодателя, не отвечали — добавляю кандидатом: len={len(last_text)}")
                    else:
                        skipped_read += 1
                        di = display_info.get(str(item_id), {})
                        upsert_interview(str(item_id), acc=state.short, acc_color=state.color,
                                         employer=di.get("subtitle", ""), vacancy_title=di.get("title", ""),
                                         chat_status="waiting_hr")
                        log_debug(f"LLM [{state.short}] {item_id}: unread=0, от работодателя, уже отвечали, пропуск: len={len(last_text)}")
                        continue
                else:
                    skipped_read += 1
                    continue
            if cur_pid and sender_id == cur_pid:
                skipped_ours += 1
                log_debug(f"LLM [{state.short}] {item_id}: unread={unread}, последнее наше, пропуск")
                di = display_info.get(str(item_id), {})
                upsert_interview(str(item_id), acc=state.short, acc_color=state.color,
                                 employer=di.get("subtitle", ""), vacancy_title=di.get("title", ""),
                                 chat_status="waiting_hr")
                continue
            if wf:
                wf_id = wf.get("id", "") if isinstance(wf, dict) else ""
                # Аудит 2026-08-17 #26: mobile API возвращает и системные типы
                # ("APPLICATION_ACCEPTED"), и числовые reference ("1234") строкой.
                # Раньше любая непустая строка считалась системным событием и
                # чат пропускался, включая обычные сообщения HR с числовым
                # workflow_transition.id. Пропускаем только НЕ-цифровые строки.
                if isinstance(wf_id, str) and wf_id and not wf_id.isdigit():
                    skipped_system += 1
                    log_debug(f"LLM [{state.short}] {item_id}: unread={unread}, системное событие wf={wf_id!r}, пропуск")
                    continue
                log_debug(f"LLM [{state.short}] {item_id}: unread={unread}, wf.id={wf_id!r} (числовой/int, реальное сообщение)")
            # Не флудим логи структурой каждого item — только метаданные кандидата (swarm-16 #8).
            log_debug(f"LLM [{state.short}] {item_id}: ✅ кандидат unread={unread}, sender={sender_id}, len={len(last_text)}")
            candidates.append(item_id)

        log_debug(f"LLM [{state.short}]: {len(candidates)} кандидатов (прочитанных: {skipped_read}, наших: {skipped_ours}, системных: {skipped_system})")
        if not candidates:
            state.llm_pending_chats = 0
            state.llm_current_neg_id = ""
            state.llm_current_employer = ""
            state.llm_current_idx = 0
            state.llm_current_total = 0
            state.llm_last_check_at = datetime.now().isoformat(timespec="seconds")
            state.llm_next_check_at = (
                datetime.now() + timedelta(seconds=max(CONFIG.llm_check_interval * 60, 120))
            ).isoformat(timespec="seconds")
            state.llm_status = f"\U0001f4a4 Нет новых (наших: {skipped_ours}, закр.: {skipped_locked})"
            self._add_log(state.short, state.color,
                f"\U0001f916 LLM: нет новых сообщений (прочит.: {skipped_read}, наших: {skipped_ours}, сист.: {skipped_system}, закрыт: {skipped_locked})", "info")
            return

        # Cap на 15 — LLM цикл ограничен чтобы не сжигать токены за один заход.
        cycle = candidates[:15]
        state.llm_pending_chats = len(candidates)
        state.llm_current_total = len(cycle)
        state.llm_current_idx = 0
        state.llm_current_neg_id = ""
        state.llm_current_employer = ""
        state.llm_status = f"\U0001f504 Обработка {len(cycle)} чатов..."
        self._add_log(state.short, state.color, f"\U0001f916 LLM: {len(candidates)} чатов требуют ответа", "info")

        for i, neg_id in enumerate(cycle):
            if not self._llm_processing_allowed(state):
                self._add_log(state.short, state.color, f"\U0001f916 LLM: выключен в процессе цикла, прерываю", "warning")
                break
            # Reset per-iteration: иначе exception на новой итерации видит global_key из ПРЕДЫДУЩЕЙ.
            global_key = None
            # True только пока ЭТОТ поток держит резервацию global_key: снимать
            # чужую резервацию (другой профиль того же HH-пользователя) нельзя.
            reserved = False
            try:
                if neg_id in state._llm_no_chat:
                    item = items_by_id.get(neg_id, {})
                    info = display_info.get(str(neg_id), {})
                    emp = (info.get("subtitle") or neg_id).strip(" ,")[:25]
                    self._add_log(state.short, state.color,
                        f"\U0001f916 [{emp}] \U0001f512 переписка закрыта, пропуск", "warning", neg_id=neg_id)
                    continue

                item = items_by_id.get(neg_id)
                if not item:
                    log_debug(f"LLM [{state.short}] {neg_id}: не найден в items_by_id, пропуск")
                    continue
                thread = _build_thread_from_chat_item(item, display_info, cur_pid, neg_id)
                employer_short = thread.get("employer_name", neg_id)[:25]
                if thread.get("error"):
                    self._add_log(state.short, state.color, f"\U0001f916 [{employer_short}] ошибка треда: {thread['error']}", "error", neg_id=neg_id)
                    continue

                employer = thread.get("employer_name", neg_id)[:35]
                employer_msg = thread.get("last_employer_msg", "")
                vacancy_title = thread.get("vacancy_title", "")
                # Live-статус в UI: какой чат сейчас в работе + позиция в цикле.
                # Обновляем ПОСЛЕ построения thread'а — до этого могли выпасть
                # по фильтрам (закрыт/DISCARD/wf) и не считались бы обработанными.
                state.llm_current_idx = i + 1
                state.llm_current_neg_id = str(neg_id)
                state.llm_current_employer = employer
                # vacancy_id из resources чата — нужен фронту чтобы дёрнуть рейтинг
                # работодателя по цепочке vid→employerId→rating (без extra fetch
                # здесь — фронт делает lazy lookup только когда строка видна).
                _vac_resources = (item.get("resources") or {}).get("VACANCY") or []
                vacancy_id = str(_vac_resources[0]) if _vac_resources else ""

                # Pre-filter: chatWritePossibility=DISABLED → LLM-ответ гарантированно
                # отбракуется HH'ом. Не жжём токены, не делаем сетевой вызов.
                # Поле кладётся parse_apply_strategy_meta при сборе search-страницы.
                if vacancy_id:
                    vac_meta = state.vacancy_meta.get(vacancy_id, {})
                    cwp = (vac_meta.get("chat_write_possibility") or "").upper()
                    if cwp == "DISABLED":
                        log_debug(f"LLM [{state.short}] {neg_id}: chatWritePossibility=DISABLED — пропуск (vacancy {vacancy_id})")
                        self._add_log(state.short, state.color,
                            f"\U0001f916 [{employer_short}] \U0001f6ab чат закрыт работодателем (chatWritePossibility=DISABLED), пропуск",
                            "warning", neg_id=neg_id)
                        state._llm_no_chat.add(neg_id)
                        # Аудит 2026-08-17 #21/#28: раньше здесь state.llm_replied_msgs[key] = None,
                        # но `key` создаётся позже (2655) → UnboundLocalError на каждом DISABLED-чате.
                        # _llm_no_chat достаточно: этот neg_id больше в кандидаты не попадёт.
                        continue

                if not thread.get("needs_reply") and not thread.get("chat_locked"):
                    raw_item = items_by_id.get(neg_id, {})
                    raw_unread = raw_item.get("unreadCount", 0)
                    raw_last = raw_item.get("lastMessage") or {}
                    raw_sender = raw_last.get("participantId", "")
                    if raw_unread == 0 and cur_pid and raw_sender and raw_sender != cur_pid:
                        thread["needs_reply"] = True
                        if not employer_msg:
                            employer_msg = (raw_last.get("text") or "").strip()
                            thread["last_employer_msg"] = employer_msg

                if thread.get("chat_locked"):
                    lock_reason = thread["chat_locked"]
                    log_debug(f"LLM [{state.short}] {neg_id}: переписка недоступна — {lock_reason!r}")
                    self._add_log(state.short, state.color,
                        f"\U0001f916 [{employer_short}] \U0001f512 переписка недоступна, пропуск", "warning", neg_id=neg_id)
                    state.llm_replied_msgs[(neg_id, "locked")] = None
                    upsert_interview(neg_id, acc=state.short, acc_color=state.color, chat_status="locked")
                    continue

                upsert_interview(neg_id, acc=state.short, acc_color=state.color,
                                 employer=employer, vacancy_title=vacancy_title, vacancy_id=vacancy_id,
                                 employer_last_msg=employer_msg if employer_msg else None,
                                 needs_reply=bool(thread.get("needs_reply")))

                if not thread.get("needs_reply"):
                    log_debug(f"LLM [{state.short}] {neg_id}: ответ не нужен (последнее сообщение — от соискателя)")
                    upsert_interview(neg_id, acc=state.short, acc_color=state.color, chat_status="waiting_hr")
                    self._add_log(state.short, state.color, f"\U0001f916 [{employer_short}] последнее сообщение наше, пропуск", "info", neg_id=neg_id)
                    continue
                last_msg_id = thread["last_msg_id"]
                key = (neg_id, last_msg_id)
                if is_message_review_pending(neg_id, last_msg_id):
                    self._add_log(state.short, state.color,
                        "Результат прошлой отправки неизвестен — проверьте чат HH вручную", "warning", neg_id=neg_id)
                    continue
                # Legacy: pre-r1 records без replied_msg_id мечены sentinel '__legacy__'.
                # Если такой sentinel есть — значит мы уже отвечали в этот чат до апгрейда.
                # Пропускаем, не дожидаясь нового HH-сообщения (r13-1 #6).
                if key in state.llm_replied_msgs or (neg_id, "__legacy__") in state.llm_replied_msgs:
                    log_debug(f"LLM [{state.short}] {neg_id}: уже отвечали на msg {last_msg_id}")
                    self._add_log(state.short, state.color, f"\U0001f916 [{employer_short}] уже отвечали в этой сессии, пропуск", "info", neg_id=neg_id)
                    continue
                # temp_skip может быть выставлен и под key=(neg_id, last_msg_id), и под
                # (neg_id, "exception") (chat-level backoff после исключения в H6).
                _skip_until = max(
                    state._llm_temp_skip.get(key, 0),
                    state._llm_temp_skip.get((neg_id, "exception"), 0),
                )
                if time.time() < _skip_until:
                    mins = max(1, int((_skip_until - time.time()) / 60))
                    self._add_log(state.short, state.color,
                        f"\U0001f916 [{employer_short}] повтор через ~{mins}м (ошибка в предыдущем цикле)", "info", neg_id=neg_id)
                    log_debug(f"LLM [{state.short}] {neg_id}: temp_skip до {_skip_until:.0f}")
                    continue
                global_key = (cur_pid, neg_id, last_msg_id)
                with self._llm_sent_lock:
                    if global_key in self._llm_sent_global:
                        log_debug(f"LLM [{state.short}] {neg_id}: уже отправлено другим аккаунтом (pid={cur_pid})")
                        self._add_log(state.short, state.color, f"\U0001f916 [{employer_short}] уже отправлено другим аккаунтом, пропуск", "info")
                        state.llm_replied_msgs[key] = None
                        continue

                progress = f"[{i+1}/{min(len(candidates),15)}]"
                self._add_log(state.short, state.color,
                    f"\U0001f916 {progress} [{employer_short}]: «{employer_msg[:50]}»", "info", neg_id=neg_id)
                log_debug(f"LLM [{state.short}] {progress} {neg_id} ({employer_short}): загружаю историю чата")
                cover_letter = state.acc.get("letter", "") if CONFIG.llm_use_cover_letter else ""
                # Fetch resume for LLM context
                if CONFIG.llm_use_resume:
                    rh = state.acc.get("resume_hash", "")
                    _cached = rh and rh in _resume_cache and (time.time() - _resume_cache[rh][1] < _RESUME_CACHE_TTL)
                    resume_data = get_client(state.acc).fetch_resume()
                    resume_text = (resume_data.get("text", "") if isinstance(resume_data, dict)
                                   and "text" in resume_data else json.dumps(resume_data, ensure_ascii=False))
                    if resume_text:
                        src = "кэш" if _cached else "загружено"
                        self._add_log(state.short, state.color,
                            f"\U0001f916 \U0001f4c4 Резюме в контексте LLM ({src}, {len(resume_text)} симв.)", "info", neg_id=neg_id)
                    else:
                        self._add_log(state.short, state.color,
                            f"\U0001f916 \U0001f4c4 Резюме не удалось загрузить — LLM работает без него", "warning", neg_id=neg_id)
                else:
                    resume_text = ""
                # OAuth-путь когда cookies dead или включён CONFIG.chat_use_oauth —
                # GET /negotiations/{id}/messages не зависит от chatik-кук.
                full_history = self._llm_history(state, neg_id)
                conversation = full_history if full_history else thread["messages"]

                _last_emp_raw = None
                if full_history:
                    for msg_raw in reversed(full_history):
                        if msg_raw.get("sender") == "employer":
                            _last_emp_raw = msg_raw
                            break
                _raw_actions = (_last_emp_raw or {}).get("actions") or {}
                _text_buttons = _raw_actions.get("text_buttons", [])
                _is_bot_msg = (_last_emp_raw or {}).get("is_bot", False)
                if _text_buttons:
                    # Умный выбор кнопки: heuristic для очевидных Да/Нет,
                    # LLM-консультация если кнопок 3+ или Да/Нет не определяется.
                    from app.llm import pick_robot_button as _pick_robot_button
                    _btn_idx, btn_text, _btn_source = _pick_robot_button(
                        _text_buttons, conversation, thread.get("employer_name", ""), state.short,
                    )
                    if not btn_text:
                        btn_text = (_text_buttons[0].get("text") if _text_buttons else "ДА") or "ДА"
                    log_debug(
                        f"LLM [{state.short}] {neg_id}: робот-рекрутер, кнопки={[b.get('text') for b in _text_buttons]}, "
                        f"выбрана [{_btn_idx}] '{btn_text}' (src={_btn_source})"
                    )
                    self._add_log(state.short, state.color,
                        f"\U0001f916 [{employer_short}] \U0001f916 Робот → '{btn_text}' ({_btn_source})", "info", neg_id=neg_id)
                    upsert_interview(neg_id, acc=state.short, acc_color=state.color,
                                     employer=employer_short, vacancy_title=vacancy_title, vacancy_id=vacancy_id,
                                     chat_status="robot")
                    if not self._llm_send_allowed(state):
                        upsert_interview(neg_id, acc=state.short, llm_reply=btn_text, llm_sent=False)
                        self._push_llm_log({
                            "time": datetime.now().strftime("%d.%m %H:%M"),
                            "acc": state.short, "color": state.color,
                            "employer": employer_short, "vacancy_title": vacancy_title,
                            "neg_id": neg_id, "vacancy_id": vacancy_id,
                            "employer_msg": employer_msg, "bot_reply": btn_text,
                            "sent": False, "source": "robot_draft",
                        })
                        continue
                    # Аудит 2026-08-17 #10: раньше robot-flow отправлял сразу без
                    # резервации global_key → под конкурентными циклами двух
                    # аккаунтов один и тот же workflow_button слался дважды.
                    # Резервируем ДО send, discard при неудаче — как в auto-send.
                    with self._llm_sent_lock:
                        if global_key in self._llm_sent_global:
                            log_debug(f"LLM [{state.short}] {neg_id}: робот-кнопка уже отправлена (pid={cur_pid}), пропуск")
                            state.llm_replied_msgs[key] = None
                            continue
                        self._llm_sent_global.add(global_key)
                        reserved = True
                    try:
                        _selected_btn = (
                            _text_buttons[_btn_idx]
                            if isinstance(_btn_idx, int) and 0 <= _btn_idx < len(_text_buttons)
                            else _text_buttons[0]
                        )
                        _event = (
                            _selected_btn.get("event")
                            or _selected_btn.get("event_type")
                            or _selected_btn.get("eventType")
                        )
                        _event_params = _selected_btn.get(
                            "event_params", _selected_btn.get("eventParams", {})
                        )
                        if isinstance(_event, dict):
                            _event_params = (
                                _event_params
                                or _event.get("event_params")
                                or _event.get("eventParams")
                                or _event.get("params")
                                or {}
                            )
                            _event = (
                                _event.get("event_type")
                                or _event.get("eventType")
                                or _event.get("type")
                            )
                        _client = get_client(state.acc)
                        if not self._llm_conversation_unchanged(state, neg_id, conversation) or not self._llm_send_allowed(state):
                            with self._llm_sent_lock:
                                self._llm_sent_global.discard(global_key)
                            reserved = False
                            self._add_log(state.short, state.color,
                                "Переписка изменилась или недоступна — автоответ отложен", "warning", neg_id=neg_id)
                            continue
                        if _event:
                            ok = _client.send_workflow_event(
                                neg_id, str(_event),
                                _event_params if isinstance(_event_params, dict) else {},
                            )
                        else:
                            ok = _client.send_message(neg_id, btn_text)
                    except Exception:
                        # The outer handler retains the reservation on uncertain sends.
                        raise
                    if ok and ok != "chat_not_found":
                        state.llm_replied_msgs[key] = None
                        replied += 1
                        state._llm_neg_failures.pop(neg_id, None)
                        state._llm_temp_skip.pop((neg_id, "exception"), None)
                        # Аудит #22: persist llm_sent+replied_msg_id, чтобы после
                        # рестарта дедуп удержал factor robot-ответы, а не только
                        # in-memory. Без этого перезапуск снова жмёт ту же кнопку.
                        upsert_interview(neg_id, acc=state.short, employer=employer_short,
                                         llm_sent=True, replied_msg_id=str(last_msg_id))
                        ts = datetime.now().strftime("%H:%M")
                        self._push_llm_log({
                            "time": ts, "acc": state.short, "color": state.color,
                            "employer": employer_short, "vacancy_title": vacancy_title,
                            "neg_id": neg_id, "vacancy_id": vacancy_id, "employer_msg": employer_msg[:50],
                            "bot_reply": f"\U0001f916 Кнопка: {btn_text}", "sent": True,
                        })
                        self._persist_llm_log({
                            "time": datetime.now().isoformat(timespec="seconds"),
                            "acc": state.short,
                            "neg_id": str(neg_id),
                            "last_msg_id": str(last_msg_id),
                            "employer": employer_short,
                            "reply_len": len(btn_text),
                            "send_ok": True,
                            "source": "robot",
                        })
                    elif ok == "chat_not_found":
                        state._llm_no_chat.add(neg_id)
                        state.llm_replied_msgs[key] = None
                        log_debug(f"LLM [{state.short}] {neg_id}: робот-кнопка 409, чат закрыт — добавлен в _llm_no_chat")
                    elif not ok:
                        # Отправка не удалась — отпускаем резервацию, чтобы
                        # следующий цикл смог попробовать снова.
                        with self._llm_sent_lock:
                            self._llm_sent_global.discard(global_key)
                        reserved = False
                        state._llm_temp_skip[key] = time.time() + 1800
                    continue

                has_employer_msg = any(m.get("sender") == "employer" for m in conversation)
                last_real_sender = conversation[-1].get("sender") if conversation else None
                if not has_employer_msg:
                    log_debug(f"LLM [{state.short}] {neg_id}: нет реальных сообщений работодателя (только системные), пропуск")
                    state.llm_replied_msgs[key] = None
                    continue
                if last_real_sender == "applicant":
                    log_debug(f"LLM [{state.short}] {neg_id}: последнее реальное сообщение наше — уже ответили, пропуск")
                    state.llm_replied_msgs[key] = None
                    continue
                _consecutive_ours = 0
                for _cm in reversed(conversation):
                    if _cm.get("sender") == "applicant":
                        _consecutive_ours += 1
                    else:
                        break
                state._msg_consecutive[neg_id] = _consecutive_ours
                if _consecutive_ours >= 4:
                    log_debug(f"LLM [{state.short}] {neg_id}: in_a_row_limit: {_consecutive_ours} сообщений без ответа HR, пропуск")
                    self._add_log(state.short, state.color,
                        f"\U0001f916 [{employer_short}] ⚠️ in_a_row_limit: {_consecutive_ours} сообщения без ответа HR, пропуск", "warning", neg_id=neg_id)
                    state.llm_replied_msgs[key] = None
                    continue
                # Если для этого (neg_id, last_msg_id) уже есть кэшированный черновик
                # с прошлого цикла (auto_send был выкл) — используем его, чтобы не жечь
                # токены заново. Если auto_send всё ещё False — вообще скипаем без
                # перегенерации (черновик уже сохранён в llm_log и interviews DB).
                with state._llm_drafts_lock:
                    cached_draft = state._llm_drafts.get(key)
                if cached_draft and not CONFIG.llm_auto_send:
                    log_debug(f"LLM [{state.short}] {neg_id}: уже есть черновик в кэше, auto_send выкл — пропуск")
                    continue
                reply_source = "llm"
                if cached_draft and CONFIG.llm_auto_send:
                    log_debug(f"LLM [{state.short}] {neg_id}: отправляю кэшированный черновик ({len(cached_draft)} симв.)")
                    reply_text = cached_draft
                    reply_source = "cached"
                else:
                    reply_text = ""
                    hr_last = (employer_msg or "").strip()
                    # Есть ли у нас свой LLM? Если да — идёт первым (даёт
                    # контекстный ответ). quick_replies HH — шаблонные подсказки,
                    # часто не в тему (могут ответить "готов работать в гибком
                    # графике" на "можем созвониться?"). Только fallback.
                    _has_own_llm = bool(
                        (CONFIG.llm_api_key or "").strip()
                        or any(p.get("api_key") for p in (CONFIG.llm_profiles or []) if p.get("enabled", True))
                        or (getattr(CONFIG, "llm_openclaw_enabled", False))
                    )
                    if not _has_own_llm and getattr(CONFIG, "llm_use_quick_replies", True):
                        # Своего LLM нет — берём quick_replies с умным ranking.
                        qr = get_client(state.acc).fetch_quick_replies(neg_id, last_msg_id)
                        if qr:
                            is_question = "?" in hr_last
                            _greet = ("здравствуйте", "добрый день", "добрый вечер", "приветствую")
                            def _score(s):
                                s_low = s.strip().lower()
                                is_greet = len(s) < 25 and any(g in s_low for g in _greet)
                                return (0 if (is_question and is_greet) else 1, len(s))
                            best = max(qr, key=_score)
                            _min_ok = 20 if is_question else 5
                            if len(best) >= _min_ok:
                                reply_text = best
                                reply_source = "quick_reply"
                                log_debug(f"LLM [{state.short}] {neg_id}: quick_replies {len(qr)} вариантов (LLM нет), взял '{reply_text[:40]}…'")
                                self._add_log(state.short, state.color,
                                    f"\U0001f4a1 {progress} [{employer_short}]: HH-quick_reply (LLM недоступен)", "info", neg_id=neg_id)
                    if not reply_text:
                        log_debug(f"LLM [{state.short}] {neg_id}: история {len(conversation)} сообщений, резюме {len(resume_text)} симв., отправляю в LLM")
                        self._add_log(state.short, state.color,
                            f"\U0001f916 {progress} [{employer_short}]: история {len(conversation)} сообщ., жду LLM…", "info", neg_id=neg_id)
                        ai_hint = bool(state.vacancy_meta.get(vacancy_id, {}).get("ai_assistant_enabled"))
                        reply_text = generate_llm_reply(
                            conversation,
                            thread.get("employer_name", ""),
                            cover_letter,
                            resume_text,
                            account_key=f"{state.short}:{neg_id}",
                            ai_screener_hint=ai_hint,
                        )
                        reply_source = "llm"
                    if not reply_text and _has_own_llm and getattr(CONFIG, "llm_use_quick_replies", True):
                        # LLM молчит (rate-limit / down) — попробуем quick_replies как последний резерв.
                        qr = get_client(state.acc).fetch_quick_replies(neg_id, last_msg_id)
                        if qr:
                            is_question = "?" in hr_last
                            _greet = ("здравствуйте", "добрый день", "добрый вечер", "приветствую")
                            def _score2(s):
                                s_low = s.strip().lower()
                                is_greet = len(s) < 25 and any(g in s_low for g in _greet)
                                return (0 if (is_question and is_greet) else 1, len(s))
                            best = max(qr, key=_score2)
                            if len(best) >= (20 if is_question else 5):
                                reply_text = best
                                reply_source = "quick_reply_fallback"
                                log_debug(f"LLM [{state.short}] {neg_id}: LLM молчит, взял quick_reply '{reply_text[:40]}…'")
                    if not reply_text:
                        llm_status = get_llm_last_status(f"{state.short}:{neg_id}", "reply")
                        if llm_status.get("provider") == "openclaw" and llm_status.get("status") == "timeout":
                            self._add_log(state.short, state.color, f"\U0001f916 [{employer_short}] OpenClaw timeout, повтор через 30м", "warning", neg_id=neg_id)
                        else:
                            self._add_log(state.short, state.color, f"\U0001f916 [{employer_short}] LLM не дал ответ, повтор через 30м", "warning", neg_id=neg_id)
                        log_debug(f"LLM [{state.short}] {neg_id}: пустой ответ от LLM, ставим temp_skip 30м")
                        state._llm_temp_skip[key] = time.time() + 1800
                        continue
                    log_debug(f"LLM [{state.short}] {neg_id}: ответ получен ({len(reply_text)} симв.), отправляю")

                ts = datetime.now().strftime("%d.%m %H:%M")

                if CONFIG.llm_auto_send:
                    with self._llm_sent_lock:
                        if global_key in self._llm_sent_global:
                            log_debug(f"LLM [{state.short}] {neg_id}: другой поток уже отправил (pid={cur_pid}), пропуск")
                            self._add_log(state.short, state.color, f"\U0001f916 [{employer_short}] другой аккаунт уже отправил, пропуск", "info")
                            state.llm_replied_msgs[key] = None
                            continue
                        self._llm_sent_global.add(global_key)
                        self._llm_sent_by_neg_id.setdefault(neg_id, set()).add(global_key)
                        reserved = True
                    self._add_log(state.short, state.color,
                        f"\U0001f916 [{employer_short}] отправляю: «{reply_text[:60]}»", "info", neg_id=neg_id)
                    # Читаем HR-сообщение (галочка «прочитано» в UI HH) + typing indicator
                    # 2-4 сек — HR получает push «печатает…», ответ выглядит человечнее.
                    try:
                        get_client(state.acc).mark_chat_read(neg_id, last_msg_id)
                        get_client(state.acc).send_participant_action(neg_id, "TYPING")
                    except Exception:
                        pass
                    _delay = min(4.0, max(2.0, len(reply_text) * 0.03))
                    time.sleep(_delay)
                    if not self._llm_conversation_unchanged(state, neg_id, conversation):
                        with self._llm_sent_lock:
                            self._llm_sent_global.discard(global_key)
                            self._llm_sent_by_neg_id.get(neg_id, set()).discard(global_key)
                        reserved = False
                        with state._llm_drafts_lock:
                            state._llm_drafts.pop(key, None)
                        self._add_log(state.short, state.color,
                            "Переписка изменилась или недоступна — автоответ отложен", "warning", neg_id=neg_id)
                        continue
                    if not self._llm_send_allowed(state):
                        with self._llm_sent_lock:
                            self._llm_sent_global.discard(global_key)
                            self._llm_sent_by_neg_id.get(neg_id, set()).discard(global_key)
                        reserved = False
                        with state._llm_drafts_lock:
                            state._llm_drafts[key] = reply_text
                        upsert_interview(neg_id, acc=state.short, llm_reply=reply_text, llm_sent=False)
                        continue
                    log_debug(f"LLM [{state.short}] {neg_id}: отправляю сообщение в chatik")
                    ok = get_client(state.acc).send_message(neg_id, reply_text, topic_id=thread.get("topic_id", ""))
                    try:
                        get_client(state.acc).send_participant_action(neg_id, "NONE")
                    except Exception:
                        pass
                    if ok == "chat_not_found":
                        with self._llm_sent_lock:
                            self._llm_sent_global.discard(global_key)
                            self._llm_sent_by_neg_id.get(neg_id, set()).discard(global_key)
                        reserved = False
                        state.llm_replied_msgs[key] = None
                        state._llm_no_chat.add(neg_id)
                        upsert_interview(neg_id, acc=state.short, acc_color=state.color,
                                         employer=employer, vacancy_title=vacancy_title, vacancy_id=vacancy_id,
                                         chat_not_found=True)
                        self._add_log(state.short, state.color,
                            f"\U0001f916 [{employer_short}] \U0001f512 переписка закрыта (409), пропуск", "warning", neg_id=neg_id)
                        continue
                    if ok:
                        state.llm_replied_msgs[key] = None
                        with state._llm_drafts_lock:
                            state._llm_drafts.pop(key, None)  # отправили — кэш не нужен
                        state._msg_consecutive[neg_id] = state._msg_consecutive.get(neg_id, 0) + 1
                        state._llm_neg_failures.pop(neg_id, None)  # clear backoff on success
                        state._llm_temp_skip.pop((neg_id, "exception"), None)
                        replied += 1
                        upsert_interview(neg_id, acc=state.short, acc_color=state.color,
                                         llm_reply=reply_text, llm_sent=True,
                                         replied_msg_id=last_msg_id)
                        self._add_log(state.short, state.color,
                            f"\U0001f916 Авто-ответ → {employer}: {reply_text[:60]}…", "success", neg_id=neg_id)
                        self._push_llm_log({
                            "time": ts, "acc": state.short, "color": state.color,
                            "employer": employer, "vacancy_title": vacancy_title,
                            "neg_id": neg_id, "vacancy_id": vacancy_id, "employer_msg": employer_msg,
                            "bot_reply": reply_text, "sent": True, "source": reply_source,
                        })
                        self._persist_llm_log({
                            "time": datetime.now().isoformat(timespec="seconds"),
                            "acc": state.short,
                            "neg_id": str(neg_id),
                            "last_msg_id": str(last_msg_id),
                            "employer": employer,
                            "reply_len": len(reply_text),
                            "send_ok": True,
                            "source": reply_source,
                        })
                    else:
                        with self._llm_sent_lock:
                            self._llm_sent_global.discard(global_key)
                            self._llm_sent_by_neg_id.get(neg_id, set()).discard(global_key)
                        reserved = False
                        state._llm_temp_skip[key] = time.time() + 1800
                        upsert_interview(neg_id, acc=state.short, acc_color=state.color,
                                         llm_reply=reply_text, llm_sent=False)
                        self._add_log(state.short, state.color,
                            f"\U0001f916 Черновик (ошибка отправки, повтор ~30м) → {employer}: {reply_text[:60]}…", "warning", neg_id=neg_id)
                        self._push_llm_log({
                            "time": ts, "acc": state.short, "color": state.color,
                            "employer": employer, "vacancy_title": vacancy_title,
                            "neg_id": neg_id, "vacancy_id": vacancy_id, "employer_msg": employer_msg,
                            "bot_reply": reply_text, "sent": False,
                        })
                        self._persist_llm_log({
                            "time": datetime.now().isoformat(timespec="seconds"),
                            "acc": state.short,
                            "neg_id": str(neg_id),
                            "last_msg_id": str(last_msg_id),
                            "employer": employer,
                            "reply_len": len(reply_text),
                            "send_ok": False,
                            "source": "draft_error",
                        })
                else:
                    # auto_send=False — сохраняем черновик в кэш чтобы при включении
                    # auto_send отправить без повторного LLM-вызова.
                    with state._llm_drafts_lock:
                        state._llm_drafts[key] = reply_text
                    # НЕ помечаем llm_replied_msgs[key]=None — иначе при флипе auto_send
                    # бот посчитает чат «уже обработан» и пропустит. Без этой метки
                    # следующий цикл увидит чат, найдёт черновик в кэше и (если
                    # auto_send=True) отправит.
                    upsert_interview(neg_id, acc=state.short, acc_color=state.color,
                                     llm_reply=reply_text, llm_sent=False)
                    self._add_log(state.short, state.color,
                        f"\U0001f916 Черновик [{employer}] (вкл «Автоотправку» → отправлю): {reply_text[:60]}…", "info", neg_id=neg_id)
                    self._push_llm_log({
                        "time": ts, "acc": state.short, "color": state.color,
                        "employer": employer, "vacancy_title": vacancy_title,
                        "neg_id": neg_id, "vacancy_id": vacancy_id, "employer_msg": employer_msg,
                        "bot_reply": reply_text, "sent": False,
                    })
                    self._persist_llm_log({
                        "time": datetime.now().isoformat(timespec="seconds"),
                        "acc": state.short,
                        "neg_id": str(neg_id),
                        "last_msg_id": str(last_msg_id),
                        "employer": employer,
                        "reply_len": len(reply_text),
                        "send_ok": False,
                        "source": "draft_manual",
                    })

                time.sleep(3)  # rate limit between messages
            except Exception as e:
                log_exception(f"_process_llm_replies {neg_id}", e)
                uncertain = isinstance(e, MessageSendUncertain) or (
                    isinstance(e, MobileAPIError) and (e.status_code == 0 or e.status_code >= 500)
                )
                if reserved and uncertain:
                    # Do not release the cross-profile reservation or retry this message
                    # after restart. Delivery is unknown, not a successful send.
                    state.llm_replied_msgs[key] = None
                    try:
                        hold_message_for_review(neg_id, last_msg_id, state.short)
                    except Exception as persist_error:
                        log_exception("persist uncertain chat send", persist_error)
                    self._add_log(state.short, state.color,
                        "Результат отправки неизвестен. Проверьте чат HH вручную; автоматического повтора не будет.",
                        "warning", neg_id=neg_id)
                    continue
                # Резервацию снимаем только если её держит этот поток. После
                # УСПЕШНОЙ отправки ключ остаётся в _llm_sent_global: иначе второй
                # профиль того же HH-пользователя, чья генерация шла параллельно,
                # отправил бы HR повторный ответ.
                if reserved and global_key is not None:
                    try:
                        with self._llm_sent_lock:
                            self._llm_sent_global.discard(global_key)
                            bucket = self._llm_sent_by_neg_id.get(neg_id)
                            if bucket is not None:
                                bucket.discard(global_key)
                                if not bucket:
                                    self._llm_sent_by_neg_id.pop(neg_id, None)
                    except Exception:
                        pass
                # Backoff только на реальное исключение: 1 → 5 мин, 2 → 15 мин,
                # 3-5 → 1 час, дальше 24 часа. Раньше блок стоял в finally и рос
                # на КАЖДОМ проходе (успешный ответ, «уже отвечали», черновик,
                # сам temp_skip) — живой диалог с HR уходил в блок на сутки.
                fail_count = state._llm_neg_failures.get(neg_id, 0) + 1
                state._llm_neg_failures[neg_id] = fail_count
                backoff = {1: 300, 2: 900, 3: 3600, 4: 3600, 5: 3600}.get(fail_count, 86400)
                state._llm_temp_skip[(neg_id, "exception")] = time.time() + backoff
            finally:
                # Аудит 2026-08-17 #34: pending_chats раньше держал начальное
                # число кандидатов до конца цикла — UI показывал «12 висят» уже
                # после того, как 10 обработано. Декрементим по факту, чтобы
                # прогресс был виден в реальном времени.
                state.llm_pending_chats = max(0, state.llm_pending_chats - 1)

        state.llm_replied_count += replied
        if replied:
            state.llm_status = f"✅ {replied} ответов отправлено"
            log_debug(f"LLM auto-reply [{state.short}]: {replied} ответов отправлено")
        elif candidates:
            state.llm_status = f"⏳ {len(candidates)} чатов, 0 отправлено"
        # Цикл завершён — сбрасываем «текущий чат» и ставим таймеры для UI.
        state.llm_current_neg_id = ""
        state.llm_current_employer = ""
        state.llm_current_idx = 0
        state.llm_current_total = 0
        state.llm_last_check_at = datetime.now().isoformat(timespec="seconds")
        state.llm_next_check_at = (
            datetime.now() + timedelta(seconds=max(CONFIG.llm_check_interval * 60, 120))
        ).isoformat(timespec="seconds")

    def _stats_blocked(self, state: AccountState) -> bool:
        """Стоит ли воркер статистики/ИИ: общая пауза, ручная пауза профиля,
        проблемы авторизации или анкета на ручной проверке."""
        if self.paused:
            return True
        return bool(state.paused and state.paused_reason in ("", "manual", "auth"))

    @staticmethod
    def _apply_negotiation_stats(state: AccountState, stats: dict) -> None:
        state.hh_interviews = stats["interview"]
        state.hh_interviews_recent = stats["recent_interview"]
        state.hh_viewed = stats["viewed"]
        state.hh_not_viewed = stats["not_viewed"]
        state.hh_discards = stats["discard"]
        state.hh_interviews_list = stats["interviews_list"]
        state.hh_interview_neg_ids = stats.get("neg_ids", [])
        state.hh_discard_neg_ids = set(str(x) for x in stats.get("discard_neg_ids", []))
        state.hh_unread_by_employer = stats.get("unread_by_employer", 0)

        for neg_id in state.hh_interview_neg_ids:
            upsert_interview(neg_id, acc=state.short, acc_color=state.color)
        if len(state.hh_interview_neg_ids) == len(stats["interviews_list"]):
            for neg_id, item in zip(state.hh_interview_neg_ids, stats["interviews_list"]):
                upsert_interview(neg_id, acc=state.short, acc_color=state.color,
                                 vacancy_title=item.get("text", ""))

    def _fetch_hh_stats_worker(self, idx: int, state: AccountState) -> None:
        """Thread worker for HH stats polling — auto-restarts on crash.

        Без этого цикла один краш парсинга / network exception → у аккаунта
        НАВСЕГДА выключаются stats + LLM до перезапуска процесса (swarm-1 critical).
        """
        while not self._stop_event.is_set() and not getattr(state, "_deleted", False):
            try:
                self._fetch_hh_stats_worker_inner(idx, state)
                return  # inner вышел нормально (stop_event / _deleted) — выходим из restart-loop
            except Exception as e:
                log_exception(f"STATS WORKER CRASHED [{state.short}]", e)
                self._add_log(
                    state.short, state.color,
                    f"⚠️ Stats worker упал: {str(e)[:80]} — рестарт через 30с",
                    "error",
                )
                # Используем wait вместо sleep, чтобы shutdown будил быстро.
                if self._stop_event.wait(30):
                    return

    def _fetch_hh_stats_worker_inner(self, idx: int, state: AccountState) -> None:
        while not self._stop_event.is_set():
            # Ручная/авторизационная пауза останавливает и статистику, чтобы не
            # дёргать HH зря (swarm-12 #7). Лимит, капча и авто-пауза по ошибкам
            # касаются только НОВЫХ откликов: ответы HR и статистика продолжаются.
            while (
                self._stats_blocked(state)
                and not self._stop_event.is_set()
                and not getattr(state, "_deleted", False)
            ):
                if self._stop_event.wait(2):
                    return
            if self._stop_event.is_set() or getattr(state, '_deleted', False):
                break

            state.hh_stats_loading = True
            # Parallel — resume status через OAuth (5-min cache, дешёвый запрос)
            try:
                rs = fetch_resume_status(state.acc)
                if rs:
                    state.resume_status = rs
            except Exception as e:
                log_debug(f"resume_status fetch error [{state.short}]: {e}")
            try:
                stats = get_client(state.acc).fetch_negotiations()
                _is_mobile = str(state.acc.get("mode", "")).strip().lower() in ("mobile", "oauth")
                if stats.get("auth_error") and _is_mobile:
                    # Mobile-профиль: сюда попадаем, когда mobile-запрос не прошёл
                    # и сработал запасной web-путь. Веб-cookies mobile-профилю не
                    # нужны — не ставим «сессия устарела» и не пропускаем ИИ/статистику.
                    log_debug(f"stats [{state.short}]: mobile negotiations недоступны, web-fallback без cookies — пропускаю только переговоры")
                    stats = None
                if stats and stats.get("auth_error"):
                    log_debug(f"AUTH_ERROR [{state.short}] vid=- flow=stats")
                    state.cookies_expired = True
                    self._add_log(
                        state.short, state.color,
                        "⚠️ Куки протухли! (HH stats) Обновите куки.", "error",
                    )
                    state.hh_stats_loading = False
                    self._stop_event.wait(max(CONFIG.llm_check_interval * 60, 120))
                    continue
                old_interviews = state.hh_interviews
                if stats:
                    self._apply_negotiation_stats(state, stats)

                offers = get_client(state.acc).fetch_possible_offers()
                state.hh_possible_offers = offers

                was_touch_available = state.resume_free_touches > 0
                rs = get_client(state.acc).fetch_stats()
                state.resume_views_7d = rs["views"]
                state.resume_views_new = rs["views_new"]
                state.resume_shows_7d = rs["shows"]
                state.resume_invitations_7d = rs["invitations"]
                state.resume_invitations_new = rs["invitations_new"]
                state.resume_next_touch_seconds = rs["next_touch_seconds"]
                state.resume_free_touches = rs["free_touches"]
                # `resume_free_touches` и `next_resume_touch` раньше были двумя
                # независимыми состояниями. Если HH только что сообщил, что
                # публикация снова доступна, старый четырёхчасовой schedule не
                # должен удерживать автоматический подъём.
                if (
                    state.resume_touch_enabled
                    and not was_touch_available
                    and state.resume_free_touches > 0
                ):
                    state.next_resume_touch = datetime.now()
                    state.resume_touch_status = "🚀 Поднятие доступно"
                state.resume_global_invitations = rs["global_invitations"]
                state.resume_new_invitations_total = rs["new_invitations_total"]

                state.resume_view_history = get_client(state.acc).fetch_resume_view_history(limit=100)

                state.hh_stats_updated = datetime.now()

                if stats and old_interviews > 0 and stats["interview"] > old_interviews:
                    new_count = stats["interview"] - old_interviews
                    self._add_log(
                        state.short, state.color,
                        f"\U0001f3af НОВОЕ ПРИГЛАШЕНИЕ! (+{new_count} интервью)",
                        "success",
                    )

                log_debug(
                    f"HH stats {state.short}: {state.hh_interviews} интервью, "
                    f"{rs['views']} просмотров резюме, {rs['new_invitations_total']} новых инвайтов"
                )

                # HH-лимит applies только к НОВЫМ откликам, не к ответам в
                # существующих чатах. Так что limit-пауза НЕ должна стопать LLM.
                # Стопаем только на manual паузу или auth (куки протухли — LLM
                # всё равно не отправит).
                _llm_skip = self._stats_blocked(state)
                if _llm_skip:
                    log_debug(f"LLM [{state.short}]: пропуск — на паузе (reason={state.paused_reason or 'global'})")
                    state.hh_stats_loading = False
                    if self._stop_event.wait(max(CONFIG.llm_check_interval * 60, 120)):
                        return
                    continue

                _has_llm = (CONFIG.llm_api_key or "").strip() or any(
                    p.get("api_key") for p in (CONFIG.llm_profiles or []) if p.get("enabled", True)
                ) or (getattr(CONFIG, "llm_openclaw_enabled", False) and bool(_openclaw_command()))
                _neg_count = len(state.hh_interview_neg_ids)
                if not CONFIG.llm_enabled:
                    log_debug(f"LLM [{state.short}]: пропуск — глобально выключено")
                elif not _has_llm:
                    self._add_log(state.short, state.color, "\U0001f916 LLM: не настроен ни API, ни OpenClaw", "warning")
                elif not state.llm_enabled:
                    log_debug(f"LLM [{state.short}]: пропуск — выключено для аккаунта")
                else:
                    if _neg_count:
                        self._add_log(state.short, state.color, f"\U0001f916 LLM: проверяю {_neg_count} переговоров…", "info")
                    else:
                        self._add_log(state.short, state.color, "\U0001f916 LLM: нет переговоров в статусе Интервью, проверяю чаты…", "info")
                    self._process_llm_replies(state)
            except Exception as e:
                log_exception(f"HH stats fetch error ({state.short})", e)
            finally:
                state.hh_stats_loading = False

            # Back-to-back cycles когда backlog большой: если после цикла
            # осталось pending > 15 (per-cycle cap), нет смысла спать полный
            # интервал — HR-ответы задерживаются часами. Спим короткое время
            # чтобы дать HH подышать, но не полный 2-минутный wait.
            pending = getattr(state, "llm_pending_chats", 0) or 0
            if pending > 15:
                if self._stop_event.wait(15):  # короткая пауза между back-to-back
                    return
            else:
                if self._stop_event.wait(max(CONFIG.llm_check_interval * 60, 120)):
                    return

"""Регрессии по ревью логики (2026-10): backoff ИИ-ответов, сохранение пауз,
фильтры свежести/зарплаты, 429, локальные фильтры mobile-поиска."""
import time
from datetime import datetime, timedelta, timezone

import pytest

from app import manager as mgr
from app.manager import (
    BotManager, _mobile_search_filters, _salary_rub, _salary_too_low,
    _too_old_for_period,
)
from app.state import AccountState


def _acc(**extra):
    base = {"name": "Тест", "short": "T", "color": "cyan", "urls": [], "resume_hash": "r1"}
    base.update(extra)
    return base


# ---------- зарплата ----------

def test_salary_without_value_is_not_filtered(monkeypatch):
    monkeypatch.setattr(mgr.CONFIG, "min_salary", 150000)
    assert _salary_too_low({"v": None}, "v") is False
    assert _salary_too_low({}, "v") is False
    assert _salary_too_low({"v": 100000}, "v") is True
    assert _salary_too_low({"v": 200000}, "v") is False


def test_salary_rub_converts_currency():
    assert _salary_rub({"from": 3000, "currency": "USD"}) == 270000
    assert _salary_rub({"from": None, "to": 100000, "currency": "RUR"}) == 100000
    assert _salary_rub({"from": 5, "currency": "XYZ"}) is None
    assert _salary_rub(None) is None


# ---------- свежесть ----------

def test_period_filter_applied_locally(monkeypatch):
    monkeypatch.setattr(mgr.CONFIG, "search_period_days", 14)
    now = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)
    old = (now - timedelta(days=20)).isoformat()
    fresh = (now - timedelta(days=3)).isoformat()
    assert _too_old_for_period({"published_at": old}, now) is True
    assert _too_old_for_period({"published_at": fresh}, now) is False
    assert _too_old_for_period({}, now) is False


def test_period_filter_off(monkeypatch):
    monkeypatch.setattr(mgr.CONFIG, "search_period_days", 0)
    assert _too_old_for_period({"published_at": "2000-01-01T00:00:00+03:00"}) is False


def test_mobile_search_adds_labels(monkeypatch):
    monkeypatch.setattr(mgr.CONFIG, "fresh_vacancies_mode", False)
    monkeypatch.setattr(mgr.CONFIG, "search_period_days", 0)
    monkeypatch.setattr(mgr.CONFIG, "filter_agencies", True)
    monkeypatch.setattr(mgr.CONFIG, "filter_low_competition", False)
    assert _mobile_search_filters({}) == {"label": "not_from_agency"}
    monkeypatch.setattr(mgr.CONFIG, "filter_low_competition", True)
    assert _mobile_search_filters({}) == {"label": "low_performance"}


# ---------- сохранение пауз и тумблеров ----------

def test_state_restores_manual_pause_and_toggles():
    st = AccountState(_acc(paused=True, llm_enabled=False, resume_touch_enabled=False))
    assert st.paused is True
    assert st.paused_reason == "manual"
    assert st.llm_enabled is False
    assert st.resume_touch_enabled is False


def test_state_defaults_without_saved_flags():
    st = AccountState(_acc())
    assert st.paused is False
    assert st.llm_enabled is True
    assert st.resume_touch_enabled is True


def test_toggle_pause_persists_for_browser_session(monkeypatch):
    import threading
    from collections import deque
    saved = []
    monkeypatch.setattr(mgr, "save_browser_sessions", lambda sessions: saved.append([dict(s) for s in sessions]))
    bot = BotManager.__new__(BotManager)
    bot.account_states = []
    bot.temp_sessions = [_acc()]
    st = AccountState(_acc())
    bot.temp_states = {0: st}
    bot._deque_lock = threading.Lock()
    bot.activity_log = deque(maxlen=10)
    bot.toggle_account_pause(0)
    assert st.paused is True
    assert saved and saved[-1][0]["paused"] is True
    bot.toggle_account_pause(0)
    assert saved[-1][0]["paused"] is False


# ---------- статистика/ИИ на паузе ----------

@pytest.mark.parametrize("reason,blocked", [
    ("manual", True), ("auth", True), ("", True),
    ("limit", False), ("captcha", False), ("auto_errors", False), ("review", False),
])
def test_stats_worker_blocked_only_on_manual_or_auth(reason, blocked):
    bot = BotManager.__new__(BotManager)
    bot.paused = False
    st = AccountState(_acc())
    st.paused = True
    st.paused_reason = reason
    assert bot._stats_blocked(st) is blocked


# ---------- backoff ИИ-ответов ----------

class _FakeClient:
    def __init__(self, items, cur_pid="me"):
        self._items = items
        self._cur_pid = cur_pid

    def fetch_chat_list(self, max_pages=3):
        return self._items, {k: {"subtitle": "ACME", "title": "Dev"} for k in self._items}, self._cur_pid


def _llm_bot(monkeypatch, items):
    import threading
    from collections import deque
    bot = BotManager.__new__(BotManager)
    bot._llm_sent_global = set()
    bot._llm_sent_by_neg_id = {}
    bot._llm_sent_lock = threading.Lock()
    bot._deque_lock = threading.Lock()
    bot.activity_log = deque(maxlen=50)
    monkeypatch.setattr(mgr, "get_client", lambda acc: _FakeClient(items))
    monkeypatch.setattr(mgr, "get_no_chat_neg_ids", lambda: set())
    monkeypatch.setattr(mgr, "get_replied_keys", lambda: set())
    monkeypatch.setattr(mgr, "upsert_interview", lambda *a, **k: None)
    monkeypatch.setattr(mgr.CONFIG, "llm_enabled", True)
    return bot


def test_skipped_chat_does_not_grow_backoff(monkeypatch):
    items = {"n1": {"type": "NEGOTIATION", "unreadCount": 1,
                    "lastMessage": {"id": "m1", "participantId": "hr", "text": "Когда удобно?"}}}
    bot = _llm_bot(monkeypatch, items)
    st = AccountState(_acc())
    st.llm_replied_msgs[("n1", "m1")] = None  # уже отвечали
    for _ in range(8):
        bot._process_llm_replies_inner(st)
    assert st._llm_neg_failures == {}
    assert ("n1", "exception") not in st._llm_temp_skip


def test_exception_sets_backoff_and_releases_only_own_reservation(monkeypatch):
    items = {"n1": {"type": "NEGOTIATION", "unreadCount": 1,
                    "lastMessage": {"id": "m1", "participantId": "hr", "text": "Когда удобно?"}}}
    bot = _llm_bot(monkeypatch, items)
    st = AccountState(_acc())
    # Чужая резервация (другой профиль того же пользователя) должна пережить наше исключение.
    bot._llm_sent_global.add(("other", "n2", "m9"))

    def boom(*a, **k):
        raise RuntimeError("history down")
    monkeypatch.setattr(mgr.CONFIG, "llm_use_resume", False)
    monkeypatch.setattr(mgr.CONFIG, "chat_use_oauth", False)
    client = _FakeClient(items)
    client.fetch_chat_history = boom
    monkeypatch.setattr(mgr, "get_client", lambda acc: client)
    bot._process_llm_replies_inner(st)
    assert st._llm_neg_failures == {"n1": 1}
    assert st._llm_temp_skip[("n1", "exception")] > time.time()
    assert ("other", "n2", "m9") in bot._llm_sent_global

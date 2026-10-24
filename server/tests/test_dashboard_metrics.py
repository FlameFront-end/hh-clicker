from datetime import datetime, timedelta, timezone
import asyncio

from app.dashboard import application_metrics
from app.manager import BotManager
from app.state import AccountState


def test_submission_errors_survive_activity_feed_rollover():
    bot = BotManager()
    st = AccountState({"name": "A", "short": "A", "color": "blue", "urls": []})
    bot._record_apply_error(st, "123", "submission_unconfirmed", {"http_status": 503, "raw": "secret", "error_code": "service_unavailable"})
    for i in range(150):
        bot._add_log("A", "blue", str(i))
        bot._add_acc_event(st, "", "info", str(i), "")
    assert st.errors == 1
    assert len(st.apply_errors) == 1
    entry = st.apply_errors[0]
    assert entry["vacancy_id"] == "123"
    assert entry["http_status"] == 503
    assert entry["error_code"] == "service_unavailable"
    assert "secret" not in str(entry)
    assert datetime.fromisoformat(entry["time"]).tzinfo is not None
    for _ in range(60):
        bot._record_apply_error(st, "123", "transport_error")
    assert st.errors == 61
    assert len(st.apply_errors) == 50


def test_full_history_not_recent_feed_and_midnight_moscow():
    now = datetime(2026, 10, 23, 0, 30, tzinfo=timezone.utc)
    records = {"Frontend": {str(i): {"at": (now - timedelta(minutes=1)).isoformat()} for i in range(150)}}
    records["Frontend"].update({
        "before_msk_midnight": {"at": "2026-10-22T20:59:00+00:00"},
        "after_msk_midnight": {"at": "2026-10-22T21:01:00+00:00"},
        "unknown_date": {"at": ""}, "bad_date": {"at": "13:40:41"},
        "future": {"at": (now + timedelta(days=1)).isoformat()},
        "old": {"at": (now - timedelta(days=3)).isoformat()},
    })
    stats = application_metrics(records, now)
    assert stats["today"] == 151
    assert stats["last_24h"] == 152
    assert sum(stats["hourly"]) == 152
    assert stats["hourly"][-1] == 150
    assert stats["by_account"]["Frontend"]["last_sent_at"]
    assert stats["day_timezone"] == "Europe/Moscow"


def test_same_instant_in_different_timezones_has_same_bucket():
    now = datetime(2026, 10, 23, 12, tzinfo=timezone.utc)
    stats = application_metrics({"A": {"1": {"at": "2026-10-23T11:50:00+00:00"}},
                                 "B": {"2": {"at": "2026-10-23T18:50:00+07:00"}}}, now)
    assert stats["today"] == stats["last_24h"] == stats["hourly"][-1] == 2


def test_unique_skip_counts_and_event_timestamps(monkeypatch):
    bot = BotManager()
    st = AccountState({"name": "A", "short": "A", "color": "blue", "urls": []})
    st.vacancy_meta["123"] = {"title": "Frontend Developer", "company": "Test"}
    for _ in range(10):
        bot._add_response(st, "123", "", "", "test")
        bot._add_response(st, "456", "", "", "already")
    assert len(st.seen_tests) == len(st.seen_already) == 1
    entries = list(bot.recent_responses)
    assert entries[1]["title"] == "Frontend Developer"
    assert entries[1]["account_name"] == "A"
    assert entries[0]["title"] == "Вакансия №456"
    assert datetime.fromisoformat(entries[0]["time"]).tzinfo is not None


def test_scoped_chat_action_does_not_process_other_profiles(monkeypatch):
    from app.routes import llm
    bot = BotManager()
    a = AccountState({"name": "A", "short": "A", "color": "blue", "urls": []})
    b = AccountState({"name": "B", "short": "B", "color": "blue", "urls": []})
    bot.account_states = [a, b]
    monkeypatch.setattr(llm, "bot", bot)
    monkeypatch.setattr(llm.CONFIG, "llm_enabled", True)
    monkeypatch.setattr(llm.CONFIG, "llm_use_quick_replies", True)
    monkeypatch.setattr(llm, "_llm_run_now_last", 0)
    calls = []
    monkeypatch.setattr(bot, "_process_llm_replies", lambda st: calls.append(st.name))
    class ImmediateThread:
        def __init__(self, target, **kw): self.target = target
        def start(self): self.target()
    monkeypatch.setattr(llm.threading, "Thread", ImmediateThread)
    assert asyncio.run(llm.api_llm_run_now(account_idx=1)) == {"started": True, "accounts": 1}
    assert calls == ["B"]
    assert not asyncio.run(llm.api_llm_run_now(account_idx=99))["started"]


def test_bump_request_reports_queued_not_completed(monkeypatch):
    from app.routes import accounts
    called = []
    monkeypatch.setattr(accounts.bot, "_get_apply_state", lambda idx: object() if idx == 0 else None)
    monkeypatch.setattr(accounts.bot, "trigger_resume_touch", lambda idx: called.append(idx))
    assert asyncio.run(accounts.api_resume_touch(0)) == {"ok": True, "queued": True}
    assert not asyncio.run(accounts.api_resume_touch(9))["ok"]
    assert called == [0]

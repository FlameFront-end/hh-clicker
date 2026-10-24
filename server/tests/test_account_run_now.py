import asyncio
import threading

import pytest

from app.config import CONFIG
from app.manager import BotManager
from app.state import AccountState


@pytest.fixture
def profile(monkeypatch):
    monkeypatch.setattr(CONFIG, "daily_apply_limit", 20)
    monkeypatch.setattr(CONFIG, "hh_daily_limit", 200)
    state = AccountState({"name": "Test", "short": "Test", "color": "blue", "urls": []})
    bot = BotManager()
    bot.account_states = [state]
    state.cycle_waiting = True
    return bot, state


def test_request_wakes_only_selected_profile_and_deduplicates(profile):
    bot, state = profile
    other = AccountState({"name": "Other", "short": "Other", "color": "blue", "urls": []})
    bot.account_states.append(other)
    assert bot.request_account_cycle(0) == {"ok": True}
    assert state._cycle_wakeup.is_set()
    assert not other._cycle_wakeup.is_set()
    assert not bot.request_account_cycle(0)["ok"]
    assert not bot.request_account_cycle(-1)["ok"]
    assert not bot.request_account_cycle(999)["ok"]


@pytest.mark.parametrize("field,value", [
    ("paused", True), ("hard_stopped", True), ("limit_exceeded", True),
    ("captcha_url", "https://hh.ru/captcha"), ("paused_reason", "auth"),
    ("paused_reason", "auto_errors"), ("_deleted", True),
    ("daily_sent", 20), ("hh_today_applies", 200), ("cycle_waiting", False),
])
def test_cannot_override_safety_or_start_parallel_work(profile, field, value):
    bot, state = profile
    setattr(state, field, value)
    before = (state.paused, state.hard_stopped, state.limit_exceeded, state.paused_reason)
    assert not bot.request_account_cycle(0)["ok"]
    assert not state._cycle_wakeup.is_set()
    assert before == (state.paused, state.hard_stopped, state.limit_exceeded, state.paused_reason)


def test_global_pause_and_shutdown_are_preserved(profile):
    bot, state = profile
    bot.paused = True
    assert not bot.request_account_cycle(0)["ok"]
    bot.paused = False
    bot._stop_event.set()
    assert not bot.request_account_cycle(0)["ok"]
    assert not state._cycle_wakeup.is_set()


def test_temp_profile_uses_dashboard_index(profile):
    bot, state = profile
    bot.temp_states = {0: state}
    bot.account_states = [AccountState({"name": "Base", "short": "Base", "color": "blue", "urls": []})]
    assert bot.request_account_cycle(1) == {"ok": True}
    assert state._cycle_wakeup.is_set()


@pytest.mark.parametrize("stop", [False, True])
def test_long_wait_is_interruptible_and_clears_pending_flag(profile, monkeypatch, stop):
    bot, state = profile
    state.cycle_waiting = False
    ready = threading.Event()
    original_wait = state._cycle_wakeup.wait

    def wait(timeout):
        ready.set()
        return original_wait(timeout)

    monkeypatch.setattr(state._cycle_wakeup, "wait", wait)
    result = []
    thread = threading.Thread(target=lambda: result.append(bot._wait_between_cycles(state, 3600)), daemon=True)
    thread.start()
    try:
        assert ready.wait(2)
        if stop:
            bot._stop_event.set()
        else:
            assert bot.request_account_cycle(0)["ok"]
        thread.join(2)
        assert not thread.is_alive()
        assert result == [stop]
        assert not state.cycle_waiting
        assert not state._cycle_wakeup.is_set()
    finally:
        bot._stop_event.set()
        state._cycle_wakeup.set()
        thread.join(2)


def test_timeout_does_not_leave_profile_available(profile):
    bot, state = profile
    assert not bot._wait_between_cycles(state, 0)
    assert not state.cycle_waiting
    assert not bot.request_account_cycle(0)["ok"]


def test_snapshot_reports_availability_for_regular_and_temp_profiles(profile):
    bot, state = profile
    bot.temp_sessions = [{"name": "Test", "short": "Test", "color": "blue"}]
    bot.temp_states = {0: state}
    assert all(a["can_run_now"] for a in bot.get_state_snapshot()["accounts"])
    bot.paused = True
    assert not any(a["can_run_now"] for a in bot.get_state_snapshot()["accounts"])


def test_api_delegates_without_spawning_worker(monkeypatch):
    from app.routes import accounts
    calls = []
    monkeypatch.setattr(accounts.bot, "request_account_cycle", lambda idx: calls.append(idx) or {"ok": True})
    assert asyncio.run(accounts.api_account_run_now(3)) == {"ok": True}
    assert calls == [3]

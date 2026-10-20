from app import manager, storage
from app.database import write_document
from app.state import AccountState


def test_restart_restores_recent_history_and_lifetime_counts(tmp_data_dir, monkeypatch):
    write_document(tmp_data_dir / "applied_vacancies.json", {
        "Frontend": {"one": {"title": "React", "company": "Example", "at": "2026-10-20T12:00:00"}},
        "Senior": {"two": {"title": "Senior React", "at": "2026-10-21T12:00:00"}},
    })
    # A deliberately stale/rebound in-memory cache must not erase dashboard history.
    monkeypatch.setattr(storage, "_cache_applied", None)
    bot = manager.BotManager()
    bot.temp_sessions = [{"name": name, "short": name, "color": "blue", "urls": []} for name in ("Frontend", "Senior")]
    bot.temp_states = {i: AccountState(row) for i, row in enumerate(bot.temp_sessions)}
    bot._restore_recent_responses()
    snapshot = bot.get_state_snapshot()
    assert snapshot["global_stats"]["total_sent"] == 2
    assert snapshot["global_stats"]["session_sent"] == 0
    assert [row["id"] for row in snapshot["recent_responses"]] == ["two", "one"]
    assert all(row["sent"] == row["total_applied"] == 1 for row in snapshot["accounts"])
    assert all(row["session_sent"] == 0 for row in snapshot["accounts"])
    # Hydration is idempotent, not a duplicate append after each restart.
    bot._restore_recent_responses()
    assert len(bot.recent_responses) == 2


def test_inactive_profile_keeps_saved_history(tmp_data_dir):
    write_document(tmp_data_dir / "applied_vacancies.json", {"Offline": {"one": {"at": ""}}})
    bot = manager.BotManager()
    bot.temp_sessions = [{"name": "Offline"}]
    snapshot = bot.get_state_snapshot()
    assert snapshot["accounts"][0]["sent"] == 1
    assert snapshot["accounts"][0]["total_applied"] == 1

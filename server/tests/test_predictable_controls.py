import asyncio
import copy
from types import SimpleNamespace

from app import manager as mgr
from app.config import resume_filter_value
from app.routes import accounts as routes
from app.state import AccountState
from app import storage


class Request:
    def __init__(self, body): self.body = body
    async def json(self): return self.body


def setup_account(monkeypatch, rules=None):
    acc = {"name": "Test", "short": "T", "color": "blue", "resume_hash": "r", "urls": ["react"],
           "all_resumes": [{"hash": "r"}], "title_include_keywords": ["frontend"],
           "resume_filters": {"r": rules or {}}}
    st = AccountState(acc)
    bot = mgr.BotManager()
    bot.account_states = [st]
    monkeypatch.setattr(routes, "bot", bot)
    monkeypatch.setattr(routes, "accounts_data", [acc])
    monkeypatch.setattr(routes, "save_accounts", lambda **kw: None)
    return acc, st


def test_null_restores_inheritance_without_clearing_other_fields(monkeypatch):
    acc, _ = setup_account(monkeypatch, {"title_include_keywords": ["react"], "title_exclude_keywords": ["junior"]})
    result = asyncio.run(routes.api_account_resume_filters(0, Request({"resume_hash": "r", "filters": {"title_include_keywords": None}})))
    assert result["ok"]
    assert result["filters"] == {"title_exclude_keywords": ["junior"]}
    assert resume_filter_value(acc, "r", "title_include_keywords") == ["frontend"]


def test_experience_patch_preserves_existing_keywords(monkeypatch):
    acc, _ = setup_account(monkeypatch, {"title_exclude_keywords": ["junior"]})
    result = asyncio.run(routes.api_account_resume_filters(0, Request({"resume_hash": "r", "filters": {"experience": ["between3And6"]}})))
    assert result["ok"]
    assert resume_filter_value(acc, "r", "title_include_keywords") == ["frontend"]
    assert result["filters"]["title_exclude_keywords"] == ["junior"]


def test_explicit_empty_selection_does_not_enable_pool(monkeypatch):
    acc, _ = setup_account(monkeypatch)
    monkeypatch.setattr(mgr.CONFIG, "url_pool", ["https://hh.ru/search/vacancy?text=python"])
    result = asyncio.run(routes.api_set_urls(0, Request({"urls": [], "search_source_mode": "selected", "include_saved_searches": False})))
    assert result["ok"]
    assert mgr._search_urls(acc) == []
    assert acc["include_saved_searches"] is False
    assert mgr._search_urls({**acc, "search_source_mode": "inherit"}) == ["https://hh.ru/search/vacancy?text=python"]


def test_collectors_share_exact_cycle_sources_including_explicit_empty():
    assert mgr._search_urls({"urls": ["old"], "_cycle_search_urls": ["selected", "saved"]}) == ["selected", "saved"]
    assert mgr._search_urls({"urls": ["old"], "_cycle_search_urls": []}) == []


def test_unknown_questionnaire_is_stored_as_review_and_held(monkeypatch):
    monkeypatch.setattr(storage, "_schedule_save", lambda fn: None)
    storage.add_test_vacancy("123", "DevOps", "Test", "A", "r", status="review")
    assert storage.is_review_pending("A", "123")
    assert not storage.is_review_pending("B", "123")
    row = next(r for r in storage.get_test_list() if r["vacancy_id"] == "123")
    assert row["status"] == "review"


def test_activity_error_carries_own_details_not_a_dangling_log_link():
    bot = mgr.BotManager()
    st = AccountState({"name": "Test", "short": "T", "color": "blue", "urls": []})
    bot._record_apply_error(st, "123", "submission_unconfirmed", {"http_status": 503})
    bot._add_response(st, "123", "DevOps", "Test", "error")
    row = bot.recent_responses[0]
    assert row["error_detail"]["http_status"] == 503
    for i in range(120): bot._add_log("T", "blue", str(i))
    assert row["error_detail"]["reason"] == "submission_unconfirmed"


def test_review_hold_survives_another_profile_and_restart(monkeypatch):
    monkeypatch.setattr(storage, "_schedule_save", lambda fn: None)
    storage.add_test_vacancy("456", "Frontend", "Test", "A", "ra", status="review")
    storage.add_test_vacancy("456", "Frontend", "Test", "B", "rb", status="review")
    monkeypatch.setattr(storage, "_cache_tests", None)
    assert storage.is_review_pending("A", "456")
    assert storage.is_review_pending("B", "456")
    assert len([r for r in storage.get_test_list() if r["vacancy_id"] == "456"]) == 2


def test_review_resolution_is_scoped_durable_and_does_not_delete_dedup(monkeypatch):
    monkeypatch.setattr(storage, "_schedule_save", lambda fn: None)
    storage.add_test_vacancy("789", account_name="A", resume_hash="ra", status="review")
    storage.add_test_vacancy("789", account_name="B", resume_hash="rb", status="review")
    row = next(r for r in storage.get_test_list() if r["account_name"] == "A")
    assert not storage.resolve_review("789", "A", "ra", "stale")
    assert storage.resolve_review("789", "A", "ra", row["at"])
    assert not storage.is_review_pending("A", "789")
    assert storage.is_review_pending("B", "789")
    assert not storage.is_test("789", "A", "ra")
    monkeypatch.setattr(storage, "_cache_tests", None)
    assert not storage.is_review_pending("A", "789")
    assert storage.is_review_pending("B", "789")


def test_review_resolution_write_failure_keeps_hold(monkeypatch):
    storage.add_test_vacancy("999", account_name="A", resume_hash="r", status="review")
    row = next(r for r in storage.get_test_list() if r["vacancy_id"] == "999")
    def fail(*args, **kwargs): raise OSError("disk unavailable")
    monkeypatch.setattr(storage, "_atomic_write_json", fail)
    import pytest
    with pytest.raises(OSError): storage.resolve_review("999", "A", "r", row["at"])
    assert storage.is_review_pending("A", "999")


def test_failed_durable_filter_save_rolls_back_persistent_and_runtime(monkeypatch):
    acc, state = setup_account(monkeypatch, {"experience": ["between1And3"]})
    state.acc = {**acc, "resume_filters": copy.deepcopy(acc["resume_filters"])}
    before = dict(acc)
    def fail(**kw):
        assert kw["wait"] is True
        raise OSError("disk unavailable")
    monkeypatch.setattr(routes, "save_accounts", fail)
    result = asyncio.run(routes.api_account_resume_filters(0, Request({"resume_hash": "r", "filters": {"experience": ["moreThan6"]}})))
    assert not result["ok"]
    assert acc == before
    assert state.acc == before


def test_older_queued_account_snapshot_cannot_undo_durable_save(monkeypatch):
    from app import config
    from app.database import read_document
    pending = []
    monkeypatch.setattr(config, "_schedule_save", pending.append)
    monkeypatch.setattr(config, "accounts_data", [{"name": "A", "letter": "old"}])
    config.save_accounts()
    config.accounts_data[0]["letter"] = "new"
    config.save_accounts(wait=True)
    pending[0]()
    assert read_document(config.ACCOUNTS_FILE)[0]["letter"] == "new"


def test_stale_url_save_cannot_reenable_saved_searches(monkeypatch):
    acc, _ = setup_account(monkeypatch)
    acc.update(search_source_mode="selected", include_saved_searches=False)
    before = dict(acc)
    result = asyncio.run(routes.api_set_urls(0, Request({"urls": ["react"], "include_saved_searches": True,
        "base_settings": {"urls": ["react"], "url_pages": {}, "search_source_mode": "selected", "include_saved_searches": True}})))
    assert not result["ok"] and result["conflict"]
    assert acc == before


def test_legacy_unknown_record_requires_explicit_resolution(monkeypatch):
    storage._load_cache()
    monkeypatch.setitem(storage._cache_tests, "legacy", {"account_name": "A", "resume_hash": "r", "at": "old"})
    assert storage.is_test("legacy", "A", "r")
    assert storage.resolve_review("legacy", "A", "r", "old")
    assert not storage.is_test("legacy", "A", "r")


def test_filter_success_is_already_in_sqlite_before_response(monkeypatch):
    from app import config
    from app.database import read_document
    acc, _ = setup_account(monkeypatch)
    monkeypatch.setattr(config, "accounts_data", [acc])
    monkeypatch.setattr(routes, "save_accounts", config.save_accounts)
    result = asyncio.run(routes.api_account_resume_filters(0, Request({"resume_hash": "r", "filters": {"experience": ["between3And6"]}})))
    assert result["ok"]
    assert read_document(config.ACCOUNTS_FILE)[0]["resume_filters"]["r"]["experience"] == ["between3And6"]


def test_failed_browser_save_does_not_leave_rejected_draft_queued(monkeypatch):
    acc, state = setup_account(monkeypatch)
    routes.bot.account_states = []
    routes.bot.temp_sessions = [acc]
    routes.bot.temp_states = {0: state}
    old = copy.deepcopy(acc["resume_filters"])
    queued = []
    monkeypatch.setattr(storage, "_schedule_save", queued.append)
    real_writer = storage._atomic_write_json
    def fail(*args, **kwargs): raise OSError("disk unavailable")
    monkeypatch.setattr(storage, "_atomic_write_json", fail)
    result = asyncio.run(routes.api_account_resume_filters(0, Request({"resume_hash": "r", "filters": {"experience": ["moreThan6"]}})))
    assert not result["ok"]
    assert acc["resume_filters"] == old
    assert storage._sessions_pending_snapshot is None
    monkeypatch.setattr(storage, "_atomic_write_json", real_writer)
    storage.save_browser_sessions(routes.bot.temp_sessions, wait=True)
    from app.database import read_document
    assert read_document(storage.SESSIONS_FILE)[0]["resume_filters"] == old

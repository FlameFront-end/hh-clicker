"""No real HH requests: cancellation, uncertain writes and durable settings."""
import asyncio
import concurrent.futures
import copy
from types import SimpleNamespace

import pytest
import requests

from app import config, hh_apply, manager, oauth, storage
from app.routes import accounts, settings
from app.state import AccountState
from app.database import read_document


class Request:
    def __init__(self, body): self.body = body
    async def json(self): return self.body


def run(handler, body):
    return asyncio.run(handler(Request(body)))


def fake_web(monkeypatch, on_get=lambda: None, post_error=None):
    posts = []
    class Response:
        status = 200
        headers = {}
        def __init__(self, get=False): self.get = get
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def text(self):
            if self.get: on_get()
            return '{}' if self.get else '{"success":true}'
    class Session:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        def get(self, *args, **kwargs): return Response(True)
        def post(self, *args, **kwargs):
            posts.append(True)
            if post_error: raise post_error
            return Response()
    monkeypatch.setattr(hh_apply.aiohttp, "ClientSession", lambda **kw: Session())
    monkeypatch.setattr(hh_apply, "_aio_egress_kwargs", lambda: ({}, {}))
    monkeypatch.setattr(hh_apply, "_is_login_page", lambda html: False)
    monkeypatch.setattr(hh_apply, "_parse_questionnaire_fields", lambda html: (["q"], {"q": "answer"}))
    monkeypatch.setattr(config.CONFIG, "hh_ai_letter_first_try", False)
    return posts


@pytest.mark.parametrize("during", ["form", "llm"])
def test_questionnaire_rechecks_cancellation_before_post(monkeypatch, during):
    allowed = [True]
    def cancel(): allowed[0] = False
    posts = fake_web(monkeypatch, cancel if during == "form" else lambda: None)
    monkeypatch.setattr(config.CONFIG, "llm_fill_questionnaire", during == "llm")
    monkeypatch.setattr(config.CONFIG, "llm_enabled", True)
    monkeypatch.setattr(config.CONFIG, "llm_use_resume", False)
    monkeypatch.setattr(hh_apply, "_parse_questionnaire_rich", lambda html: [])
    monkeypatch.setattr(hh_apply, "generate_llm_questionnaire_answers", lambda *a, **kw: cancel() or {"q": "answer"})
    acc = {"name": "A", "resume_hash": "r", "cookies": {}, "_dispatch_guard": lambda: allowed[0]}
    assert asyncio.run(hh_apply.fill_and_submit_questionnaire(acc, "123"))[0] == "cancelled"
    assert not posts


def test_web_apply_rechecks_after_ai_letter(monkeypatch):
    allowed = [True]
    posts = fake_web(monkeypatch)
    monkeypatch.setattr(config.CONFIG, "hh_ai_letter_first_try", True)
    async def generate(*args): allowed[0] = False; return "letter"
    monkeypatch.setattr(hh_apply, "generate_hh_ai_letter", generate)
    acc = {"name": "A", "resume_hash": "r", "cookies": {"_xsrf": "test"}, "_dispatch_guard": lambda: allowed[0]}
    assert asyncio.run(hh_apply.send_response_async(acc, "123"))[0] == "cancelled"
    assert not posts


def test_oauth_rechecks_after_token_refresh(monkeypatch):
    allowed = [True]
    monkeypatch.setattr(oauth, "_obtain_oauth_token", lambda acc: allowed.__setitem__(0, False) or "test")
    monkeypatch.setattr(oauth.HH, "post", lambda *a, **kw: pytest.fail("must not POST"))
    assert oauth._oauth_apply({"resume_hash": "r", "_dispatch_guard": lambda: allowed[0]}, "123")[0] == "cancelled"


def test_read_timeout_marks_oauth_submission_for_review(monkeypatch):
    monkeypatch.setattr(oauth, "_obtain_oauth_token", lambda acc: "test")
    def timeout(*a, **kw): raise requests.ReadTimeout("response lost")
    monkeypatch.setattr(oauth.HH, "post", timeout)
    result, info = oauth._oauth_apply({"resume_hash": "r"}, "123")
    assert result == "error" and info["review_required"]


def test_read_timeout_marks_web_submission_for_review(monkeypatch):
    posts = fake_web(monkeypatch, post_error=TimeoutError())
    result, info = asyncio.run(hh_apply.send_response_async({"name": "A", "resume_hash": "r", "cookies": {"_xsrf": "test"}}, "123"))
    assert posts and result == "error" and info["review_required"]


def test_uncertain_oauth_result_stops_batch_and_hold_survives_reload(monkeypatch):
    bot = manager.BotManager()
    state = AccountState({"name": "A", "short": "A", "color": "blue", "resume_hash": "r", "urls": []})
    monkeypatch.setattr(manager, "_oauth_apply", lambda *a: ("error", {"review_required": True}))
    results = bot._send_oauth_batch(state, state.acc, ["123", "456"], manager._apply_context_key(state.acc))
    assert len(results) == 1
    monkeypatch.setattr(bot, "_persist_protective_pause", lambda st: None)
    bot._hold_unconfirmed_submission(state, state.acc, "123")
    assert state.paused and state.paused_reason == "review"
    monkeypatch.setattr(storage, "_cache_tests", None)
    assert storage.is_review_pending("A", "123")


def test_resume_switch_failure_rolls_back(monkeypatch):
    persistent = {"resume_hash": "old", "all_resumes": [{"hash": "old"}, {"hash": "new"}]}
    runtime = copy.deepcopy(persistent)
    monkeypatch.setattr(accounts, "accounts_data", [persistent])
    monkeypatch.setattr(accounts, "bot", SimpleNamespace(account_states=[SimpleNamespace(acc=runtime)]))
    def fail(**kw): assert kw["wait"]; raise OSError("disk")
    monkeypatch.setattr(accounts, "save_accounts", fail)
    result = asyncio.run(accounts.api_account_active_resume(0, Request({"resume_hash": "new"})))
    assert not result["ok"]
    assert persistent["resume_hash"] == runtime["resume_hash"] == "old"


def test_parallel_pool_adds_are_both_committed(monkeypatch):
    monkeypatch.setattr(config.CONFIG, "url_pool", [])
    def add(word):
        return run(settings.api_search_pool, {"action": "add", "urls": [{"url": f"https://hh.ru/search/vacancy?text={word}", "pages": 20}]})
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(add, ["react", "devops"]))
    assert all(r["ok"] for r in results)
    assert len(read_document(config.CONFIG_FILE)["url_pool"]) == 2


def test_stale_pool_replacement_is_rejected(monkeypatch):
    monkeypatch.setattr(config.CONFIG, "url_pool", [{"url": "new", "pages": 20}])
    result = run(settings.api_search_pool, {"action": "replace", "base_urls": [], "urls": []})
    assert result["conflict"] and not result["ok"]
    assert config.CONFIG.url_pool[0]["url"] == "new"


def test_pool_write_failure_keeps_previous_value(monkeypatch):
    monkeypatch.setattr(config.CONFIG, "url_pool", [])
    def fail(**kw): assert kw["wait"]; raise OSError("disk")
    monkeypatch.setattr(settings, "save_config", fail)
    result = run(settings.api_search_pool, {"action": "add", "urls": [{"url": "new", "pages": 20}]})
    assert not result["ok"] and config.CONFIG.url_pool == []


def test_queued_old_config_cannot_undo_new_pool(monkeypatch):
    pending = []
    monkeypatch.setattr(config, "_schedule_save", pending.append)
    monkeypatch.setattr(config.CONFIG, "url_pool", [])
    config.save_config()
    result = run(settings.api_search_pool, {"action": "add", "urls": [{"url": "new", "pages": 20}]})
    assert result["ok"]
    pending[0]()
    assert read_document(config.CONFIG_FILE)["url_pool"] == [{"url": "new", "pages": 20}]


def test_http_transport_does_not_repeat_post_after_cffi_timeout(monkeypatch):
    from app import hh_http
    client = hh_http.HHClient()
    def timeout(*a, **kw): raise TimeoutError("response lost")
    fake_cffi = SimpleNamespace(request=timeout)
    fake_requests = SimpleNamespace(request=lambda *a, **kw: pytest.fail("must not repeat POST"))
    monkeypatch.setattr(client, "_get_session", lambda key: (fake_cffi, fake_requests))
    monkeypatch.setattr(hh_http, "_record_diag", lambda *a, **kw: None)
    with pytest.raises(TimeoutError): client.post("https://hh.ru/test")


def test_successful_resume_switch_is_durable(monkeypatch):
    persistent = {"resume_hash": "old", "all_resumes": [{"hash": "new"}]}
    monkeypatch.setattr(config, "accounts_data", [persistent])
    monkeypatch.setattr(accounts, "accounts_data", config.accounts_data)
    monkeypatch.setattr(accounts, "bot", SimpleNamespace(account_states=[SimpleNamespace(acc=dict(persistent))]))
    result = asyncio.run(accounts.api_account_active_resume(0, Request({"resume_hash": "new"})))
    assert result["ok"]
    assert read_document(config.ACCOUNTS_FILE)[0]["resume_hash"] == "new"

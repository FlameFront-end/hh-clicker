"""Regression tests for pinned resumes, full batch accounting, isolated edits."""
import ast
import asyncio
import copy
import inspect
import textwrap
import threading
from datetime import datetime, timedelta
from itertools import permutations

import pytest

from app import config, manager, mobile_apply, storage
from app.database import read_document
from app.routes import accounts
from app.state import AccountState


@pytest.mark.parametrize("selected", ["regular", "senior"])
def test_worker_never_replaces_profile_resume(monkeypatch, selected):
    monkeypatch.setattr(config.CONFIG, "auto_pick_resume", True)
    monkeypatch.setattr(mobile_apply, "get_suitable_resumes", lambda *a: pytest.fail("must not auto-pick in a worker"))
    captured = []
    monkeypatch.setattr(mobile_apply, "mobile_request", lambda *a, **kw: captured.append(kw["form"]["resume_id"]) or {"id": "neg"})
    acc = {"resume_hash": selected, "all_resumes": [{"hash": "regular"}, {"hash": "senior"}], "_dispatch_guard": lambda: True}
    assert mobile_apply.submit_response(acc, "123", selected)["ok"]
    assert captured == [selected]


@pytest.mark.parametrize("failure", [False, True])
@pytest.mark.parametrize("kind", ["regular", "browser"])
def test_worker_sees_old_values_until_database_commit(monkeypatch, failure, kind):
    acc = {"name": "A", "resume_hash": "old", "urls": []}
    state = AccountState({**acc, "short": "A", "color": "blue"})
    # Real regular accounts share this exact dictionary with the persistence list.
    acc = state.acc
    records = [acc]
    seen = []
    entered, release = threading.Event(), threading.Event()
    changes = {"resume_hash": "new", "resume_filters": {"new": {"experience": ["moreThan6"]}}}
    if kind == "regular":
        monkeypatch.setattr(config, "accounts_data", records)
        target = config.ACCOUNTS_FILE
        lock = config._accounts_write_lock
        original = config.write_document
        def write(path, snapshot):
            entered.set(); assert release.wait(5)
            seen.append((acc["resume_hash"], snapshot[0]["resume_hash"]))
            if failure: raise OSError("disk")
            original(path, snapshot)
        monkeypatch.setattr(config, "write_document", write)
        saver = lambda edit: config.save_accounts(wait=True, edit=edit)
    else:
        target = storage.SESSIONS_FILE
        lock = storage._save_sessions_lock
        original = storage._atomic_write_json
        def write(path, snapshot):
            entered.set(); assert release.wait(5)
            seen.append((acc["resume_hash"], snapshot[0]["resume_hash"]))
            if failure: raise OSError("disk")
            original(path, snapshot)
        monkeypatch.setattr(storage, "_atomic_write_json", write)
        saver = lambda edit: storage.save_browser_sessions(records, wait=True, edit=edit)
    result = []
    thread = threading.Thread(target=lambda: result.append(accounts._commit_edit(acc, state.acc, changes, saver, lock)))
    thread.start()
    try:
        assert entered.wait(5)
        assert state.acc["resume_hash"] == "old"
        assert "resume_filters" not in state.acc
    finally:
        release.set(); thread.join(5)
    assert not thread.is_alive()
    assert seen == [("old", "new")]
    assert result[0]["ok"] is not failure
    if failure:
        assert acc["resume_hash"] == "old"
    else:
        assert read_document(target)[0]["resume_hash"] == acc["resume_hash"] == "new"


def result_accounting_loop():
    # Execute the production accounting block, without entering the worker's
    # collection/network loop. This catches accidental early exits anywhere
    # inside that block, not only the result-sorting helper.
    tree = ast.parse(textwrap.dedent(inspect.getsource(manager.BotManager._run_account_worker_inner)))
    loop = next(n for n in ast.walk(tree) if isinstance(n, ast.For) and ast.unparse(n.target) == "(j, (vid, result_data))")
    return compile(ast.fix_missing_locations(ast.Module(body=[loop], type_ignores=[])), "production_result_accounting", "exec")


@pytest.mark.parametrize("blocker", ["limit", "captcha", "auth_error", "rate_limit"])
@pytest.mark.parametrize("order", list(permutations(range(3))))
def test_all_received_results_are_accounted_before_exit(monkeypatch, blocker, order):
    bot = manager.BotManager()
    state = AccountState({"name": "A", "short": "A", "color": "blue", "resume_hash": "regular", "urls": []})
    monkeypatch.setattr(config.CONFIG, "stop_on_hh_limit", True)
    monkeypatch.setattr(bot, "_persist_protective_pause", lambda st: None)
    variants = [("111", ("limit" if blocker == "rate_limit" else blocker, {"rate_limited": True} if blocker == "rate_limit" else {})),
                ("222", ("error", {"review_required": True})), ("333", ("sent", {}))]
    received = [variants[i] for i in order]
    completed = manager._completed_apply_results([v for v, _ in received], [r for _, r in received])
    env = dict(vars(manager))
    env.update(self=bot, state=state, acc=state.acc, completed=completed,
               cycle_context=manager._apply_context_key(state.acc))
    exec(result_accounting_loop(), env)
    assert storage.is_applied("A", "333")
    assert storage.is_review_pending("A", "222")
    assert state.paused and state.paused_reason == "review"
    assert state.errors == 1
    assert state.sent == 1


def test_blockers_are_handled_before_starting_questionnaires():
    pairs = manager._completed_apply_results(["test", "limit", "error"], [("test", {}), ("limit", {}), ("error", {"review_required": True})])
    assert [v for v, _ in pairs] == ["error", "limit", "test"]

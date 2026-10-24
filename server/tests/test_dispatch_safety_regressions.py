"""Functional regressions: filters, immutable queues, sends and persisted holds.

All transports are fakes. No HH account or production data is required.
"""
import asyncio
import copy
import json
import threading
from types import SimpleNamespace

import pytest

from app import manager as mgr
from app.manager import BotManager, _apply_context_key, _experience_allowed, _title_allowed
from app.state import AccountState


def account(**overrides):
    return {"name": "test", "short": "T", "color": "green", "urls": [],
            "resume_hash": "regular", "letter": "test letter", **overrides}


@pytest.mark.parametrize("title,expected", [
    ("Python Developer", False), ("Senior Golang Developer", False),
    ("Senior QA Engineer", False), ("Frontend React Developer", True),
    ("Senior Frontend Developer", True),
])
def test_six_years_never_replaces_profession(title, expected):
    assert _title_allowed(title, ["frontend", "react", "senior", "lead"], [], ["moreThan6"]) is expected


def test_senior_profile_requires_level_or_six_years():
    include = ["frontend", "react", "senior", "lead"]
    assert not _title_allowed("Frontend developer", include, [], ["between3And6"])
    assert _title_allowed("Senior Frontend developer", include, [], ["between3And6"])
    assert not _title_allowed("Python developer", ["senior", "lead"], [], ["moreThan6"])


def test_existing_level_only_resume_uses_account_profession():
    roles = ["frontend", "react", "typescript", "nestjs"]
    assert _title_allowed("Frontend Developer", ["senior", "lead"], [], ["moreThan6"], roles)
    assert _title_allowed("Senior React Developer", ["senior", "lead"], [], ["between3And6"], roles)
    assert not _title_allowed("Senior Python Developer", ["senior", "lead"], [], ["moreThan6"], roles)
    assert not _title_allowed("Senior NestJS Developer", ["senior", "lead"], [], ["moreThan6"], roles)
    assert not _title_allowed("NestJS Developer", roles, [], ["between3And6"])


@pytest.mark.parametrize("status,body", [
    (200, "<html>" + "padding" * 400 + "</html>"),
    (200, '{"documentation":"shortVacancy topic_id"}'),
    (200, '<html><script>const example = {"success":true}</script></html>'),
    (500, '{"success":true}'),
    (400, '{"success":true}'),
])
def test_unconfirmed_http_response_is_not_a_receipt(status, body):
    from app.hh_apply import classify_apply_response
    assert classify_apply_response(status, body)[0] == "error"


@pytest.mark.parametrize("title", ["Junior Fullstack NestJS", "QA Fullstack NestJS", "Lead Fullstack NestJS"])
def test_nest_does_not_cancel_explicit_exclusions(title):
    assert not _title_allowed(title, ["fullstack"], ["junior", "qa", "lead"], [])
    assert not _title_allowed("Fullstack NestJS", ["fullstack"], ["fullstack"], [])


def test_regular_frontend_excludes_senior_even_at_allowed_experience():
    assert not _title_allowed("Senior Frontend", ["frontend"], ["senior", "lead"], ["between3And6"])
    assert _title_allowed("Middle Frontend", ["frontend"], ["senior", "lead"], ["between3And6"])


@pytest.mark.parametrize("experience,expected", [("moreThan6", False), ("between1And3", True), ("", False)])
def test_related_and_favorite_vacancies_need_actual_experience(monkeypatch, experience, expected):
    calls = []
    monkeypatch.setattr(mgr, "fetch_vacancy_details", lambda acc, vid: calls.append(vid) or {"experience": experience})
    meta = {"title": "DevOps Engineer"}
    assert _experience_allowed(account(), meta, "123", ["between1And3", "between3And6"]) is expected
    assert calls == ["123"]


def test_actual_experience_wins_over_query_provenance(monkeypatch):
    monkeypatch.setattr(mgr, "fetch_vacancy_details", lambda *a: pytest.fail("unnecessary request"))
    assert not _experience_allowed(account(), {"experience": {"id": "moreThan6"},
                                              "experience_filters": ["between3And6"]}, "123", ["between3And6"])
    assert _experience_allowed(account(), {"experience_filters": ["between3And6"]}, "123", ["between3And6"])


@pytest.mark.parametrize("result", ["captcha", "auth_error", "limit"])
def test_oauth_stops_after_first_blocking_result(monkeypatch, result):
    bot = BotManager()
    state = AccountState(account())
    calls = []
    monkeypatch.setattr(mgr.CONFIG, "response_delay", 0)
    monkeypatch.setattr(mgr, "_oauth_apply", lambda acc, vid, letter: calls.append(vid) or (result, {}))
    results = bot._send_oauth_batch(state, dict(state.acc), ["1", "2", "3"], _apply_context_key(state.acc))
    assert calls == ["1"]
    assert results == [(result, {})]


@pytest.mark.parametrize("edit", ["resume", "filters", "global_filter", "pause", "stop"])
def test_settings_change_or_stop_cancels_remaining_queue(monkeypatch, edit):
    bot = BotManager()
    state = AccountState(account(resume_filters={"regular": {"experience": ["between3And6"]}}))
    frozen = {**state.acc, "resume_filters": copy.deepcopy(state.acc["resume_filters"])}
    context = _apply_context_key(state.acc)
    calls = []
    monkeypatch.setattr(mgr.CONFIG, "response_delay", 0)
    def send(acc, vid, letter):
        calls.append((vid, acc["resume_hash"]))
        if edit == "resume": state.acc["resume_hash"] = "senior"
        elif edit == "filters": state.acc["resume_filters"]["regular"]["experience"] = ["moreThan6"]
        elif edit == "global_filter": monkeypatch.setattr(mgr.CONFIG, "min_salary", 123456)
        elif edit == "pause": state.paused = True
        else: bot._stop_event.set()
        return "sent", {}
    monkeypatch.setattr(mgr, "_oauth_apply", send)
    assert bot._send_oauth_batch(state, frozen, ["1", "2"], context) == [("sent", {})]
    assert calls == [("1", "regular")]
    assert frozen["resume_filters"]["regular"]["experience"] == ["between3And6"]


@pytest.mark.parametrize("reason", ["captcha", "auth", "review", "auto_errors"])
def test_protective_pause_survives_restart_and_explicit_resume(monkeypatch, reason):
    bot = BotManager()
    state = AccountState(account())
    bot.account_states = []
    bot.temp_sessions = [account()]
    bot.temp_states = {0: state}
    saves = []
    monkeypatch.setattr(mgr, "save_browser_sessions", lambda sessions: saves.append(copy.deepcopy(sessions)))
    state.paused = True
    state.paused_reason = reason
    state.captcha_url = "https://hh.ru/captcha" if reason == "captcha" else ""
    bot._persist_protective_pause(state)
    restored = AccountState(saves[-1][0])
    assert restored.paused and restored.paused_reason == reason
    assert restored.captcha_url == state.captcha_url
    bot.toggle_account_pause(0)
    assert not saves[-1][0]["paused"]
    assert saves[-1][0]["paused_reason"] == ""


@pytest.mark.parametrize("flag", ["global_pause", "account_pause", "deleted", "stop", "global_llm", "account_llm", "drafts"])
def test_llm_send_gate_rechecks_all_controls(monkeypatch, flag):
    bot = BotManager()
    state = AccountState(account())
    monkeypatch.setattr(mgr.CONFIG, "llm_enabled", True)
    monkeypatch.setattr(mgr.CONFIG, "llm_auto_send", True)
    assert bot._llm_send_allowed(state)
    if flag == "global_pause": bot.paused = True
    elif flag == "account_pause": state.paused = True
    elif flag == "deleted": state._deleted = True
    elif flag == "stop": bot._stop_event.set()
    elif flag == "global_llm": monkeypatch.setattr(mgr.CONFIG, "llm_enabled", False)
    elif flag == "account_llm": state.llm_enabled = False
    else: monkeypatch.setattr(mgr.CONFIG, "llm_auto_send", False)
    assert not bot._llm_send_allowed(state)


@pytest.mark.parametrize("scenario", ["robot_draft", "pause_during_typing", "stop_during_typing"])
def test_actual_chat_loop_does_not_send_without_permission(monkeypatch, scenario):
    from app import llm
    bot = BotManager()
    state = AccountState(account())
    key = ("n1", "m1")
    state._llm_drafts[key] = "Prepared reply"
    writes = []
    sent = []
    monkeypatch.setattr(mgr.CONFIG, "llm_enabled", True)
    monkeypatch.setattr(mgr.CONFIG, "llm_auto_send", scenario != "robot_draft")
    monkeypatch.setattr(mgr.CONFIG, "llm_use_resume", False)
    monkeypatch.setattr(mgr.CONFIG, "chat_use_oauth", False)
    monkeypatch.setattr(mgr, "get_no_chat_neg_ids", lambda: set())
    monkeypatch.setattr(mgr, "get_replied_keys", lambda: set())
    monkeypatch.setattr(mgr, "upsert_interview", lambda *a, **kw: writes.append(kw))
    monkeypatch.setattr(bot, "_persist_llm_log", lambda *a: None)
    monkeypatch.setattr(llm, "pick_robot_button", lambda *a: (0, "Yes", "test"))
    item = {"type": "NEGOTIATION", "unreadCount": 1,
            "lastMessage": {"id": "m1", "participantId": "hr", "text": "Question?"}}
    thread = {"needs_reply": True, "last_msg_id": "m1", "last_sender": "employer",
              "employer_name": "Employer", "last_employer_msg": "Question?", "messages": []}
    monkeypatch.setattr(mgr, "_build_thread_from_chat_item", lambda *a: dict(thread))
    history = [{"sender": "employer", "text": "Question?", "actions":
                {"text_buttons": [{"text": "Yes", "event_type": "ACCEPT"}]} if scenario == "robot_draft" else {}}]
    client = SimpleNamespace(
        fetch_chat_list=lambda **kw: ({"n1": item}, {}, "me"),
        fetch_chat_history=lambda *a, **kw: history,
        send_message=lambda *a, **kw: sent.append(a) or True,
        send_workflow_event=lambda *a, **kw: sent.append(a) or True,
        mark_chat_read=lambda *a: None,
        send_participant_action=lambda *a: None,
    )
    monkeypatch.setattr(mgr, "get_client", lambda *a: client)
    def interrupt_delay(seconds):
        if scenario == "pause_during_typing": bot.paused = True
        elif scenario == "stop_during_typing": bot._stop_event.set()
    monkeypatch.setattr(mgr.time, "sleep", interrupt_delay)
    bot._process_llm_replies_inner(state)
    assert not state._llm_neg_failures, "The scenario must reach its send gate, not fail early"
    assert not sent
    assert key not in state.llm_replied_msgs
    assert not bot._llm_sent_global
    assert any(w.get("llm_sent") is False for w in writes)


@pytest.mark.parametrize("payload,expected", [
    ({"error": "test-required"}, "test_required"),
    ({"error": "negotiations-limit-exceeded"}, "limit"),
    ({"alreadyApplied": True}, "already"),
    ({"unknown": "response"}, "error"),
    ({"success": True}, "sent"),
    ({"status": "ok"}, "sent"),
])
def test_manual_check_uses_confirmed_result_and_accounts_for_success(monkeypatch, payload, expected):
    from app.routes import apply as route
    acc = account(cookies={"_xsrf": "test"}, mode="web")
    state = AccountState(acc)
    recorded = []
    events = []
    monkeypatch.setattr(route.bot, "_get_apply_acc", lambda idx: dict(acc))
    monkeypatch.setattr(route.bot, "_get_apply_state", lambda idx: state)
    monkeypatch.setattr(route.bot, "_add_response", lambda *args: events.append(args))
    monkeypatch.setattr(route, "is_applied", lambda *a: False)
    monkeypatch.setattr(route, "add_applied", lambda *a, **kw: recorded.append((a, kw)))
    async def questionnaire(*a): return {"questions": [{"text": "Question"}]}
    monkeypatch.setattr(route, "_fetch_questionnaire_data", questionnaire)
    class Response:
        status = 200
        async def text(self): return json.dumps(payload)
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
    class Session:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        def post(self, *a, **kw): return Response()
    monkeypatch.setattr(route.aiohttp, "ClientSession", Session)
    result = asyncio.run(route.api_apply_check({"account_idx": 0, "vacancy_id": "123"}))
    assert result["status"] == expected
    assert state.sent == state.daily_sent == int(expected == "sent")
    assert bool(events) == (expected == "sent")
    assert bool(recorded) == (expected in ("sent", "already"))
    if expected == "already": assert recorded[0][1]["confirmed"] is False

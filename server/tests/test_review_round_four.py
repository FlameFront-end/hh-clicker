"""Regression tests: no real HH requests, production files or credentials."""
import asyncio
import copy
import threading
from types import SimpleNamespace

import pytest
import requests

from app import config, hh_chat, manager, oauth, storage
from app.database import read_document
from app.dispatch import MessageSendUncertain
from app.hh_mobile_transport import MobileAPIError
from app.routes import settings
from app.state import AccountState


@pytest.mark.parametrize("endpoint", ["negotiations", "common", "chatik"])
@pytest.mark.parametrize("failure", ["timeout", 500, 502, 503])
def test_chat_does_not_repeat_uncertain_post(monkeypatch, endpoint, failure):
    monkeypatch.setattr(config.CONFIG, "chat_use_oauth", endpoint != "chatik")
    monkeypatch.setattr(oauth, "_oauth_headers", lambda acc: {"Authorization": "test"})
    monkeypatch.setattr(oauth, "_obtain_oauth_token", lambda acc: "test")
    monkeypatch.setattr(hh_chat, "_ensure_chatik_cookies", lambda acc: None)
    if endpoint == "common":
        monkeypatch.setattr(oauth, "send_negotiation_message_oauth", lambda *a: False)
    calls = []
    def post(url, **kwargs):
        calls.append(url)
        if failure == "timeout":
            raise requests.ReadTimeout("response lost")
        return SimpleNamespace(status_code=failure, text="", json=lambda: {})
    monkeypatch.setattr(oauth.HH, "post", post)
    with pytest.raises(MessageSendUncertain):
        hh_chat.send_negotiation_message({"cookies": {"hhtoken": "test"}}, "123", "Synthetic reply")
    assert len(calls) == 1


def test_chat_explicit_rejection_can_fallback(monkeypatch):
    monkeypatch.setattr(config.CONFIG, "chat_use_oauth", True)
    monkeypatch.setattr(oauth, "_oauth_headers", lambda acc: {"Authorization": "test"})
    monkeypatch.setattr(oauth, "_obtain_oauth_token", lambda acc: "test")
    calls = []
    def post(url, **kwargs):
        calls.append(url)
        return SimpleNamespace(status_code=404 if len(calls) == 1 else 201, text="")
    monkeypatch.setattr(oauth.HH, "post", post)
    assert hh_chat.send_negotiation_message({"cookies": {}}, "123", "Synthetic reply") is True
    assert len(calls) == 2


@pytest.mark.parametrize("failure", [False, True])
def test_pool_not_visible_until_durable_commit(monkeypatch, failure):
    old = [{"url": "old", "pages": 1}]
    new = [{"url": "new", "pages": 2}]
    monkeypatch.setattr(config.CONFIG, "url_pool", copy.deepcopy(old))
    monkeypatch.setattr(config, "_url_pages_map_cache", None)
    assert config._url_pages_map() == {"old": 1}
    entered, release = threading.Event(), threading.Event()
    real_write = config.update_document
    def write(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        if failure:
            raise OSError("simulated full disk")
        return real_write(*args, **kwargs)
    monkeypatch.setattr(config, "update_document", write)
    class Request:
        async def json(self):
            return {"action": "replace", "base_urls": old, "urls": new}
    results = []
    worker = threading.Thread(target=lambda: results.append(asyncio.run(settings.api_search_pool(Request()))))
    worker.start()
    try:
        assert entered.wait(5)
        assert config.CONFIG.url_pool == old
        assert config._url_pages_map() == {"old": 1}
    finally:
        release.set()
        worker.join(5)
    assert not worker.is_alive()
    assert results[0]["ok"] is not failure
    assert config.CONFIG.url_pool == (old if failure else new)
    assert config._url_pages_map() == ({"old": 1} if failure else {"new": 2})
    if not failure:
        assert read_document(config.CONFIG_FILE)["url_pool"] == new


def chat_loop(monkeypatch, *, robot=False):
    monkeypatch.setattr(storage, "_cache_interviews", None)
    bot = manager.BotManager()
    state = AccountState({"name": "A", "short": "A", "color": "blue", "resume_hash": "r", "urls": []})
    monkeypatch.setattr(config.CONFIG, "llm_enabled", True)
    monkeypatch.setattr(config.CONFIG, "llm_auto_send", True)
    monkeypatch.setattr(config.CONFIG, "llm_use_resume", False)
    monkeypatch.setattr(config.CONFIG, "chat_use_oauth", False)
    monkeypatch.setattr(manager, "get_no_chat_neg_ids", lambda: set())
    monkeypatch.setattr(manager, "get_replied_keys", lambda: set())
    monkeypatch.setattr(manager, "upsert_interview", lambda *a, **kw: None)
    monkeypatch.setattr(bot, "_persist_llm_log", lambda *a: None)
    monkeypatch.setattr(manager.time, "sleep", lambda *a: None)
    item = {"type": "NEGOTIATION", "unreadCount": 1,
            "lastMessage": {"id": "m1", "participantId": "hr", "text": "Question?"}}
    thread = {"needs_reply": True, "last_msg_id": "m1", "last_sender": "employer",
              "employer_name": "Employer", "last_employer_msg": "Question?", "messages": []}
    monkeypatch.setattr(manager, "_build_thread_from_chat_item", lambda *a: dict(thread))
    history = [{"sender": "employer", "text": "Question?", "msg_id": "m1", "actions":
                {"text_buttons": [{"text": "Yes", "event_type": "ACCEPT"}]} if robot else {}}]
    state._llm_drafts[("n1", "m1")] = "Prepared reply"
    if robot:
        from app import llm
        monkeypatch.setattr(llm, "pick_robot_button", lambda *a: (0, "Yes", "test"))
    sent, reads = [], []
    def read(*a, **kw):
        reads.append(True)
        return copy.deepcopy(history)
    client = SimpleNamespace(
        fetch_chat_list=lambda **kw: ({"n1": item}, {}, "me"),
        fetch_chat_history=read,
        send_message=lambda *a, **kw: sent.append(a) or True,
        send_workflow_event=lambda *a, **kw: sent.append(a) or True,
        mark_chat_read=lambda *a: None, send_participant_action=lambda *a: None,
    )
    monkeypatch.setattr(manager, "get_client", lambda *a: client)
    return bot, state, client, history, sent, reads


@pytest.mark.parametrize("robot", [False, True])
@pytest.mark.parametrize("change", ["none", "applicant", "employer", "unavailable"])
def test_actual_loop_rechecks_conversation(monkeypatch, robot, change):
    bot, state, client, history, sent, reads = chat_loop(monkeypatch, robot=robot)
    def read(*a, **kw):
        reads.append(True)
        result = copy.deepcopy(history)
        if len(reads) > 1:
            if change == "unavailable": return []
            if change != "none":
                result.append({"sender": change, "text": "New message", "msg_id": "m2"})
        return result
    client.fetch_chat_history = read
    bot._process_llm_replies_inner(state)
    assert len(reads) == 2
    assert bool(sent) is (change == "none")
    assert not state._llm_neg_failures
    if change != "none":
        assert not bot._llm_sent_global
        assert ("n1", "m1") not in state.llm_replied_msgs
        if not robot:
            assert ("n1", "m1") not in state._llm_drafts


@pytest.mark.parametrize("robot", [False, True])
@pytest.mark.parametrize("error", [MessageSendUncertain("lost"), MobileAPIError(0, {}), MobileAPIError(503, {})])
def test_uncertain_chat_retains_dedup_across_restart(monkeypatch, robot, error):
    bot, state, client, history, sent, reads = chat_loop(monkeypatch, robot=robot)
    def fail(*a, **kw):
        sent.append(True)
        raise error
    client.send_message = client.send_workflow_event = fail
    bot._process_llm_replies_inner(state)
    assert len(sent) == 1
    assert ("n1", "m1") in state.llm_replied_msgs
    assert ("me", "n1", "m1") in bot._llm_sent_global
    monkeypatch.setattr(storage, "_cache_interviews", None)
    assert ("n1", "m1") in storage.get_replied_keys()
    record = read_document(storage.INTERVIEWS_FILE)["n1"]
    assert record["llm_send_review_required"]
    assert not record.get("llm_sent")
    assert not state._llm_neg_failures
    # Also protect already-running profiles whose in-memory keys were evicted.
    state.llm_replied_msgs.clear()
    bot._llm_sent_global.clear()
    bot._process_llm_replies_inner(state)
    assert len(sent) == 1

import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from app import database as db


def test_migration_is_lossless_and_idempotent(tmp_path):
    directory = tmp_path / "legacy"
    directory.mkdir()
    documents = {
        "config.json": {"letter": "Здравствуйте!", "mobile_auth": {"oauth_client_secret": "test-only"}},
        "accounts.json": [],
        "browser_sessions.json": [
            {"name": "Frontend", "resume_hash": "a", "resume_worker_clone": True,
             "cookies": {"hhtoken": "test-only"}, "resume_filters": {"a": {"experience": ["between1And3"]}}},
            {"name": "Senior", "resume_hash": "b", "resume_filters": {}},
        ],
        "oauth_tokens.json": {"a::account": {"access_token": "test-token", "expires_at": 12345}},
        "applied_vacancies.json": {"Frontend": {"123": {"at": "2026-10-21", "title": "React", "extra": 1}}, "empty": {}},
        "test_required_vacancies.json": {"456": {"title": "Test"}},
        "interviews.json": {"42": {"llm_sent": True, "replied_msg_id": "dedup"}},
        "interviews 2.json": {"old": {"legacy": True}},
    }
    for name, value in documents.items():
        (directory / name).write_text(json.dumps(value), encoding="utf-8")
    (directory / "events.jsonl").write_text('{"kind":"sent","ts":"today"}\n', encoding="utf-8")
    assert len(db.verify_legacy(directory)) == len(documents)
    assert db.read_document(directory / "browser_sessions.json") == documents["browser_sessions.json"]
    assert db.read_document(directory / "applied_vacancies.json") == documents["applied_vacancies.json"]
    assert len(db.export_bundle(directory)["events.jsonl"]) == 1
    # Legacy files stop being authoritative after the first import.
    (directory / "config.json").write_text('{"stale":true}', encoding="utf-8")
    assert db.read_document(directory / "config.json") == documents["config.json"]
    db.delete_document(directory / "config.json")
    assert db.read_document(directory / "config.json") is None
    assert (directory / db.DB_NAME).stat().st_mode & 0o777 == 0o600
    with db.connection(directory) as conn:
        assert conn.execute("SELECT count(*) FROM resume_profiles").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == 1


def test_bad_legacy_input_rolls_back_whole_migration(tmp_path):
    (tmp_path / "accounts.json").write_text('[{"name":"safe"}]')
    (tmp_path / "config.json").write_text('{invalid')
    with pytest.raises(ValueError, match="Legacy migration failed"):
        db.read_document(tmp_path / "accounts.json")
    with sqlite3.connect(tmp_path / db.DB_NAME) as conn:
        assert conn.execute("SELECT count(*) FROM accounts").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == 0
    (tmp_path / "config.json").write_text('{}')
    assert db.read_document(tmp_path / "accounts.json") == [{"name": "safe"}]


def test_failed_restore_changes_nothing(tmp_path):
    db.write_document(tmp_path / "config.json", {"original": True})
    db.append_event(tmp_path / "events.jsonl", {"kind": "original"})
    with pytest.raises(ValueError):
        db.restore_bundle({"config.json": {"changed": True}, "events.jsonl": ["invalid"]}, tmp_path)
    assert db.read_document(tmp_path / "config.json") == {"original": True}
    assert db.export_bundle(tmp_path)["events.jsonl"] == [{"kind": "original"}]


def test_concurrent_transactions_do_not_lose_updates(tmp_path):
    path = tmp_path / "config.json"
    db.write_document(path, {"count": 0})
    def increment(_):
        db.update_document(path, lambda value: {"count": value["count"] + 1})
    with ThreadPoolExecutor(max_workers=8) as workers:
        list(workers.map(increment, range(40)))
    assert db.read_document(path) == {"count": 40}


def test_export_restore_and_online_backup(tmp_path):
    source, target = tmp_path / "source", tmp_path / "target"
    db.write_document(source / "config.json", {"nested": [1, {"enabled": False}]})
    db.write_document(source / "browser_sessions.json", [{"name": "One", "resume_filters": {"x": {"experience": []}}}])
    db.append_event(source / "llm_log.jsonl", {"text": "sample", "at": "today"})
    bundle = db.export_bundle(source)
    db.restore_bundle(bundle, target)
    assert db.export_bundle(target) == bundle
    backup = tmp_path / "backup.sqlite3"
    db.backup_database(backup, source)
    with sqlite3.connect(backup) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("SELECT count(*) FROM events").fetchone()[0] == 1


def test_profiles_cascade_and_validation(tmp_path):
    path = tmp_path / "browser_sessions.json"
    db.write_document(path, [{"name": "a", "resume_filters": {"r": {"experience": []}}}])
    db.write_document(path, [])
    with db.connection(tmp_path) as conn:
        assert conn.execute("SELECT count(*) FROM resume_profiles").fetchone()[0] == 0
    with pytest.raises(ValueError):
        db.write_document(path, {"not": "a list"})
    assert db.read_document(path) == []


def test_runtime_lock_prevents_second_bot(tmp_path):
    owner = db.acquire_runtime_lock(tmp_path)
    try:
        with pytest.raises(RuntimeError, match="in use"):
            db.acquire_runtime_lock(tmp_path)
    finally:
        owner.close()
    db.acquire_runtime_lock(tmp_path).close()


def test_backup_routes_include_history_and_reload_caches(tmp_data_dir, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from app import storage, oauth, instances
    from app.routes import settings
    monkeypatch.setattr(instances, "bot", SimpleNamespace(temp_sessions=[]))
    monkeypatch.setattr(settings, "_quiesce_runtime", lambda bot: None)
    for key in ("_cache_applied", "_cache_tests", "_cache_interviews"):
        monkeypatch.setattr(storage, key, None)
    monkeypatch.setattr(oauth, "_oauth_tokens", {})
    db.write_document(tmp_data_dir / "applied_vacancies.json", {"sample": {"123": {"at": "today"}}})
    db.write_document(tmp_data_dir / "oauth_tokens.json", {"sample": {"access_token": "test-only"}})
    db.append_event(tmp_data_dir / "events.jsonl", {"kind": "sample"})
    response = asyncio.run(settings.api_backup_download())
    bundle = json.loads(response.body)
    assert bundle["version"] == 2
    assert bundle["applied_vacancies.json"]["sample"]["123"]["at"] == "today"
    assert len(bundle["events.jsonl"]) == 1
    db.write_document(tmp_data_dir / "applied_vacancies.json", {})
    db.write_document(tmp_data_dir / "oauth_tokens.json", {})
    class Request:
        async def json(self):
            return bundle
    result = asyncio.run(settings.api_backup_restore(Request()))
    assert result["ok"] is True
    assert storage.is_applied("sample", "123")
    assert oauth._oauth_tokens["sample"]["access_token"] == "test-only"


def test_confirmed_application_survives_cache_eviction(tmp_data_dir, monkeypatch):
    from app import storage
    monkeypatch.setattr(storage, "_cache_applied", {})
    monkeypatch.setattr(storage, "_cache_tests", {})
    monkeypatch.setattr(storage, "_cache_interviews", {})
    monkeypatch.setattr(storage, "_APPLIED_MAX", 1)
    monkeypatch.setattr(storage, "_APPLIED_EVICT", 1)
    storage.add_applied("sample", "old")
    storage.add_applied("sample", "new")
    evicted = {"old", "new"} - set(storage._cache_applied["sample"])
    assert evicted and all(storage.is_applied("sample", vid) for vid in evicted)
    assert len(db.read_document(tmp_data_dir / "applied_vacancies.json")["sample"]) == 2


def test_backup_script_handles_sqlite_only_directory_and_restore(tmp_path, monkeypatch):
    import tarfile
    from scripts import backup_data as backup
    directory, out = tmp_path / "runtime", tmp_path / "snapshots"
    monkeypatch.setattr(backup, "DATA_DIR", directory)
    db.write_document(directory / "config.json", {"original": True})
    assert backup.do_backup(out, include_logs=False, apply=True) == 0
    archive = next(out.glob("*.tar.gz"))
    with tarfile.open(archive) as bundle:
        assert db.DB_NAME in bundle.getnames()
        assert "config.json" not in bundle.getnames()
    db.write_document(directory / "config.json", {"changed": True})
    assert backup.do_restore(str(archive), out, include_logs=False, apply=True) == 0
    assert db.read_document(directory / "config.json") == {"original": True}
    assert len(list(out.glob("*.tar.gz"))) == 2  # automatic pre-restore backup


def test_backup_script_refuses_restore_while_bot_is_running(tmp_path, monkeypatch):
    from scripts import backup_data as backup
    directory, out = tmp_path / "runtime", tmp_path / "snapshots"
    monkeypatch.setattr(backup, "DATA_DIR", directory)
    db.write_document(directory / "config.json", {"original": True})
    archive = backup.create_backup(out, include_logs=False)
    owner = db.acquire_runtime_lock(directory)
    try:
        with pytest.raises(RuntimeError, match="in use"):
            backup.do_restore(str(archive), out, include_logs=False, apply=True)
    finally:
        owner.close()

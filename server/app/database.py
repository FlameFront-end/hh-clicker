"""SQLite persistence. JSON is accepted only as a legacy import/export format.

Connections are short-lived and never shared between worker threads. Each write
is one transaction; WAL permits readers during writes. Variable HH metadata is
kept as JSON per entity, not as a single database-sized document.
"""
from __future__ import annotations

import copy
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_NAME = "hh-clicker.sqlite3"
DOCUMENTS = {
    "config.json": dict,
    "accounts.json": list,
    "browser_sessions.json": list,
    "oauth_tokens.json": dict,
    "applied_vacancies.json": dict,
    "test_required_vacancies.json": dict,
    "interviews.json": dict,
    "mobile_auth_config.json": dict,
    "mobile_auth_state.json": dict,
}
STREAMS = ("events.jsonl", "llm_log.jsonl")


def acquire_runtime_lock(directory=Path("data")):
    """Prevent two bot processes (or an offline restore) using one data store."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    handle = (directory / ".runtime.lock").open("a+b")
    try:
        if os.name == "nt":
            import msvcrt
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handle
    except OSError:
        handle.close()
        raise RuntimeError("This data directory is in use. Stop the other bot before starting/restoring.") from None

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS documents(name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)));
CREATE TABLE IF NOT EXISTS accounts(
 kind TEXT NOT NULL, position INTEGER NOT NULL, name TEXT NOT NULL,
 resume_hash TEXT NOT NULL, active INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 PRIMARY KEY(kind, position));
CREATE TABLE IF NOT EXISTS resume_profiles(
 kind TEXT NOT NULL, account_position INTEGER NOT NULL, resume_hash TEXT NOT NULL,
 filters TEXT NOT NULL CHECK(json_valid(filters)), PRIMARY KEY(kind,account_position,resume_hash),
 FOREIGN KEY(kind,account_position) REFERENCES accounts(kind,position) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS oauth_tokens(token_key TEXT PRIMARY KEY, expires_at REAL, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE IF NOT EXISTS applications(
 account_name TEXT NOT NULL, vacancy_id TEXT NOT NULL, applied_at TEXT,
 title TEXT, company TEXT, payload TEXT NOT NULL CHECK(json_valid(payload)),
 PRIMARY KEY(account_name,vacancy_id));
CREATE INDEX IF NOT EXISTS applications_date ON applications(account_name,applied_at);
CREATE TABLE IF NOT EXISTS application_accounts(account_name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS test_vacancies(vacancy_id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE IF NOT EXISTS interviews(
 negotiation_id TEXT PRIMARY KEY, account_name TEXT, status TEXT, last_seen TEXT,
 payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE INDEX IF NOT EXISTS interviews_status ON interviews(account_name,status,last_seen);
CREATE TABLE IF NOT EXISTS auth_state(name TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE TABLE IF NOT EXISTS events(
 id INTEGER PRIMARY KEY AUTOINCREMENT, stream TEXT NOT NULL, kind TEXT, ts TEXT,
 payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE INDEX IF NOT EXISTS events_stream_date ON events(stream,ts,id);
CREATE TABLE IF NOT EXISTS legacy_artifacts(name TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
"""


def _dump(value):
    return json.dumps(value, ensure_ascii=False, default=str, allow_nan=False)


def _validate(name, value):
    expected = DOCUMENTS.get(name)
    if expected is None or not isinstance(value, expected):
        raise ValueError(f"Invalid persistence document: {name}")
    if name in ("accounts.json", "browser_sessions.json") and any(not isinstance(v, dict) for v in value):
        raise ValueError(f"Invalid account record in {name}")
    if name == "applied_vacancies.json":
        if any(not isinstance(v, dict) or any(not isinstance(r, dict) for r in v.values()) for v in value.values()):
            raise ValueError("Invalid application records")
    if name in ("interviews.json", "test_required_vacancies.json", "oauth_tokens.json"):
        if any(not isinstance(v, dict) for v in value.values()):
            raise ValueError(f"Invalid record in {name}")


def _write(conn, name, value):
    _validate(name, value)
    if name == "config.json":
        conn.execute("DELETE FROM settings")
        conn.executemany("INSERT INTO settings VALUES(?,?)", [(k, _dump(v)) for k, v in value.items()])
    elif name in ("accounts.json", "browser_sessions.json"):
        conn.execute("DELETE FROM accounts WHERE kind=?", (name,))
        for position, record in enumerate(value):
            body = copy.deepcopy(record)
            profiles = body.get("resume_filters")
            # Distinguish an absent field from an explicit empty mapping.
            if isinstance(profiles, dict):
                body["resume_filters"] = {}
            else:
                profiles = {}
            conn.execute("INSERT INTO accounts VALUES(?,?,?,?,?,?)", (
                name, position, str(body.get("name", "")), str(body.get("resume_hash", "")),
                int(bool(body.get("bot_active", False))), _dump(body)))
            for resume, filters in (profiles or {}).items():
                conn.execute("INSERT INTO resume_profiles VALUES(?,?,?,?)", (name, position, resume, _dump(filters)))
    elif name == "oauth_tokens.json":
        conn.execute("DELETE FROM oauth_tokens")
        conn.executemany("INSERT INTO oauth_tokens VALUES(?,?,?)", [(k, v.get("expires_at"), _dump(v)) for k, v in value.items()])
    elif name == "applied_vacancies.json":
        conn.execute("DELETE FROM applications")
        conn.execute("DELETE FROM application_accounts")
        for account, records in value.items():
            conn.execute("INSERT INTO application_accounts VALUES(?)", (account,))
            conn.executemany("INSERT INTO applications VALUES(?,?,?,?,?,?)", [
                (account, vid, record.get("at"), record.get("title"), record.get("company"), _dump(record))
                for vid, record in records.items()])
    elif name == "test_required_vacancies.json":
        conn.execute("DELETE FROM test_vacancies")
        conn.executemany("INSERT INTO test_vacancies VALUES(?,?)", [(k, _dump(v)) for k, v in value.items()])
    elif name == "interviews.json":
        conn.execute("DELETE FROM interviews")
        conn.executemany("INSERT INTO interviews VALUES(?,?,?,?,?)", [
            (k, v.get("acc"), v.get("status"), v.get("last_seen"), _dump(v)) for k, v in value.items()])
    else:
        conn.execute("INSERT OR REPLACE INTO auth_state VALUES(?,?)", (name, _dump(value)))
    conn.execute("INSERT OR IGNORE INTO documents VALUES(?)", (name,))


def _read(conn, name, default=None):
    if not conn.execute("SELECT 1 FROM documents WHERE name=?", (name,)).fetchone():
        return copy.deepcopy(default)
    if name == "config.json":
        return {k: json.loads(v) for k, v in conn.execute("SELECT key,value FROM settings")}
    if name in ("accounts.json", "browser_sessions.json"):
        records = []
        for position, payload in conn.execute("SELECT position,payload FROM accounts WHERE kind=? ORDER BY position", (name,)):
            body = json.loads(payload)
            profiles = {k: json.loads(v) for k, v in conn.execute(
                "SELECT resume_hash,filters FROM resume_profiles WHERE kind=? AND account_position=?", (name, position))}
            if profiles or isinstance(body.get("resume_filters"), dict):
                body["resume_filters"] = profiles
            records.append(body)
        return records
    if name == "applied_vacancies.json":
        records = {k: {} for (k,) in conn.execute("SELECT account_name FROM application_accounts")}
        for account, vid, payload in conn.execute("SELECT account_name,vacancy_id,payload FROM applications"):
            records.setdefault(account, {})[vid] = json.loads(payload)
        return records
    tables = {
        "oauth_tokens.json": ("oauth_tokens", "token_key"),
        "test_required_vacancies.json": ("test_vacancies", "vacancy_id"),
        "interviews.json": ("interviews", "negotiation_id"),
    }
    if name in tables:
        table, key = tables[name]  # identifiers come only from this fixed mapping
        return {k: json.loads(v) for k, v in conn.execute(f"SELECT {key},payload FROM {table}")}
    row = conn.execute("SELECT payload FROM auth_state WHERE name=?", (name,)).fetchone()
    return json.loads(row[0]) if row else copy.deepcopy(default)


def _import_legacy(conn, directory):
    """One atomic, strict, lossless migration. Never overwrite existing DB data."""
    if conn.execute("SELECT 1 FROM schema_migrations WHERE version=1").fetchone():
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        if not conn.execute("SELECT 1 FROM schema_migrations WHERE version=1").fetchone():
            for path in sorted(directory.glob("*.json")):
                try:
                    value = json.loads(path.read_text(encoding="utf-8"))
                except (ValueError, OSError) as exc:
                    raise ValueError(f"Legacy migration failed: {path.name}; original preserved") from exc
                if path.name in DOCUMENTS:
                    _write(conn, path.name, value)
                else:
                    conn.execute("INSERT INTO legacy_artifacts VALUES(?,?)", (path.name, _dump(value)))
            for stream in STREAMS:
                path = directory / stream
                if path.exists():
                    with path.open(encoding="utf-8") as source:
                        for number, line in enumerate(source, 1):
                            if line.strip():
                                try:
                                    entry = json.loads(line)
                                    _append(conn, stream, entry)
                                except (ValueError, TypeError, AttributeError) as exc:
                                    raise ValueError(f"Legacy migration failed: {stream}, line {number}") from exc
            conn.execute("INSERT INTO schema_migrations(version) VALUES(1)")
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


@contextmanager
def connection(directory=Path("data")):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / DB_NAME
    # Create secrets-bearing database owner-only before SQLite opens it.
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(fd)
    os.chmod(path, 0o600)
    conn = sqlite3.connect(path, timeout=30, isolation_level=None)
    try:
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=FULL")
        conn.executescript(SCHEMA)
        _import_legacy(conn, directory)
        yield conn
    finally:
        conn.close()


def read_document(path: Path, default=None):
    path = Path(path)
    with connection(path.parent) as conn:
        conn.execute("BEGIN")
        try:
            return _read(conn, path.name, default)
        finally:
            conn.rollback()


def document_exists(path: Path):
    path = Path(path)
    with connection(path.parent) as conn:
        return bool(conn.execute("SELECT 1 FROM documents WHERE name=?", (path.name,)).fetchone())


def write_document(path: Path, value):
    path = Path(path)
    with connection(path.parent) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            _write(conn, path.name, value)
            conn.commit()
        except BaseException:
            conn.rollback()
            raise


def update_document(path: Path, mutate, default=None):
    """Atomic read-modify-write, including configuration/mobile-auth merges."""
    path = Path(path)
    with connection(path.parent) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            value = mutate(_read(conn, path.name, default))
            _write(conn, path.name, value)
            conn.commit()
            return value
        except BaseException:
            conn.rollback()
            raise


def delete_document(path: Path):
    path = Path(path)
    with connection(path.parent) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            _write(conn, path.name, DOCUMENTS[path.name]())
            conn.execute("DELETE FROM documents WHERE name=?", (path.name,))
            conn.commit()
        except BaseException:
            conn.rollback()
            raise


def _append(conn, stream, entry):
    if stream not in STREAMS or not isinstance(entry, dict):
        raise ValueError("Invalid event stream/record")
    conn.execute("INSERT INTO events(stream,kind,ts,payload) VALUES(?,?,?,?)", (
        stream, entry.get("kind"), entry.get("ts") or entry.get("at"), _dump(entry)))


def append_event(path: Path, entry):
    path = Path(path)
    with connection(path.parent) as conn:
        _append(conn, path.name, entry)


def record_application(path: Path, account: str, vacancy_id: str, record: dict):
    """Durably record dedup state before the worker proceeds to another vacancy."""
    with connection(Path(path).parent) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute("INSERT OR IGNORE INTO documents VALUES('applied_vacancies.json')")
            conn.execute("INSERT OR IGNORE INTO application_accounts VALUES(?)", (account,))
            conn.execute("INSERT OR REPLACE INTO applications VALUES(?,?,?,?,?,?)", (
                account, vacancy_id, record.get("at"), record.get("title"), record.get("company"), _dump(record)))
            conn.commit()
        except BaseException:
            conn.rollback()
            raise


def application_exists(path: Path, account: str, vacancy_id: str):
    with connection(Path(path).parent) as conn:
        return bool(conn.execute("SELECT 1 FROM applications WHERE account_name=? AND vacancy_id=?", (account, str(vacancy_id))).fetchone())


def export_bundle(directory=Path("data")):
    with connection(directory) as conn:
        conn.execute("BEGIN")
        try:
            bundle = {name: _read(conn, name) for name in DOCUMENTS}
            for stream in STREAMS:
                bundle[stream] = [json.loads(r[0]) for r in conn.execute("SELECT payload FROM events WHERE stream=? ORDER BY id", (stream,))]
            bundle["legacy_artifacts"] = {k: json.loads(v) for k, v in conn.execute("SELECT name,payload FROM legacy_artifacts")}
            return bundle
        finally:
            conn.rollback()


def restore_bundle(bundle, directory=Path("data")):
    """Validate before writing; all collections restore together or none do."""
    for name in DOCUMENTS:
        if name in bundle and bundle[name] is not None:
            _validate(name, bundle[name])
    with connection(directory) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            for name in DOCUMENTS:
                if name in bundle and bundle[name] is not None:
                    _write(conn, name, bundle[name])
            for stream in STREAMS:
                if stream in bundle:
                    conn.execute("DELETE FROM events WHERE stream=?", (stream,))
                    for entry in bundle[stream]:
                        _append(conn, stream, entry)
            if "legacy_artifacts" in bundle:
                conn.execute("DELETE FROM legacy_artifacts")
                conn.executemany("INSERT INTO legacy_artifacts VALUES(?,?)", [(k, _dump(v)) for k, v in bundle["legacy_artifacts"].items()])
            conn.commit()
        except BaseException:
            conn.rollback()
            raise


def backup_database(destination: Path, directory=Path("data")):
    """SQLite online backup API includes committed WAL pages in one snapshot."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with connection(directory) as source, sqlite3.connect(destination) as target:
            source.backup(target)
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


def verify_legacy(directory=Path("data")):
    """Compare complete decoded source values without disclosing their contents."""
    directory = Path(directory)
    counts = {}
    with connection(directory) as conn:
        for path in sorted(directory.glob("*.json")):
            original = json.loads(path.read_text(encoding="utf-8"))
            if path.name in DOCUMENTS:
                actual = _read(conn, path.name)
            else:
                row = conn.execute("SELECT payload FROM legacy_artifacts WHERE name=?", (path.name,)).fetchone()
                actual = json.loads(row[0]) if row else None
            if original != actual:
                raise ValueError(f"Migration comparison failed: {path.name}")
            counts[path.name] = len(original) if isinstance(original, (dict, list)) else 1
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("SQLite integrity check failed")
        if conn.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("SQLite foreign key check failed")
    return counts

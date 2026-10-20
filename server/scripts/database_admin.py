#!/usr/bin/env python3
"""Offline SQLite migration/verification and consistent online snapshots."""
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from app.database import connection, verify_legacy, backup_database, acquire_runtime_lock


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("migrate", "verify", "backup", "status"))
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--output", type=Path, help="New .sqlite3 snapshot path for backup")
    args = parser.parse_args()
    runtime_lock = acquire_runtime_lock(args.data_dir) if args.action in ("migrate", "verify") else None
    if args.action in ("migrate", "verify"):
        # Strict full-value comparison; prints counts only, never credentials.
        counts = verify_legacy(args.data_dir)
        print(json.dumps({"verified_legacy_documents": len(counts), "documents": counts}, ensure_ascii=False))
    elif args.action == "backup":
        if not args.output:
            parser.error("backup requires --output")
        backup_database(args.output, args.data_dir)
        print("SQLite snapshot created")
    else:
        with connection(args.data_dir) as db:
            tables = ("accounts", "resume_profiles", "applications", "test_vacancies", "interviews", "oauth_tokens", "events")
            print(json.dumps({table: db.execute(f"SELECT count(*) FROM {table}").fetchone()[0] for table in tables}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

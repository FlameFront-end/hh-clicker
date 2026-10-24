"""Read-only dashboard aggregation over the complete persisted application history."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def timestamp(value):
    try:
        stamp = datetime.fromisoformat(str(value or ""))
        return stamp.astimezone()  # legacy naive records used server-local time
    except (ValueError, TypeError, OverflowError):
        return None


def application_metrics(records: dict, now: datetime | None = None) -> dict:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    msk = ZoneInfo("Europe/Moscow")
    today = now.astimezone(msk).date()
    hourly = [0] * 24
    by_account = {}
    for name, vacancies in records.items():
        item = {"today": 0, "total": len(vacancies), "last_sent_at": ""}
        last = None
        for record in vacancies.values():
            stamp = timestamp(record.get("at")) if isinstance(record, dict) else None
            if stamp is None or stamp > now:
                continue
            if stamp.astimezone(msk).date() == today:
                item["today"] += 1
            age = (now - stamp).total_seconds()
            if 0 <= age < 86400:
                hourly[23 - int(age // 3600)] += 1
            if last is None or stamp > last:
                last = stamp
        item["last_sent_at"] = last.isoformat() if last else ""
        by_account[name] = item
    return {"today": sum(v["today"] for v in by_account.values()),
            "last_24h": sum(hourly), "hourly": hourly, "by_account": by_account,
            "day_timezone": "Europe/Moscow", "generated_at": now.isoformat()}

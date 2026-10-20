"""Recognize HH challenges without exposing their state in logs."""
from urllib.parse import urlparse


def captcha_info(payload):
    if not isinstance(payload, dict):
        return None
    for error in payload.get("errors", []) or []:
        if not isinstance(error, dict):
            continue
        if "captcha_required" not in (error.get("type"), error.get("value")):
            continue
        url = error.get("captcha_url", "")
        parsed = urlparse(url) if isinstance(url, str) else None
        host = (parsed.hostname or "").lower() if parsed else ""
        safe = bool(parsed and parsed.scheme == "https" and not parsed.username
                    and not parsed.password and (host == "hh.ru" or host.endswith(".hh.ru")))
        return {"error_type": "captcha_required", "raw": "captcha_required",
                "captcha_url": url if safe else ""}
    return None

"""
Data query routes: applied, tests, interviews, vacancies, HR contacts.
"""

import threading

from fastapi import APIRouter, Request

from app.storage import (
    _load_cache, _cache_applied, _cache_tests, _cache_lock,
    get_applied_list, get_vacancy_db, get_test_list,
    get_interviews_list,
    _save_applied_async, _save_tests_async,
    resolve_review,
)
from app.instances import bot


router = APIRouter()


@router.get("/api/applied")
async def api_applied(limit: int = 300):
    return get_applied_list(limit)


@router.get("/api/tests")
async def api_tests(limit: int = 300):
    return get_test_list(limit)


@router.post("/api/tests/{vacancy_id}/resolve")
async def api_resolve_review(vacancy_id: str, request: Request):
    body = await request.json()
    if body.get("confirmed_not_sent") is not True:
        return {"ok": False, "error": "Сначала проверьте отсутствие отклика на HH."}
    account = str(body.get("account_name") or "")
    resume = str(body.get("resume_hash") or "")
    try:
        resolved = resolve_review(vacancy_id, account, resume, body.get("expected_at"))
    except Exception:
        return {"ok": False, "error": "Не удалось сохранить решение. Блокировка оставлена."}
    if not resolved:
        return {"ok": False, "error": "Запись уже изменилась. Обновите список."}
    # Clear only the local retry backoff. Protective account pauses remain.
    for state in [*bot.account_states, *bot.temp_states.values()]:
        if state.acc.get("name") == account:
            state._test_failures.pop(vacancy_id, None)
    return {"ok": True}


@router.get("/api/interviews")
async def api_interviews(acc: str = "", limit: int = 2000, status: str = "", redact: bool = False):
    items = get_interviews_list(acc=acc, limit=limit, status=status)
    if not redact:
        return items
    redacted = []
    for item in items:
        copy = dict(item)
        for field in ("llm_reply", "employer_last_msg"):
            val = copy.get(field)
            if isinstance(val, str) and len(val) > 80:
                copy[field] = val[:80] + "…"
        redacted.append(copy)
    return redacted


@router.get("/api/vacancies")
async def api_vacancies(limit: int = 3000):
    return get_vacancy_db(limit)


@router.delete("/api/vacancy/{vacancy_id}")
async def api_vacancy_delete(vacancy_id: str, account: str = ""):
    """Удалить вакансию из applied и/или test кэша."""
    _load_cache()
    removed = []
    with _cache_lock:
        if account:
            if account in _cache_applied and vacancy_id in _cache_applied[account]:
                del _cache_applied[account][vacancy_id]
                removed.append(f"applied:{account}")
        else:
            for acc_name in list(_cache_applied.keys()):
                if vacancy_id in _cache_applied[acc_name]:
                    del _cache_applied[acc_name][vacancy_id]
                    removed.append(f"applied:{acc_name}")
        if vacancy_id in _cache_tests:
            del _cache_tests[vacancy_id]
            removed.append("test")
    if "applied" in " ".join(removed):
        threading.Thread(target=_save_applied_async, daemon=True).start()
    if "test" in " ".join(removed):
        threading.Thread(target=_save_tests_async, daemon=True).start()
    return {"ok": True, "removed": removed}


@router.get("/api/hr_contacts")
async def api_hr_contacts():
    """Return collected HR contact info from vacancy pre-checks."""
    return {"contacts": list(bot.hr_contacts), "total": len(bot.hr_contacts)}

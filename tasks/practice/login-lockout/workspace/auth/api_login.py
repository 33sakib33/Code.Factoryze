"""API sign-in handler. Clients send a JSON body with a username and a password."""
from .accounts import find_password
from .lockout import AttemptLog


def api_login(log: AttemptLog, accounts: dict[str, str], body: dict[str, str]) -> dict[str, str]:
    """Return {"status": "ok" | "invalid" | "locked"} for one sign-in attempt from the API."""
    user = body.get("username", "")
    secret = body.get("password", "")
    if log.is_locked(user):
        return {"status": "locked"}
    stored = find_password(accounts, user)
    if stored is None or stored != secret:
        log.record_failure(user)
        return {"status": "invalid"}
    log.clear(user)
    return {"status": "ok"}

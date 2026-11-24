"""Sign-in page handler."""
from .accounts import find_password
from .lockout import AttemptLog


def web_login(log: AttemptLog, accounts: dict[str, str], username: str, password: str) -> str:
    """Return "ok", "invalid" or "locked" for one sign-in attempt from the page."""
    if log.is_locked(username):
        return "locked"
    stored = find_password(accounts, username)
    if stored is None or stored != password:
        log.record_failure(username)
        return "invalid"
    log.clear(username)
    return "ok"

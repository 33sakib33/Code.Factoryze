from auth import lockout
from auth.api_login import api_login
from auth.lockout import AttemptLog
from auth.web_login import web_login

ACCOUNTS = {"alice": "correct horse", "bashir": "battery staple"}


def api(log, username, password):
    return api_login(log, ACCOUNTS, {"username": username, "password": password})["status"]


def test_changing_letter_case_does_not_reset_the_count_on_the_page():
    log = AttemptLog()
    for name in ("alice", "Alice", "ALICE", "aLiCe", "alice"):
        assert web_login(log, ACCOUNTS, name, "guess") == "invalid"
    assert web_login(log, ACCOUNTS, "Alice", "correct horse") == "locked"
    assert web_login(log, ACCOUNTS, "alice", "correct horse") == "locked"


def test_changing_letter_case_does_not_reset_the_count_on_the_api():
    log = AttemptLog()
    for name in ("alice", "Alice", "ALICE", "aLiCe", "alice"):
        assert api(log, name, "guess") == "invalid"
    assert api(log, "Alice", "correct horse") == "locked"
    assert api(log, "alice", "correct horse") == "locked"


def test_spaces_around_the_username_do_not_reset_the_count():
    log = AttemptLog()
    for name in ("alice", " alice", "alice ", "  alice  ", "\talice"):
        assert web_login(log, ACCOUNTS, name, "guess") == "invalid"
    assert web_login(log, ACCOUNTS, "alice", "correct horse") == "locked"
    other = AttemptLog()
    for name in ("alice", " alice", "alice ", "  Alice  ", "\talice"):
        assert api(other, name, "guess") == "invalid"
    assert api(other, "alice", "correct horse") == "locked"


def test_failures_on_the_page_and_the_api_count_together():
    log = AttemptLog()
    for name in ("alice", "Alice", "ALICE"):
        assert web_login(log, ACCOUNTS, name, "guess") == "invalid"
    for name in (" alice", "aLICE"):
        assert api(log, name, "guess") == "invalid"
    assert web_login(log, ACCOUNTS, "alice", "correct horse") == "locked"
    assert api(log, "alice", "correct horse") == "locked"


def test_signing_in_with_another_spelling_clears_the_account():
    log = AttemptLog()
    for _ in range(4):
        assert web_login(log, ACCOUNTS, "alice", "guess") == "invalid"
    assert api(log, " Alice ", "correct horse") == "ok"
    for _ in range(4):
        assert web_login(log, ACCOUNTS, "alice", "guess") == "invalid"
    assert web_login(log, ACCOUNTS, "ALICE", "correct horse") == "ok"


def test_other_accounts_are_not_locked_and_the_limit_is_unchanged():
    log = AttemptLog()
    for name in ("alice", "Alice", "ALICE", "aLiCe", "alice"):
        web_login(log, ACCOUNTS, name, "guess")
    assert web_login(log, ACCOUNTS, "bashir", "battery staple") == "ok"
    assert api(log, "Bashir", "battery staple") == "ok"
    assert lockout.MAX_FAILED_ATTEMPTS == 5

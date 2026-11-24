from auth.api_login import api_login
from auth.lockout import AttemptLog
from auth.web_login import web_login

ACCOUNTS = {"alice": "correct horse", "bashir": "battery staple"}


def test_right_password_signs_in_on_both_routes():
    log = AttemptLog()
    assert web_login(log, ACCOUNTS, "alice", "correct horse") == "ok"
    assert api_login(log, ACCOUNTS, {"username": "bashir", "password": "battery staple"}) == {"status": "ok"}


def test_wrong_password_and_unknown_account_are_invalid():
    log = AttemptLog()
    assert web_login(log, ACCOUNTS, "alice", "guess") == "invalid"
    assert web_login(log, ACCOUNTS, "nobody", "guess") == "invalid"


def test_five_failures_lock_the_account_on_the_page():
    log = AttemptLog()
    for _ in range(5):
        assert web_login(log, ACCOUNTS, "alice", "guess") == "invalid"
    assert web_login(log, ACCOUNTS, "alice", "correct horse") == "locked"


def test_a_successful_sign_in_clears_earlier_failures():
    log = AttemptLog()
    for _ in range(4):
        web_login(log, ACCOUNTS, "alice", "guess")
    assert web_login(log, ACCOUNTS, "alice", "correct horse") == "ok"
    for _ in range(4):
        assert web_login(log, ACCOUNTS, "alice", "guess") == "invalid"

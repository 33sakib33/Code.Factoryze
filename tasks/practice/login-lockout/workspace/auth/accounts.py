"""Account lookup. Passwords are plain text only because this is an exercise."""


def find_password(accounts: dict[str, str], username: str) -> str | None:
    """Return the stored password for a username, or None when there is no such account."""
    return accounts.get(username.strip().lower())

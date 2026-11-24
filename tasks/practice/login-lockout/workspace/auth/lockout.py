"""Failed sign-in counting shared by every way of signing in."""

MAX_FAILED_ATTEMPTS = 5


class AttemptLog:
    """Counts failed sign-ins. One log is shared by the sign-in page and the API."""

    def __init__(self) -> None:
        self._failures: dict[str, int] = {}

    def failures(self, key: str) -> int:
        return self._failures.get(key, 0)

    def record_failure(self, key: str) -> None:
        self._failures[key] = self.failures(key) + 1

    def clear(self, key: str) -> None:
        self._failures.pop(key, None)

    def is_locked(self, key: str) -> bool:
        return self.failures(key) >= MAX_FAILED_ATTEMPTS

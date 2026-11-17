"""Bounded retries for a synthetic upstream service."""

from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Response:
    status: int
    body: str = ""


def fetch_with_retry(
    send: Callable[[], Response],
    wait: Callable[[float], None],
    max_attempts: int = 3,
) -> Response:
    """Return an upstream response after no more than max_attempts calls."""
    if max_attempts < 1:
        raise ValueError("max_attempts must be positive")

    for attempt in range(max_attempts):
        response = send()
        if response.status == 200 or attempt == max_attempts - 1:
            return response
        wait(0.25 * (2**attempt))

    raise AssertionError("unreachable")

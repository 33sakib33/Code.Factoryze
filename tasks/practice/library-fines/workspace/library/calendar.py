"""Opening days. Fines only count days the branch was open."""
from datetime import date, timedelta

from .models import Branch

HOLIDAYS = frozenset({date(2026, 4, 3), date(2026, 4, 6)})  # Good Friday, Easter Monday


def is_open(branch: Branch, day: date) -> bool:
    return day.weekday() not in branch.closed_weekdays and day not in HOLIDAYS


def next_open_day(branch: Branch, day: date) -> date:
    """`day` itself if the branch is open, otherwise the next day it is."""
    for _ in range(14):
        if is_open(branch, day):
            return day
        day += timedelta(days=1)
    raise ValueError(f"branch {branch.id} has no open day within two weeks of {day}")


def open_days_between(branch: Branch, start: date, end: date) -> int:
    """Open days after `start`, up to and including `end`. Zero when `end` is not after `start`."""
    count, day = 0, start + timedelta(days=1)
    while day <= end:
        count += is_open(branch, day)
        day += timedelta(days=1)
    return count

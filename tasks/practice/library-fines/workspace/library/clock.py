"""Branch-local time. Timestamps are stored in UTC; lending rules use the branch's local calendar day.

The sample branches use fixed UTC offsets, so there is no daylight saving here.
"""
from datetime import date, datetime, timedelta, timezone

from .models import Branch


def branch_zone(branch: Branch) -> timezone:
    return timezone(timedelta(minutes=branch.utc_offset_minutes))


def local_time(timestamp: datetime, branch: Branch) -> datetime:
    if timestamp.tzinfo is None:
        raise ValueError("timestamps must be timezone-aware")
    return timestamp.astimezone(branch_zone(branch))


def local_day(timestamp: datetime, branch: Branch) -> date:
    """The calendar day at the branch when `timestamp` happened."""
    return local_time(timestamp, branch).date()

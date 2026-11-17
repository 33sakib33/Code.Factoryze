"""Plain data types. Timestamps are timezone-aware; money is integer cents."""
from dataclasses import dataclass
from datetime import date, datetime


@dataclass(frozen=True)
class Branch:
    id: str
    name: str
    utc_offset_minutes: int
    closed_weekdays: frozenset[int]  # Monday is 0


@dataclass(frozen=True)
class Item:
    id: str
    title: str
    kind: str  # "book", "dvd" or "reference"


@dataclass(frozen=True)
class Member:
    id: str
    name: str
    branch_id: str
    concession: bool = False


@dataclass(frozen=True)
class Loan:
    id: str
    item_id: str
    member_id: str
    branch_id: str
    checked_out_at: datetime
    due_on: date
    renewals: int = 0


@dataclass(frozen=True)
class Return:
    loan_id: str
    returned_at: datetime
    returned_on: date
    open_days_late: int
    fine_cents: int


@dataclass(frozen=True)
class Notice:
    loan_id: str
    member_id: str
    open_days_late: int
    fine_so_far_cents: int

"""Overdue notices, sent each morning for loans past their due date."""
from collections.abc import Iterable, Mapping
from datetime import datetime

from .calendar import open_days_between
from .clock import local_day
from .fines import fine_for
from .models import Branch, Item, Loan, Member, Notice


def overdue_notices(loans: Iterable[Loan], items: Mapping[str, Item], members: Mapping[str, Member],
                    branches: Mapping[str, Branch], now: datetime) -> list[Notice]:
    notices = []
    for loan in sorted(loans, key=lambda item: item.id):
        branch = branches[loan.branch_id]
        days_late = open_days_between(branch, loan.due_on, local_day(now, branch))
        if days_late > 0:
            fine = fine_for(items[loan.item_id], days_late, members[loan.member_id])
            notices.append(Notice(loan.id, loan.member_id, days_late, fine))
    return notices

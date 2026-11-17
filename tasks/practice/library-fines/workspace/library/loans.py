"""Checkout and renewal. Due dates fall on a day the branch is open."""
from dataclasses import replace
from datetime import datetime, timedelta

from .calendar import next_open_day
from .clock import local_day
from .models import Branch, Item, Loan, Member

LOAN_DAYS = {"book": 21, "dvd": 7}
MAX_RENEWALS = 2


def checkout(loan_id: str, item: Item, member: Member, branch: Branch, at: datetime) -> Loan:
    if item.kind not in LOAN_DAYS:
        raise ValueError(f"{item.kind} items can't be borrowed")
    if member.branch_id != branch.id:
        raise ValueError(f"member {member.id} belongs to branch {member.branch_id}")
    start = local_day(at, branch)
    due = next_open_day(branch, start + timedelta(days=LOAN_DAYS[item.kind]))
    return Loan(loan_id, item.id, member.id, branch.id, at, due)


def renew(loan: Loan, item: Item, branch: Branch, at: datetime) -> Loan:
    """Extends the loan by one loan period from its current due date."""
    if loan.renewals >= MAX_RENEWALS:
        raise ValueError(f"loan {loan.id} has already been renewed {MAX_RENEWALS} times")
    if local_day(at, branch) > loan.due_on:
        raise ValueError(f"loan {loan.id} is overdue and can't be renewed")
    due = next_open_day(branch, loan.due_on + timedelta(days=LOAN_DAYS[item.kind]))
    return replace(loan, due_on=due, renewals=loan.renewals + 1)

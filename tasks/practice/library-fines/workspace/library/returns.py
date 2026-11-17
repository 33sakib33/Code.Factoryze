"""Processing a return."""
from datetime import datetime

from .calendar import open_days_between
from .fines import fine_for
from .models import Branch, Item, Loan, Member, Return


def process_return(loan: Loan, item: Item, member: Member, branch: Branch, returned_at: datetime) -> Return:
    """Records the return and the fine owed. A return on or before the due date is never late."""
    if loan.item_id != item.id or loan.member_id != member.id or loan.branch_id != branch.id:
        raise ValueError(f"loan {loan.id} doesn't match the item, member or branch given")
    if returned_at < loan.checked_out_at:
        raise ValueError(f"loan {loan.id} can't be returned before it was checked out")
    returned_on = returned_at.date()
    days_late = open_days_between(branch, loan.due_on, returned_on)
    return Return(loan.id, returned_at, returned_on, days_late, fine_for(item, days_late, member))

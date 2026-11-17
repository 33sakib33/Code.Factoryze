"""Fine rates. Fines grow per open day late, up to a cap per item."""
from .models import Item, Member

RATE_CENTS = {"book": 25, "dvd": 100}
CAP_CENTS = {"book": 1000, "dvd": 1500}


def fine_for(item: Item, open_days_late: int, member: Member) -> int:
    """Concession members pay half, rounded down to the cent."""
    if open_days_late <= 0:
        return 0
    fine = min(CAP_CENTS[item.kind], RATE_CENTS[item.kind] * open_days_late)
    return fine // 2 if member.concession else fine

import unittest
from datetime import datetime

from library.loans import checkout
from library.models import Item
from library.returns import process_return
from library.storage import load


def returned(loan_id, at):
    branches, items, members, loans = load()
    loan = loans[loan_id]
    return process_return(loan, items[loan.item_id], members[loan.member_id], branches[loan.branch_id], datetime.fromisoformat(at))


def test_on_time_return_at_central():
    result = returned("L-203", "2026-03-12T17:00:00+00:00")
    assert (result.open_days_late, result.fine_cents) == (0, 0)


def test_late_book_at_central_skips_sunday():
    result = returned("L-203", "2026-03-16T10:00:00+00:00")
    assert (result.open_days_late, result.fine_cents) == (3, 75)


def test_dvd_fine_is_capped_and_halved_for_concessions():
    assert returned("L-205", "2026-05-20T12:00:00+00:00").fine_cents == 750


def test_due_date_moves_past_a_holiday():
    branches, items, members, _ = load()
    loan = checkout("L-900", items["B2"], members["M1"], branches["CEN"], datetime.fromisoformat("2026-03-13T10:00:00+00:00"))
    assert loan.due_on.isoformat() == "2026-04-04"


def test_reference_items_cannot_be_borrowed():
    branches, items, members, _ = load()
    try:
        checkout("L-901", items["R1"], members["M1"], branches["CEN"], datetime.fromisoformat("2026-03-13T10:00:00+00:00"))
    except ValueError:
        return
    assert False, "expected ValueError"


def load_tests(loader, tests, pattern):
    """Lets `python -m unittest` run the plain test functions above."""
    checks = [value for name, value in sorted(globals().items()) if name.startswith("test_") and callable(value)]
    return unittest.TestSuite(unittest.FunctionTestCase(check) for check in checks)

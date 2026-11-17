from datetime import datetime

from library.loans import checkout, renew
from library.notices import overdue_notices
from library.returns import process_return
from library.storage import load


def at(text):
    return datetime.fromisoformat(text)


def returned(loan_id, timestamp):
    branches, items, members, loans = load()
    loan = loans[loan_id]
    return process_return(loan, items[loan.item_id], members[loan.member_id], branches[loan.branch_id], at(timestamp))


def test_evening_return_on_due_date_is_on_time_at_riverside():
    result = returned("L-201", "2026-03-11T01:30:00+00:00")  # 20:30 on 10 March at Riverside
    assert (result.returned_on.isoformat(), result.open_days_late, result.fine_cents) == ("2026-03-10", 0, 0)


def test_morning_return_after_due_date_is_late_at_riverside():
    result = returned("L-201", "2026-03-11T14:00:00+00:00")  # 09:00 on 11 March
    assert (result.open_days_late, result.fine_cents) == (1, 25)


def test_concession_dvd_evening_return_at_riverside():
    result = returned("L-202", "2026-03-12T02:00:00+00:00")  # 21:00 on 11 March
    assert (result.open_days_late, result.fine_cents) == (1, 50)


def test_early_morning_late_return_at_harbour():
    result = returned("L-204", "2026-03-10T22:30:00+00:00")  # 08:30 on 11 March at Harbour
    assert (result.returned_on.isoformat(), result.open_days_late, result.fine_cents) == ("2026-03-11", 1, 25)


def test_closed_days_and_holidays_are_not_counted():
    assert returned("L-206", "2026-04-07T15:00:00+00:00").open_days_late == 1  # Sunday and Easter Monday skipped
    assert returned("L-206", "2026-04-08T03:00:00+00:00").open_days_late == 1  # still 7 April at Riverside


def test_fine_rules_are_unchanged():
    assert returned("L-203", "2026-03-16T10:00:00+00:00").fine_cents == 75
    assert returned("L-207", "2026-04-01T12:00:00+00:00").fine_cents == 400  # 4 open days, DVD
    assert returned("L-205", "2026-04-03T12:00:00+00:00").fine_cents == 100  # concession, 2 open days, Good Friday skipped


def test_notices_use_the_branch_day():
    branches, items, members, loans = load()
    notices = overdue_notices(loans.values(), items, members, branches, at("2026-03-11T03:00:00+00:00"))
    assert [(n.loan_id, n.open_days_late) for n in notices] == [("L-204", 1)]


def test_evening_checkout_uses_the_branch_day():
    branches, items, members, _ = load()
    loan = checkout("L-910", items["D3"], members["M2"], branches["RIV"], at("2026-03-04T04:30:00+00:00"))
    assert loan.due_on.isoformat() == "2026-03-10"


def test_renewal_on_the_due_date_evening_is_allowed():
    branches, items, _, loans = load()
    renewed = renew(loans["L-201"], items["B1"], branches["RIV"], at("2026-03-11T02:00:00+00:00"))
    assert (renewed.due_on.isoformat(), renewed.renewals) == ("2026-03-31", 1)

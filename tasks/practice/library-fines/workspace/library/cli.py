"""Command line: `python -m library.cli return LOAN_ID --at TIMESTAMP` or `python -m library.cli notices --at TIMESTAMP`."""
import argparse
import sys
from datetime import datetime, timezone

from .notices import overdue_notices
from .returns import process_return
from .storage import DEFAULT_DATA, load


def utc_timestamp(text: str) -> datetime:
    """Timestamps are stored in UTC, as the circulation desk records them."""
    value = datetime.fromisoformat(text)
    if value.tzinfo is None:
        raise argparse.ArgumentTypeError("include a UTC offset, for example 2026-03-10T20:30:00-05:00")
    return value.astimezone(timezone.utc)


def cents(value: int) -> str:
    return f"${value // 100}.{value % 100:02d}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="library")
    parser.add_argument("--data", default=str(DEFAULT_DATA))
    commands = parser.add_subparsers(dest="command", required=True)
    returning = commands.add_parser("return")
    returning.add_argument("loan_id")
    returning.add_argument("--at", required=True, type=utc_timestamp)
    commands.add_parser("notices").add_argument("--at", required=True, type=utc_timestamp)
    args = parser.parse_args(argv)
    branches, items, members, loans = load(args.data)
    if args.command == "return":
        loan = loans.get(args.loan_id)
        if loan is None:
            print(f"No loan {args.loan_id}", file=sys.stderr)
            return 1
        result = process_return(loan, items[loan.item_id], members[loan.member_id], branches[loan.branch_id], args.at)
        print(f"{loan.id}: returned {result.returned_on}, {result.open_days_late} open days late, fine {cents(result.fine_cents)}")
    else:
        for notice in overdue_notices(loans.values(), items, members, branches, args.at):
            print(f"{notice.loan_id} {notice.member_id}: {notice.open_days_late} open days late, {cents(notice.fine_so_far_cents)} so far")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

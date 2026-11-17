# library

Loans, returns, fines and overdue notices for a small library with three branches.

- `library/models.py`: branches, items, members, loans and returns
- `library/clock.py`: branch-local time (timestamps are stored in UTC)
- `library/calendar.py`: opening days and public holidays
- `library/loans.py`: checkout and renewal
- `library/returns.py`: processing a return
- `library/fines.py`: fine rates and caps
- `library/notices.py`: overdue notices
- `library/storage.py`: loads `data/library.json`
- `library/cli.py`: `python -m library.cli return LOAN_ID --at 2026-03-10T20:30:00-05:00` or `python -m library.cli notices --at ...`

Lending rules use each branch's local calendar day. Run the tests with `python -m unittest`.

On Windows the agent uses Windows PowerShell. Run the test command directly: PowerShell 5.1 has no Bash `&&`, `head` or `tail`. The agent selects the task's Python environment automatically.

# billing

Prices orders, prints invoices and builds the monthly revenue report for a small shop.

- `billing/models.py`: products, customers, orders and invoices
- `billing/catalog.py`: product lookup by SKU
- `billing/promotions.py`: loyalty tiers, promo codes and bulk discounts
- `billing/tax.py`: sales tax by region
- `billing/money.py`: integer cents and half-up rounding
- `billing/invoice.py`: builds one invoice
- `billing/report.py`: monthly revenue report
- `billing/storage.py`: loads the JSON export in `data/orders.json`
- `billing/cli.py`: `python -m billing.cli invoice ORDER_ID` or `python -m billing.cli report`

Run the tests with `python -m unittest`.

On Windows the agent uses Windows PowerShell. Run the test command directly: PowerShell 5.1 has no Bash `&&`, `head` or `tail`. The agent selects the task's Python environment automatically.

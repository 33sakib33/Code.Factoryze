"""Command line: `python -m billing.cli invoice ORDER_ID` or `python -m billing.cli report`."""
import argparse
import sys

from .invoice import build_invoice
from .models import Invoice
from .money import format_cents
from .report import monthly_report, render_report
from .storage import DEFAULT_DATA, load


def render_invoice(invoice: Invoice) -> str:
    rows = [f"Invoice {invoice.order_id} for {invoice.customer_id}, {invoice.placed_on.isoformat()}"]
    for line in invoice.lines:
        discount = f" (-{format_cents(line.discount_cents)})" if line.discount_cents else ""
        rows.append(f"  {line.quantity:>3} x {line.description:<22} {format_cents(line.total_cents):>10}{discount}")
    rows += [f"  Subtotal {format_cents(invoice.subtotal_cents):>35}",
             f"  Discount {format_cents(-invoice.discount_cents):>35}",
             f"  Tax      {format_cents(invoice.tax_cents):>35}",
             f"  Total    {format_cents(invoice.total_cents):>35}"]
    return "\n".join(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="billing")
    parser.add_argument("--data", default=str(DEFAULT_DATA))
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("invoice").add_argument("order_id")
    commands.add_parser("report")
    args = parser.parse_args(argv)
    catalog, customers, orders = load(args.data)
    if args.command == "invoice":
        order = next((item for item in orders if item.id == args.order_id), None)
        if order is None:
            print(f"No order {args.order_id}", file=sys.stderr)
            return 1
        print(render_invoice(build_invoice(order, catalog, customers[order.customer_id])))
    else:
        print(render_report(monthly_report(orders, catalog, customers)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

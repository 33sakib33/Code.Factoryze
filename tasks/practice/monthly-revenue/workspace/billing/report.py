"""Monthly revenue report. Revenue is net of discounts and excludes tax."""
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from .catalog import Catalog
from .invoice import build_invoice
from .models import Customer, Order
from .money import format_cents


@dataclass
class MonthSummary:
    month: str
    invoices: int = 0
    revenue_cents: int = 0
    discount_cents: int = 0
    tax_cents: int = 0
    refunded_orders: int = 0


def monthly_report(orders: Iterable[Order], catalog: Catalog, customers: Mapping[str, Customer]) -> dict[str, MonthSummary]:
    """Summarise orders by calendar month (YYYY-MM). Refunded orders are counted but earn nothing."""
    months: dict[str, MonthSummary] = {}
    for order in sorted(orders, key=lambda item: (item.placed_on, item.id)):
        month = order.placed_on.strftime("%Y-%m")
        summary = months.setdefault(month, MonthSummary(month))
        if order.refunded:
            summary.refunded_orders += 1
            continue
        invoice = build_invoice(order, catalog, customers[order.customer_id])
        summary.invoices += 1
        summary.revenue_cents += invoice.subtotal_cents - invoice.discount_cents
        summary.discount_cents += invoice.discount_cents + sum(line.discount_cents for line in invoice.lines)
        summary.tax_cents += invoice.tax_cents
    return dict(sorted(months.items()))


def render_report(months: Mapping[str, MonthSummary]) -> str:
    rows = [f"{'Month':<8} {'Invoices':>8} {'Revenue':>12} {'Discounts':>11} {'Tax':>10} {'Refunded':>8}"]
    for s in months.values():
        rows.append(f"{s.month:<8} {s.invoices:>8} {format_cents(s.revenue_cents):>12} "
                    f"{format_cents(s.discount_cents):>11} {format_cents(s.tax_cents):>10} {s.refunded_orders:>8}")
    return "\n".join(rows)

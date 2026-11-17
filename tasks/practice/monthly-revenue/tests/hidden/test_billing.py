from datetime import date

from billing.invoice import build_invoice
from billing.models import Customer, Order, OrderLine
from billing.report import monthly_report
from billing.storage import load


def invoice_for(order_id):
    catalog, customers, orders = load()
    order = next(item for item in orders if item.id == order_id)
    return build_invoice(order, catalog, customers[order.customer_id])


def amounts(invoice):
    return invoice.subtotal_cents, invoice.discount_cents, invoice.tax_cents, invoice.total_cents


def test_invoices_do_not_share_promotions():
    invoice_for("O-1009")
    assert amounts(invoice_for("O-1011")) == (2450, 123, 151, 2478)
    invoice_for("O-1004")
    assert [line.discount_cents for line in invoice_for("O-1008").lines] == [0, 0]


def test_same_order_twice_gives_same_invoice():
    assert invoice_for("O-1003") == invoice_for("O-1003")


def test_report_for_sample_data():
    catalog, customers, orders = load()
    report = monthly_report(orders, catalog, customers)
    rows = {m: (s.invoices, s.revenue_cents, s.discount_cents, s.tax_cents, s.refunded_orders) for m, s in report.items()}
    assert rows == {"2026-03": (5, 32894, 3709, 1333, 1), "2026-04": (6, 44974, 6192, 1988, 0)}, rows


def test_report_does_not_depend_on_order_or_repeats():
    catalog, customers, orders = load()
    first = monthly_report(orders, catalog, customers)
    assert monthly_report(list(reversed(orders)), catalog, customers) == first
    assert monthly_report(orders, catalog, customers) == first


def test_order_discount_is_capped():
    catalog, _, _ = load()
    vip = Customer("V1", "Vic", "north", "gold")
    invoice = build_invoice(Order("T-1", "V1", date(2026, 6, 1), (OrderLine("DSK-LMP", 2),), "VIP20"), catalog, vip)
    assert invoice.discount_cents == 2288  # 25% cap, not 30%


def test_bulk_discount_only_on_its_line():
    assert [line.discount_cents for line in invoice_for("O-1001").lines] == [0, 139, 0]
    assert [line.discount_cents for line in invoice_for("O-1010").lines] == [232, 300]


def test_promo_codes_respect_dates_and_case():
    assert invoice_for("O-1006").discount_cents == 75  # WELCOME5 expired; gold only
    assert invoice_for("O-1008").discount_cents == 670  # lowercase spring10 still applies


def test_groceries_are_tax_exempt_in_the_south():
    assert amounts(invoice_for("O-1001")) == (4400, 0, 202, 4602)
    assert invoice_for("O-1012").tax_cents == 0


def test_refunded_orders_earn_nothing():
    catalog, customers, orders = load()
    march = monthly_report([o for o in orders if o.id in {"O-1005"}], catalog, customers)["2026-03"]
    assert (march.invoices, march.revenue_cents, march.refunded_orders) == (0, 0, 1)

import unittest

from billing.invoice import build_invoice
from billing.money import format_cents, percent_of
from billing.storage import load


def test_gold_customer_invoice():
    catalog, customers, orders = load()
    order = next(item for item in orders if item.id == "O-1002")
    invoice = build_invoice(order, catalog, customers["C1"])
    assert (invoice.subtotal_cents, invoice.discount_cents, invoice.tax_cents, invoice.total_cents) == (11449, 1145, 824, 11128)


def test_money_rounds_half_up():
    assert percent_of(25, 10) == 3
    assert format_cents(-1234) == "-$12.34"


def load_tests(loader, tests, pattern):
    """Lets `python -m unittest` run the plain test functions above."""
    checks = [value for name, value in sorted(globals().items()) if name.startswith("test_") and callable(value)]
    return unittest.TestSuite(unittest.FunctionTestCase(check) for check in checks)

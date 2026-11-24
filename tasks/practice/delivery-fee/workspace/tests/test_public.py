from decimal import Decimal

from shop.delivery import delivery_fee, order_total


def test_small_orders_pay_the_standard_fee():
    assert delivery_fee(Decimal("12.50")) == Decimal("5.00")
    assert delivery_fee(Decimal("49.99")) == Decimal("5.00")


def test_large_orders_ship_free():
    assert delivery_fee(Decimal("80.00")) == Decimal("0.00")


def test_order_total_adds_the_fee():
    assert order_total(Decimal("20.00")) == Decimal("25.00")
    assert order_total(Decimal("80.00")) == Decimal("80.00")

from decimal import Decimal

from shop import delivery
from shop.delivery import delivery_fee, order_total


def test_an_order_of_exactly_fifty_pounds_ships_free():
    assert delivery_fee(Decimal("50.00")) == Decimal("0.00")
    assert delivery_fee(Decimal("50")) == Decimal("0.00")


def test_orders_just_above_the_line_ship_free():
    assert delivery_fee(Decimal("50.01")) == Decimal("0.00")
    assert delivery_fee(Decimal("100.00")) == Decimal("0.00")


def test_orders_just_below_the_line_pay_the_fee():
    assert delivery_fee(Decimal("49.99")) == Decimal("5.00")
    assert delivery_fee(Decimal("0.00")) == Decimal("5.00")


def test_order_total_at_the_line_has_no_fee():
    assert order_total(Decimal("50.00")) == Decimal("50.00")
    assert order_total(Decimal("49.99")) == Decimal("54.99")


def test_the_fee_and_the_free_delivery_amount_are_unchanged():
    assert delivery.STANDARD_FEE == Decimal("5.00")
    assert delivery.FREE_DELIVERY_FROM == Decimal("50.00")

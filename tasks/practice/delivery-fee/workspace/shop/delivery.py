"""Delivery charges for the shop checkout. Amounts are in pounds."""
from decimal import Decimal

FREE_DELIVERY_FROM = Decimal("50.00")
STANDARD_FEE = Decimal("5.00")


def delivery_fee(subtotal: Decimal) -> Decimal:
    """Return the delivery charge for a basket subtotal."""
    if subtotal > FREE_DELIVERY_FROM:
        return Decimal("0.00")
    return STANDARD_FEE


def order_total(subtotal: Decimal) -> Decimal:
    """Return what the customer pays: the basket plus delivery."""
    return subtotal + delivery_fee(subtotal)

"""Promotions: loyalty tiers and promo codes discount the whole order; bulk lines get their own discount."""
from dataclasses import dataclass
from datetime import date

from .models import Customer, Order

TIER_DISCOUNTS = {"silver": 5, "gold": 10}
BULK_THRESHOLD = 10
BULK_PERCENT = 8
MAX_ORDER_PERCENT = 25


@dataclass(frozen=True)
class Promotion:
    kind: str  # "tier", "code" or "bulk"
    percent: int
    sku: str | None = None  # bulk promotions apply to one line only


@dataclass(frozen=True)
class PromoCode:
    code: str
    percent: int
    starts: date
    ends: date

    def valid_on(self, day: date) -> bool:
        return self.starts <= day <= self.ends


PROMO_CODES = {
    "SPRING10": PromoCode("SPRING10", 10, date(2026, 3, 1), date(2026, 5, 31)),
    "WELCOME5": PromoCode("WELCOME5", 5, date(2026, 1, 1), date(2026, 2, 28)),
    "VIP20": PromoCode("VIP20", 20, date(2026, 1, 1), date(2026, 12, 31)),
}


def applicable_promotions(order: Order, customer: Customer, found=[]) -> list[Promotion]:
    """Collect the promotions that apply to this order."""
    if customer.tier in TIER_DISCOUNTS:
        found.append(Promotion("tier", TIER_DISCOUNTS[customer.tier]))
    if order.promo_code:
        code = PROMO_CODES.get(order.promo_code.strip().upper())
        if code and code.valid_on(order.placed_on):
            found.append(Promotion("code", code.percent))
    for line in order.lines:
        if line.quantity >= BULK_THRESHOLD:
            found.append(Promotion("bulk", BULK_PERCENT, line.sku))
    return found


def order_percent(promotions: list[Promotion]) -> int:
    """Tier and code discounts add up, capped at MAX_ORDER_PERCENT."""
    return min(MAX_ORDER_PERCENT, sum(p.percent for p in promotions if p.kind != "bulk"))


def line_percent(promotions: list[Promotion], sku: str) -> int:
    return BULK_PERCENT if any(p.kind == "bulk" and p.sku == sku for p in promotions) else 0

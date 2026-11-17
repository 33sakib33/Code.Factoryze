"""Sales tax by region. Some categories are exempt in some regions."""
from decimal import Decimal

from .money import percent_of

RATES = {"north": Decimal("8"), "south": Decimal("6.5"), "export": Decimal("0")}
EXEMPT = {"north": set(), "south": {"groceries"}, "export": set()}


def rate_for(region: str) -> Decimal:
    try:
        return RATES[region]
    except KeyError:
        raise ValueError(f"unknown tax region {region}") from None


def is_exempt(region: str, category: str) -> bool:
    return category in EXEMPT.get(region, set())


def tax_on(region: str, taxable_cents: int) -> int:
    return percent_of(taxable_cents, rate_for(region))

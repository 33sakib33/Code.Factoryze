"""Money helpers. Amounts are integer cents and rounding is half up."""
from decimal import ROUND_HALF_UP, Decimal


def to_cents(amount: Decimal) -> int:
    """Round a Decimal number of cents to a whole cent, half up."""
    return int(amount.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def percent_of(cents: int, percent: Decimal | int) -> int:
    """Return `percent` percent of `cents`, rounded half up."""
    return to_cents(Decimal(cents) * Decimal(percent) / 100)


def format_cents(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    whole, part = divmod(abs(cents), 100)
    return f"{sign}${whole:,}.{part:02d}"

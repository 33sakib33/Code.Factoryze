"""Plain data types shared by the billing modules. All money is integer cents."""
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Product:
    sku: str
    name: str
    unit_price_cents: int
    category: str


@dataclass(frozen=True)
class Customer:
    id: str
    name: str
    region: str
    tier: str = "standard"


@dataclass(frozen=True)
class OrderLine:
    sku: str
    quantity: int


@dataclass(frozen=True)
class Order:
    id: str
    customer_id: str
    placed_on: date
    lines: tuple[OrderLine, ...]
    promo_code: str | None = None
    refunded: bool = False


@dataclass(frozen=True)
class InvoiceLine:
    sku: str
    description: str
    quantity: int
    unit_price_cents: int
    discount_cents: int
    total_cents: int


@dataclass(frozen=True)
class Invoice:
    order_id: str
    customer_id: str
    placed_on: date
    lines: tuple[InvoiceLine, ...]
    subtotal_cents: int
    discount_cents: int
    tax_cents: int
    total_cents: int

"""Loads the catalog, customers and orders from a JSON export."""
import json
from datetime import date
from pathlib import Path

from .catalog import Catalog
from .models import Customer, Order, OrderLine, Product

DEFAULT_DATA = Path(__file__).resolve().parent.parent / "data" / "orders.json"


def load(path: str | Path = DEFAULT_DATA) -> tuple[Catalog, dict[str, Customer], list[Order]]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    catalog = Catalog(Product(p["sku"], p["name"], p["unit_price_cents"], p["category"]) for p in data["products"])
    customers = {c["id"]: Customer(c["id"], c["name"], c["region"], c.get("tier", "standard")) for c in data["customers"]}
    orders = []
    for raw in data["orders"]:
        if raw["customer_id"] not in customers:
            raise ValueError(f"order {raw['id']} has unknown customer {raw['customer_id']}")
        lines = tuple(OrderLine(line["sku"], line["quantity"]) for line in raw["lines"])
        orders.append(Order(raw["id"], raw["customer_id"], date.fromisoformat(raw["placed_on"]), lines,
                            raw.get("promo_code"), raw.get("refunded", False)))
    return catalog, customers, orders

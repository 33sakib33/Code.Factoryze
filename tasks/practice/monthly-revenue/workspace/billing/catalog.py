"""Product lookup by SKU."""
from collections.abc import Iterable

from .models import Product


class Catalog:
    """Products keyed by SKU. SKUs are case-sensitive."""

    def __init__(self, products: Iterable[Product]):
        self._products: dict[str, Product] = {}
        for product in products:
            if product.sku in self._products:
                raise ValueError(f"duplicate SKU {product.sku}")
            if product.unit_price_cents < 0:
                raise ValueError(f"negative price for {product.sku}")
            self._products[product.sku] = product

    def get(self, sku: str) -> Product:
        try:
            return self._products[sku]
        except KeyError:
            raise KeyError(f"unknown SKU {sku}") from None

    def in_category(self, category: str) -> list[Product]:
        return sorted((p for p in self._products.values() if p.category == category), key=lambda p: p.sku)

    def __len__(self) -> int:
        return len(self._products)

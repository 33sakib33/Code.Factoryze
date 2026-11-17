"""Builds the invoice for one order."""
from .catalog import Catalog
from .models import Customer, Invoice, InvoiceLine, Order
from .money import percent_of
from .promotions import applicable_promotions, line_percent, order_percent
from .tax import is_exempt, tax_on


def build_invoice(order: Order, catalog: Catalog, customer: Customer) -> Invoice:
    """Bulk discounts apply per line, then the order discount applies to the subtotal. Tax is charged after discounts."""
    if order.customer_id != customer.id:
        raise ValueError(f"order {order.id} belongs to {order.customer_id}, not {customer.id}")
    promotions = applicable_promotions(order, customer)
    lines = []
    taxable_lines = 0
    for line in order.lines:
        if line.quantity <= 0:
            raise ValueError(f"order {order.id} has a non-positive quantity for {line.sku}")
        product = catalog.get(line.sku)
        gross = product.unit_price_cents * line.quantity
        line_discount = percent_of(gross, line_percent(promotions, line.sku))
        total = gross - line_discount
        lines.append(InvoiceLine(line.sku, product.name, line.quantity, product.unit_price_cents, line_discount, total))
        if not is_exempt(customer.region, product.category):
            taxable_lines += total
    subtotal = sum(item.total_cents for item in lines)
    percent = order_percent(promotions)
    discount = percent_of(subtotal, percent)
    taxable = taxable_lines - percent_of(taxable_lines, percent)
    tax = tax_on(customer.region, taxable)
    return Invoice(order.id, customer.id, order.placed_on, tuple(lines), subtotal, discount, tax, subtotal - discount + tax)

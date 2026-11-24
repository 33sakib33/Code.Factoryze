"""Prepares the customer list for the mailing tool."""
from .records import Customer


def merge_duplicates(customers: list[Customer]) -> list[Customer]:
    """Return one record per customer, in the order customers first appear."""
    merged: dict[str, Customer] = {}
    for customer in customers:
        if customer.email not in merged:
            merged[customer.email] = customer
    return list(merged.values())


def export_lines(customers: list[Customer]) -> list[str]:
    """One line per customer for the mailing tool: ``Name <email>``."""
    return [f"{customer.name} <{customer.email}>" for customer in merge_duplicates(customers)]

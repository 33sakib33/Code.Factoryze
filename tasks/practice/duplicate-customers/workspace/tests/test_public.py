from datetime import datetime

from crm.export import export_lines, merge_duplicates
from crm.records import Customer


def customer(email, name, verified, day):
    return Customer(email=email, name=name, verified=verified, updated_at=datetime(2026, 11, day, 9, 0))


def test_different_customers_are_all_kept_in_order():
    people = [customer("ana@example.com", "Ana Silva", True, 3), customer("bo@example.com", "Bo Chen", False, 1)]
    assert merge_duplicates(people) == people


def test_the_same_record_twice_appears_once():
    ana = customer("ana@example.com", "Ana Silva", True, 3)
    bo = customer("bo@example.com", "Bo Chen", False, 1)
    assert merge_duplicates([ana, bo, ana]) == [ana, bo]


def test_export_lines_show_name_and_email():
    people = [customer("ana@example.com", "Ana Silva", True, 3), customer("bo@example.com", "Bo Chen", False, 1)]
    assert export_lines(people) == ["Ana Silva <ana@example.com>", "Bo Chen <bo@example.com>"]

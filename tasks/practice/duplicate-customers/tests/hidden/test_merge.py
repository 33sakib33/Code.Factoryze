from datetime import datetime

from crm.export import export_lines, merge_duplicates
from crm.records import Customer


def customer(email, name, verified, day):
    return Customer(email=email, name=name, verified=verified, updated_at=datetime(2026, 11, day, 9, 0))


def test_emails_that_differ_only_by_letter_case_are_one_customer():
    newest = customer("Ana.Silva@example.com", "Ana Silva", True, 9)
    older = customer("ana.silva@example.com", "Ana S.", True, 2)
    bo = customer("bo@example.com", "Bo Chen", False, 1)
    assert merge_duplicates([newest, bo, older]) == [newest, bo]
    assert export_lines([newest, bo, older]) == ["Ana Silva <Ana.Silva@example.com>", "Bo Chen <bo@example.com>"]


def test_a_verified_record_wins_over_a_newer_unverified_one():
    verified_old = customer("ana.silva@example.com", "Ana Silva", True, 2)
    unverified_new = customer("Ana.Silva@example.com", "Ana S.", False, 20)
    assert merge_duplicates([verified_old, unverified_new]) == [verified_old]
    assert merge_duplicates([unverified_new, verified_old]) == [verified_old]


def test_the_most_recent_record_wins_when_both_are_verified():
    older = customer("ana.silva@example.com", "Ana S.", True, 2)
    newer = customer("ANA.SILVA@example.com", "Ana Silva", True, 15)
    assert merge_duplicates([older, newer]) == [newer]
    assert merge_duplicates([newer, older]) == [newer]


def test_the_most_recent_record_wins_when_neither_is_verified():
    older = customer("bo@example.com", "Bo C.", False, 4)
    newer = customer("Bo@Example.com", "Bo Chen", False, 11)
    assert merge_duplicates([older, newer]) == [newer]
    assert merge_duplicates([newer, older]) == [newer]


def test_three_records_keep_the_right_one_in_the_first_position():
    cara = customer("cara@example.com", "Cara Diaz", False, 5)
    unverified_latest = customer("ANA.SILVA@example.com", "A. Silva", False, 25)
    verified_mid = customer("ana.silva@example.com", "Ana Silva", True, 10)
    verified_old = customer("Ana.Silva@example.com", "Ana S.", True, 3)
    assert merge_duplicates([unverified_latest, cara, verified_old, verified_mid]) == [verified_mid, cara]

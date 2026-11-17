import unittest

from feed.feed import build_feed
from feed.sample import sample_database


def test_latest_entries_are_first():
    db = sample_database()
    try:
        assert [row["sequence"] for row in build_feed(db, "northstar")] == [3, 2, 1]
    finally:
        db.close()


def test_page_limit_is_preserved():
    db = sample_database()
    try:
        assert [row["sequence"] for row in build_feed(db, "northstar", 1)] == [3]
    finally:
        db.close()


def test_current_display_name_is_shown():
    db = sample_database()
    try:
        assert build_feed(db, "northstar")[-1]["member_name"] == "Mina"
    finally:
        db.close()


def test_former_members_keep_their_activity():
    db = sample_database()
    try:
        row = build_feed(db, "northstar")[0]
        assert row == {"sequence": 3, "member_id": 9,
                       "member_name": "Former member", "action": "closed an issue"}
    finally:
        db.close()


def test_other_workspaces_are_separate():
    db = sample_database()
    try:
        assert build_feed(db, "other") == [{"sequence": 4, "member_id": 1,
            "member_name": "Another person", "action": "private activity"}]
    finally:
        db.close()


def test_empty_workspace_returns_empty_page():
    db = sample_database()
    try:
        assert build_feed(db, "missing") == []
    finally:
        db.close()


def load_tests(loader, tests, pattern):
    checks = [value for name, value in sorted(globals().items())
              if name.startswith("test_") and callable(value)]
    return unittest.TestSuite(unittest.FunctionTestCase(check) for check in checks)

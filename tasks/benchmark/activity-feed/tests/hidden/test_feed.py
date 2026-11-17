"""Check actual SQLite reads; no wall-clock thresholds or external dependencies."""
import sqlite3

from feed.feed import build_feed


def database(member_count=5, entry_count=5, repeated=False, missing=False):
    db = sqlite3.connect(":memory:")
    db.executescript("""
        CREATE TABLE members (workspace_id TEXT, id INTEGER, display_name TEXT,
                              PRIMARY KEY (workspace_id, id));
        CREATE TABLE activities (workspace_id TEXT, sequence INTEGER, member_id INTEGER,
                                 action TEXT, PRIMARY KEY (workspace_id, sequence));
    """)
    if not missing:
        db.executemany("INSERT INTO members VALUES (?, ?, ?)",
                       [("team", i, f"Member {i}") for i in range(member_count)])
    db.executemany("INSERT INTO activities VALUES (?, ?, ?, ?)",
                   [("team", i, 0 if repeated else i, f"Action {i}") for i in range(entry_count)])
    db.commit()
    return db


def measured(db, limit=100, workspace="team"):
    reads, writes = [], []

    def trace(sql):
        operation = sql.lstrip().split()[0].upper()
        if operation in ("SELECT", "WITH"):
            reads.append(sql)
        elif operation in ("INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "DROP", "ALTER"):
            writes.append(sql)

    db.set_trace_callback(trace)
    try:
        result = build_feed(db, workspace, limit)
    finally:
        db.set_trace_callback(None)
    assert not writes, "Building a feed must not modify the database"
    return result, reads


def test_distinct_authors_use_bounded_reads():
    db = database(100, 100)
    try:
        rows, reads = measured(db)
        assert len(rows) == 100
        assert rows[0]["member_name"] == "Member 99"
        assert len(reads) <= 2, f"A 100-entry page made {len(reads)} reads; expected at most 2"
    finally:
        db.close()


def test_repeated_author_is_not_reloaded_per_entry():
    db = database(1, 100, repeated=True)
    try:
        rows, reads = measured(db)
        assert len(rows) == 100 and all(row["member_name"] == "Member 0" for row in rows)
        assert len(reads) <= 2, f"Repeated author produced {len(reads)} reads"
    finally:
        db.close()


def test_missing_authors_use_bounded_reads():
    db = database(0, 100, missing=True)
    try:
        rows, reads = measured(db)
        assert len(rows) == 100 and all(row["member_name"] == "Former member" for row in rows)
        assert len(reads) <= 2, f"Missing authors produced {len(reads)} reads"
    finally:
        db.close()


def test_multiple_batches_use_bounded_reads():
    db = database(901, 901)
    try:
        rows, reads = measured(db, 901)
        assert len(rows) == 901
        assert rows[-1]["member_name"] == "Member 0"
        assert len(reads) <= 4, f"901 distinct authors produced {len(reads)} reads; expected at most 4"
    finally:
        db.close()


def test_order_and_limit_apply_to_activity_not_author():
    db = database(5, 5)
    try:
        db.execute("UPDATE activities SET member_id = 0 WHERE sequence = 4")
        rows, _ = measured(db, 3)
        assert [row["sequence"] for row in rows] == [4, 3, 2]
        assert [row["member_id"] for row in rows] == [0, 3, 2]
        assert [row["action"] for row in rows] == ["Action 4", "Action 3", "Action 2"]
    finally:
        db.close()


def test_member_ids_are_scoped_to_workspace():
    db = database(2, 2)
    try:
        db.executemany("INSERT INTO members VALUES (?, ?, ?)", [
            ("another", 0, "Private Zero"), ("another", 1, "Private One"),
            ("another", 77, "Do not reveal"),
        ])
        db.execute("INSERT INTO activities VALUES ('team', 2, 77, 'old contribution')")
        db.execute("INSERT INTO activities VALUES ('another', 999, 0, 'private action')")
        rows, _ = measured(db)
        assert [row["member_name"] for row in rows] == ["Former member", "Member 1", "Member 0"]
        assert all(row["sequence"] != 999 for row in rows)
    finally:
        db.close()


def test_new_display_names_are_visible_on_next_request():
    db = database(1, 1)
    try:
        assert measured(db)[0][0]["member_name"] == "Member 0"
        db.execute("UPDATE members SET display_name = 'Renamed' WHERE workspace_id = 'team'")
        db.commit()
        assert measured(db)[0][0]["member_name"] == "Renamed", "Do not keep stale names between requests"
    finally:
        db.close()


def test_deleted_members_keep_entries_on_next_request():
    db = database(1, 1)
    try:
        assert measured(db)[0][0]["member_name"] == "Member 0"
        db.execute("DELETE FROM members WHERE workspace_id = 'team'")
        db.commit()
        assert measured(db)[0] == [{"sequence": 0, "member_id": 0,
            "member_name": "Former member", "action": "Action 0"}]
    finally:
        db.close()


def test_empty_feed_skips_member_reads():
    db = database(100, 0)
    try:
        rows, reads = measured(db)
        assert rows == [] and len(reads) <= 1
    finally:
        db.close()


def test_zero_limit_skips_member_reads():
    db = database(100, 100)
    try:
        rows, reads = measured(db, 0)
        assert rows == [] and len(reads) <= 1
    finally:
        db.close()


def test_names_and_workspace_values_are_data():
    db = database(1, 1)
    try:
        name = "O'Neil <team>"
        db.execute("UPDATE members SET display_name = ?", (name,))
        assert measured(db)[0][0]["member_name"] == name
        assert measured(db, workspace="team' OR 1=1 --")[0] == []
    finally:
        db.close()


def test_negative_limit_is_rejected():
    db = database(1, 1)
    try:
        try:
            build_feed(db, "team", -1)
        except ValueError:
            return
        assert False, "Negative limits must not turn into unlimited SQLite reads"
    finally:
        db.close()

"""Runnable local example; uses no persistent database."""
import json
import sqlite3

from .feed import build_feed


def sample_database() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.executescript("""
        CREATE TABLE members (
            workspace_id TEXT NOT NULL, id INTEGER NOT NULL, display_name TEXT NOT NULL,
            PRIMARY KEY (workspace_id, id)
        );
        CREATE TABLE activities (
            workspace_id TEXT NOT NULL, sequence INTEGER NOT NULL,
            member_id INTEGER NOT NULL, action TEXT NOT NULL,
            PRIMARY KEY (workspace_id, sequence)
        );
    """)
    connection.executemany("INSERT INTO members VALUES (?, ?, ?)", [
        ("northstar", 1, "Mina"), ("northstar", 2, "Leo"), ("other", 1, "Another person"),
    ])
    connection.executemany("INSERT INTO activities VALUES (?, ?, ?, ?)", [
        ("northstar", 1, 1, "created a project"),
        ("northstar", 2, 2, "added a checklist"),
        ("northstar", 3, 9, "closed an issue"),
        ("other", 4, 1, "private activity"),
    ])
    connection.commit()
    return connection


if __name__ == "__main__":
    db = sample_database()
    try:
        print(json.dumps(build_feed(db, "northstar"), indent=2))
    finally:
        db.close()

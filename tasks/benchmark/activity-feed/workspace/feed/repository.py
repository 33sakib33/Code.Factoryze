"""SQLite repositories; connections and transactions belong to the caller."""
from collections.abc import Iterable
from sqlite3 import Connection

from .models import Activity, Member


class ActivityRepository:
    def __init__(self, connection: Connection):
        self.connection = connection

    def recent(self, workspace_id: str, limit: int) -> list[Activity]:
        if limit < 0:
            raise ValueError("limit must be non-negative")
        if limit == 0:
            return []
        rows = self.connection.execute(
            "SELECT workspace_id, sequence, member_id, action FROM activities "
            "WHERE workspace_id = ? ORDER BY sequence DESC LIMIT ?",
            (workspace_id, limit),
        )
        return [Activity(*row) for row in rows]


class MemberRepository:
    # Leaves room for the workspace parameter on SQLite builds with older limits.
    batch_size = 400

    def __init__(self, connection: Connection):
        self.connection = connection

    def get(self, workspace_id: str, member_id: int) -> Member | None:
        row = self.connection.execute(
            "SELECT workspace_id, id, display_name FROM members "
            "WHERE workspace_id = ? AND id = ?", (workspace_id, member_id),
        ).fetchone()
        return Member(*row) if row is not None else None

    def get_many(self, workspace_id: str, member_ids: Iterable[int]) -> dict[int, Member]:
        ids = list(dict.fromkeys(member_ids))
        members = {}
        for start in range(0, len(ids), self.batch_size):
            batch = ids[start:start + self.batch_size]
            placeholders = ",".join("?" for _ in batch)
            rows = self.connection.execute(
                "SELECT workspace_id, id, display_name FROM members "
                f"WHERE workspace_id = ? AND id IN ({placeholders})",
                (workspace_id, *batch),
            )
            for row in rows:
                member = Member(*row)
                members[member.id] = member
        return members

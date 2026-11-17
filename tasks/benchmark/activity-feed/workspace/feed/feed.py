"""Build the latest activity page for one workspace."""
from sqlite3 import Connection

from .render import render_entry
from .repository import ActivityRepository, MemberRepository


def build_feed(connection: Connection, workspace_id: str, limit: int = 50) -> list[dict]:
    activities = ActivityRepository(connection).recent(workspace_id, limit)
    members = MemberRepository(connection)
    return [render_entry(activity, members.get(workspace_id, activity.member_id))
            for activity in activities]

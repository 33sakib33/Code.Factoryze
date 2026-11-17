"""Database records. Member IDs are unique within a workspace, not globally."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Activity:
    workspace_id: str
    sequence: int
    member_id: int
    action: str


@dataclass(frozen=True)
class Member:
    workspace_id: str
    id: int
    display_name: str

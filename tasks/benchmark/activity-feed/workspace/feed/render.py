"""Response formatting shared by feed consumers."""
from .models import Activity, Member


def render_entry(activity: Activity, member: Member | None) -> dict:
    return {
        "sequence": activity.sequence,
        "member_id": activity.member_id,
        "member_name": member.display_name if member is not None else "Former member",
        "action": activity.action,
    }

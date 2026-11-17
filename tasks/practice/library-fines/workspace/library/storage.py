"""Loads branches, items, members and open loans from a JSON export."""
import json
from datetime import date, datetime, timezone
from pathlib import Path

from .models import Branch, Item, Loan, Member

DEFAULT_DATA = Path(__file__).resolve().parent.parent / "data" / "library.json"


def load(path: str | Path = DEFAULT_DATA) -> tuple[dict[str, Branch], dict[str, Item], dict[str, Member], dict[str, Loan]]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    branches = {b["id"]: Branch(b["id"], b["name"], b["utc_offset_minutes"], frozenset(b["closed_weekdays"])) for b in data["branches"]}
    items = {i["id"]: Item(i["id"], i["title"], i["kind"]) for i in data["items"]}
    members = {m["id"]: Member(m["id"], m["name"], m["branch_id"], m.get("concession", False)) for m in data["members"]}
    loans = {}
    for raw in data["loans"]:
        checked_out = datetime.fromisoformat(raw["checked_out_at"])
        if checked_out.tzinfo is None:
            raise ValueError(f"loan {raw['id']} has a timestamp without a UTC offset")
        loans[raw["id"]] = Loan(raw["id"], raw["item_id"], raw["member_id"], raw["branch_id"], checked_out.astimezone(timezone.utc),
                                date.fromisoformat(raw["due_on"]), raw.get("renewals", 0))
    return branches, items, members, loans

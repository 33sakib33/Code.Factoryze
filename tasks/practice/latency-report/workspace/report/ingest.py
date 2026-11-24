"""Reads request log files."""
from pathlib import Path


def read_lines(path: str | Path) -> list[str]:
    """Return the non-empty lines of a log file, without line endings."""
    text = Path(path).read_text(encoding="utf-8")
    return [line.strip() for line in text.splitlines() if line.strip()]

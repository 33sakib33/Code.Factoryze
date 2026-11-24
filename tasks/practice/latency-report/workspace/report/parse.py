"""Turns log lines into request records."""
from dataclasses import dataclass

from .legacy_formats import parse_legacy_line


@dataclass(frozen=True)
class Request:
    service: str
    status: int
    latency_ms: int


def parse_line(line: str) -> Request | None:
    """Parse one log line. Returns None for lines that are not requests.

    Current format: ``2026-11-02T10:00:01Z checkout 200 123ms``
    Older services still write other formats; those go through legacy_formats.
    """
    parts = line.split()
    if len(parts) == 4 and parts[3].endswith("ms") and parts[2].isdigit():
        latency = parts[3][:-2]
        if latency.isdigit():
            return Request(service=parts[1], status=int(parts[2]), latency_ms=int(latency))
    legacy = parse_legacy_line(line)
    if legacy is None:
        return None
    service, status, latency_ms = legacy
    return Request(service=service, status=status, latency_ms=latency_ms)


def parse_lines(lines: list[str]) -> list[Request]:
    """Parse many lines, skipping the ones that are not requests."""
    records = []
    for line in lines:
        record = parse_line(line)
        if record is not None:
            records.append(record)
    return records

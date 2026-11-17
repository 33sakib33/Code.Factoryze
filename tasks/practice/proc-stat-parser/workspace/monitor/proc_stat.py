"""Read the fields the host monitor needs from one procfs stat record."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ProcessStat:
    pid: int
    command: str
    state: str
    cpu_ticks: int
    start_ticks: int


def parse_process_stat(record: str) -> ProcessStat:
    """Parse one /proc/<pid>/stat record without reading the live filesystem."""
    fields = record.split()
    return ProcessStat(
        pid=int(fields[0]),
        command=fields[1].strip("()"),
        state=fields[2],
        cpu_ticks=int(fields[13]) + int(fields[14]),
        start_ticks=int(fields[21]),
    )

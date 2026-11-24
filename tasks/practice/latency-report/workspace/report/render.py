"""Formats the latency report."""
from .parse import Request
from .stats import Summary, summarize


def by_service(records: list[Request]) -> dict[str, list[int]]:
    """Group latencies by service, keeping the order requests arrived in."""
    groups: dict[str, list[int]] = {}
    for record in records:
        groups.setdefault(record.service, []).append(record.latency_ms)
    return groups


def format_number(value: float) -> str:
    """Whole numbers print without a decimal point: 118, not 118.0."""
    return str(int(value)) if float(value).is_integer() else f"{value:.1f}"


def render_line(service: str, summary: Summary) -> str:
    return f"{service:<12} requests={summary.requests:<3} median={format_number(summary.median_ms)}ms  p95={summary.p95_ms}ms"


def build_report(records: list[Request]) -> list[str]:
    """One line per service, in alphabetical order."""
    groups = by_service(records)
    return [render_line(service, summarize(groups[service])) for service in sorted(groups)]

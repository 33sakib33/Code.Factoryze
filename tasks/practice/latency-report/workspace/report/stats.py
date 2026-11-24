"""Figures for one service's latencies."""
import math
import statistics
from dataclasses import dataclass


@dataclass(frozen=True)
class Summary:
    requests: int
    median_ms: float
    p95_ms: int


def percentile(values: list[int], p: float) -> int:
    """Return the p-th percentile of values by the nearest-rank method."""
    if not values:
        raise ValueError("percentile needs at least one value")
    if not 0 < p <= 100:
        raise ValueError("p must be above 0 and at most 100")
    rank = math.ceil(p / 100 * len(values))
    return values[rank - 1]


def summarize(latencies: list[int]) -> Summary:
    """Return the request count, median and 95th percentile of one service."""
    return Summary(requests=len(latencies), median_ms=statistics.median(latencies), p95_ms=percentile(latencies, 95))

from report.parse import parse_lines
from report.render import build_report
from report.stats import percentile, summarize

CHECKOUT = [412, 118, 97, 131, 104, 126, 115, 109, 122, 140, 99, 117, 119, 133, 101, 128, 113, 124, 107, 136, 111, 120, 95, 97]


def test_percentile_of_values_in_arrival_order():
    assert percentile([40, 10, 30, 20], 50) == 20
    assert percentile([40, 10, 30, 20], 75) == 30
    assert percentile(CHECKOUT, 95) == 140


def test_the_highest_percentile_is_the_largest_value():
    assert percentile([412, 118, 97], 100) == 412
    assert percentile([5, 9, 1, 7], 100) == 9
    assert percentile([5, 9, 1, 7], 1) == 1


def test_percentile_leaves_the_callers_list_alone():
    values = [40, 10, 30, 20]
    percentile(values, 95)
    assert values == [40, 10, 30, 20]
    latencies = list(CHECKOUT)
    summarize(latencies)
    assert latencies == CHECKOUT


def test_a_summary_never_has_p95_below_the_median():
    summary = summarize(CHECKOUT)
    assert (summary.requests, summary.median_ms, summary.p95_ms) == (24, 117.5, 140)
    for latencies in ([300, 20, 25, 22, 21, 24], [9, 8, 7, 6, 5, 4, 3, 2, 1], [50, 50, 50]):
        result = summarize(latencies)
        assert result.p95_ms >= result.median_ms


def test_the_report_is_right_and_keeps_its_layout():
    lines = [f"2026-11-02T10:00:{index:02d}Z checkout 200 {value}ms" for index, value in enumerate(CHECKOUT)]
    lines += ["[basket] OK in 80ms (2026-11-02T10:01:00Z)", "[basket] OK in 103ms (2026-11-02T10:01:01Z)", "2026-11-02T10:01:02Z cart 200 91ms"]
    assert build_report(parse_lines(lines)) == [
        "cart         requests=3   median=91ms  p95=103ms",
        "checkout     requests=24  median=117.5ms  p95=140ms",
    ]

from report.parse import Request, parse_line, parse_lines
from report.render import build_report, render_line
from report.stats import Summary, percentile


def test_current_and_older_log_lines_are_read():
    assert parse_line("2026-11-02T10:00:01Z checkout 200 123ms") == Request("checkout", 200, 123)
    assert parse_line("[basket] OK in 87ms (2026-11-02T10:00:01Z)") == Request("cart", 200, 87)
    assert parse_line("2026-11-02T10:00:01Z|lookup|200|45000us") == Request("search", 200, 45)
    assert parse_line("# a comment") is None


def test_percentile_of_values_already_in_order():
    assert percentile([10, 20, 30, 40], 50) == 20
    assert percentile([10, 20, 30, 40], 100) == 40
    assert percentile([7], 95) == 7


def test_percentile_rejects_an_empty_list():
    try:
        percentile([], 95)
    except ValueError:
        return
    raise AssertionError("an empty list should raise ValueError")


def test_report_lines_keep_their_layout():
    assert render_line("cart", Summary(requests=12, median_ms=89.0, p95_ms=103)) == "cart         requests=12  median=89ms  p95=103ms"
    lines = build_report(parse_lines(["2026-11-02T10:00:01Z search 200 40ms", "2026-11-02T10:00:02Z search 200 50ms"]))
    assert lines == ["search       requests=2   median=45ms  p95=50ms"]

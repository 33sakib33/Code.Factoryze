"""Command line entry: python -m report.cli data/requests.log"""
import sys

from .ingest import read_lines
from .parse import parse_lines
from .render import build_report


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m report.cli LOG_FILE")
        return 2
    for line in build_report(parse_lines(read_lines(argv[1]))):
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

"""Log formats written by services that have not moved to the current format.

Three older formats are still seen in production logs. Each parser returns
``(service, status, latency_ms)`` or ``None`` when the line is not in its format.
Nothing here computes statistics; this module only reads lines.
"""

LegacyRecord = tuple[str, int, int]

# Services that renamed themselves. Old logs use the name on the left.
SERVICE_ALIASES = {
    "basket": "cart",
    "pay": "checkout",
    "payments": "checkout",
    "find": "search",
    "lookup": "search",
    "acct": "accounts",
}

# Status words used by the bracket format before it logged numeric codes.
STATUS_WORDS = {
    "OK": 200,
    "CREATED": 201,
    "NOCONTENT": 204,
    "BADREQUEST": 400,
    "DENIED": 403,
    "MISSING": 404,
    "CONFLICT": 409,
    "ERROR": 500,
    "UNAVAILABLE": 503,
    "TIMEOUT": 504,
}


def canonical_service(name: str) -> str:
    """Map an old service name to the one used in reports."""
    cleaned = name.strip().lower()
    return SERVICE_ALIASES.get(cleaned, cleaned)


def _whole_milliseconds(text: str) -> int | None:
    """Read a latency written as ``123``, ``123ms``, ``0.123s`` or ``123000us``."""
    value = text.strip().lower()
    if not value:
        return None
    try:
        if value.endswith("us"):
            return round(int(value[:-2]) / 1000)
        if value.endswith("ms"):
            return round(float(value[:-2]))
        if value.endswith("s"):
            return round(float(value[:-1]) * 1000)
        return round(float(value))
    except ValueError:
        return None


def _status_code(text: str) -> int | None:
    """Read a status written as a number or as one of the old status words."""
    value = text.strip()
    if value.isdigit():
        code = int(value)
        return code if 100 <= code <= 599 else None
    return STATUS_WORDS.get(value.upper())


def parse_key_value_line(line: str) -> LegacyRecord | None:
    """Format A, key=value pairs in any order.

    ``ts=2026-11-02T10:00:01Z svc=pay status=200 took=0.123s``
    """
    if "=" not in line:
        return None
    fields: dict[str, str] = {}
    for part in line.split():
        key, separator, value = part.partition("=")
        if not separator:
            return None
        fields[key.lower()] = value
    service = fields.get("svc") or fields.get("service")
    status = _status_code(fields.get("status", ""))
    latency = _whole_milliseconds(fields.get("took") or fields.get("latency") or "")
    if not service or status is None or latency is None:
        return None
    return canonical_service(service), status, latency


def parse_bracket_line(line: str) -> LegacyRecord | None:
    """Format B, bracketed service and a status word.

    ``[basket] OK in 87ms (2026-11-02T10:00:01Z)``
    """
    if not line.startswith("["):
        return None
    closing = line.find("]")
    if closing < 0:
        return None
    service = line[1:closing]
    rest = line[closing + 1:].split()
    if len(rest) < 3 or rest[1].lower() != "in":
        return None
    status = _status_code(rest[0])
    latency = _whole_milliseconds(rest[2])
    if not service.strip() or status is None or latency is None:
        return None
    return canonical_service(service), status, latency


def parse_pipe_line(line: str) -> LegacyRecord | None:
    """Format C, pipe-separated with the latency in microseconds.

    ``2026-11-02T10:00:01Z|lookup|200|45000us``
    """
    if "|" not in line:
        return None
    parts = [part.strip() for part in line.split("|")]
    if len(parts) != 4:
        return None
    status = _status_code(parts[2])
    latency = _whole_milliseconds(parts[3])
    if not parts[1] or status is None or latency is None:
        return None
    return canonical_service(parts[1]), status, latency


LEGACY_PARSERS = (parse_key_value_line, parse_bracket_line, parse_pipe_line)


def parse_legacy_line(line: str) -> LegacyRecord | None:
    """Try each older format in turn. Comment lines and unknown lines give None."""
    if line.startswith("#"):
        return None
    for parser in LEGACY_PARSERS:
        record = parser(line)
        if record is not None:
            return record
    return None

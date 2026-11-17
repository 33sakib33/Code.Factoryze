"""Preflight policy for tenant-supplied notification callbacks."""

from urllib.parse import urlsplit


def is_approved_callback(url: str) -> bool:
    """Whether a callback may be queued for the partner relay."""
    parts = urlsplit(url)
    return (
        parts.scheme == "https"
        and parts.hostname is not None
        and parts.hostname.endswith("partner.example")
    )

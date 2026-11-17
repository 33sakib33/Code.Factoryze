# Guard a webhook allowlist

The notification relay checks tenant-supplied callback URLs before queuing a
delivery. A synthetic incident report in `data/incident.txt` found that the
current preflight policy accepted a destination outside the partner allowlist.
No request is sent by this exercise.

Repair `is_approved_callback` in `relay/policy.py`. It must return `True` only
when all of these rules hold:

- The URL uses HTTPS and its parsed hostname is exactly
  `hooks.partner.example` or `events.partner.example` (case-insensitive).
- The URL has no username or password and uses either the default HTTPS port or
  an explicit port `443`.
- The URL has no fragment. Paths and query strings are allowed.
- Leading or trailing whitespace, ASCII control characters, and malformed URLs
  are rejected with `False`, not an exception.

Keep the function signature and return a boolean. Use Python's standard
library; no DNS lookup or network request is needed. The real sender separately
controls redirects and connection addresses. This task is about the URL
preflight rule, not a complete outbound-request security boundary.

Python's [`urllib.parse` reference](https://docs.python.org/3.11/library/urllib.parse.html)
describes how `urlsplit` exposes hostnames, ports, credentials and fragments.

Run the public checks as you work. They show the ordinary accepted and rejected
cases; the submission checks exercise the incident edge cases. All domains in
this task are synthetic `.example` names.

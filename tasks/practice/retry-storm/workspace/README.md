# Stop a retry storm

The `catalog-sync` worker calls an upstream service. After a deployment, some
requests are rejected as invalid. Each rejected request is currently sent again,
so the upstream sees several times the expected traffic. The synthetic incident
record is in `data/incident.txt`.

Repair `fetch_with_retry` in `service/retry.py`:

- Return the first response immediately unless its status is **429** (rate
  limited) or **503** (temporarily unavailable).
- Retry those two statuses at most `max_attempts` times in total, including the
  initial request. Return the final response if all attempts fail.
- Wait `0.25`, `0.5`, `1.0`, … seconds between retries. Never wait after the last
  attempt. The injected `wait` function records delays; no real sleep or network
  access is needed.
- Keep the function signature and `Response` type. A nonpositive `max_attempts`
  raises `ValueError`.

Run the public checks after each change. The hidden checks include response
statuses that were seen during the incident. The incident record is context, not
a source of actual credentials or production traffic.

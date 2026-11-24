# Latency report

`python -m report.cli data/requests.log` prints one line per service: how many
requests it served, the median latency and the 95th percentile (p95), in
milliseconds.

Today's report has a line that cannot be right:

```
checkout     requests=24  median=117.5ms  p95=95ms
```

A 95th percentile can never be lower than the median. The other services look
plausible, and the request counts and medians are correct.

How the report is built:

- `report/ingest.py` reads the log file.
- `report/parse.py` turns each line into a record. It calls
  `report/legacy_formats.py` for lines written by older services.
- `report/stats.py` computes the figures for one service.
- `report/render.py` formats the lines.

The percentile uses the **nearest-rank** method: sort the values, take the rank
`ceil(p / 100 * n)` counting from 1, and return the value at that rank. It must
not change the list it is given, because the caller goes on using it.

Repair the report. Keep the layout, the function signatures and the way log
lines are read.

This starter is about cost as much as correctness. The bug is small and sits in
one place. Point the agent at it and the fix is cheap; ask it to "fix the
report" and it will read everything first.

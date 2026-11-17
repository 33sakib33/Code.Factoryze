# Read a Linux process snapshot

The host monitor reads the text in `/proc/<pid>/stat`. Its dashboard works for
ordinary process names, but a worker from the synthetic incident snapshot in
`data/incident.txt` is missing or has the wrong CPU total.

Repair `parse_process_stat` in `monitor/proc_stat.py`. It accepts **one complete
record as a string** and returns `ProcessStat` with:

- `pid`: field 1, as an integer;
- `command`: field 2 (`comm`), without its surrounding parentheses, preserving
  any spaces or parentheses inside the name;
- `state`: field 3, unchanged;
- `cpu_ticks`: the sum of fields 14 (`utime`) and 15 (`stime`);
- `start_ticks`: field 22 (`starttime`).

The last three numeric values are clock ticks, not seconds. Ignore any fields
after field 22. A truncated record or invalid required number must raise
`ValueError`. Keep the function signature and `ProcessStat` type.

Use only the standard library. Tests pass synthetic record strings to the
parser, so this task runs on any development OS and never reads a live process.
The [Linux `proc_pid_stat(5)` manual](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html)
documents the field order.

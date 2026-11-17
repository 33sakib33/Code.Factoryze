from monitor.proc_stat import ProcessStat, parse_process_stat


def stat_record(pid, command, state, user_ticks, system_ticks, start_ticks):
    fields = ["0"] * 22
    fields[0], fields[1], fields[2] = str(pid), f"({command})", state
    fields[13], fields[14], fields[21] = map(str, (user_ticks, system_ticks, start_ticks))
    return " ".join(fields)


def test_ordinary_process_reports_cpu_and_start_ticks():
    record = stat_record(4102, "worker", "S", 11, 4, 9000)
    assert parse_process_stat(record) == ProcessStat(4102, "worker", "S", 15, 9000)


def test_running_process_keeps_state_and_zero_ticks():
    record = stat_record(7, "agent", "R", 0, 0, 42)
    assert parse_process_stat(record) == ProcessStat(7, "agent", "R", 0, 42)

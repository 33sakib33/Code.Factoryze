from monitor.proc_stat import ProcessStat, parse_process_stat


def stat_record(pid=4103, command="sync worker", state="S", user_ticks=21, system_ticks=3, start_ticks=12000, extra=()):
    fields = ["0"] * 22
    fields[0], fields[1], fields[2] = str(pid), f"({command})", state
    fields[13], fields[14], fields[21] = map(str, (user_ticks, system_ticks, start_ticks))
    return " ".join(fields + list(extra))


def test_name_with_space_does_not_shift_numeric_fields():
    assert parse_process_stat(stat_record()) == ProcessStat(4103, "sync worker", "S", 24, 12000)


def test_name_with_closing_parenthesis_is_preserved():
    record = stat_record(command="sync) worker", state="R", user_ticks=8, system_ticks=5)
    assert parse_process_stat(record) == ProcessStat(4103, "sync) worker", "R", 13, 12000)


def test_trailing_kernel_fields_do_not_change_start_ticks():
    record = stat_record(command="job runner", start_ticks=7800, extra=("99999", "111"))
    assert parse_process_stat(record) == ProcessStat(4103, "job runner", "S", 24, 7800)


def test_single_name_with_extra_fields_still_works():
    record = stat_record(command="daemon", user_ticks=3, system_ticks=2, start_ticks=60, extra=("99",))
    assert parse_process_stat(record) == ProcessStat(4103, "daemon", "S", 5, 60)


def test_truncated_record_raises_value_error():
    try:
        parse_process_stat("4103 (sync worker) S 1 2 3")
    except ValueError:
        pass
    else:
        raise AssertionError("Expected ValueError for a truncated stat record")


def test_invalid_required_number_raises_value_error():
    try:
        parse_process_stat(stat_record(user_ticks="not-a-number"))
    except ValueError:
        pass
    else:
        raise AssertionError("Expected ValueError for invalid user ticks")

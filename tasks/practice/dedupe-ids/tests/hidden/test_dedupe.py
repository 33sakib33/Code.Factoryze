from app.dedupe import unique_ids


def test_duplicate_ids_keep_first_seen_order():
    assert unique_ids(["c", "a", "c", "b", "a"]) == ["c", "a", "b"]


def test_ids_are_not_normalized():
    assert unique_ids(["001", "1", "001"]) == ["001", "1"]

from app.dedupe import unique_ids


def test_no_duplicates():
    assert unique_ids(["a", "a"]) == ["a"]

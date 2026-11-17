from app.pagination import page_of


def test_empty_history():
    assert page_of([], 1, 10) == []


def test_invalid_page():
    try:
        page_of(["a"], 0, 10)
    except ValueError:
        return
    assert False, "expected ValueError"

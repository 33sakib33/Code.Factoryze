from app.pagination import page_of


def test_each_page_includes_its_last_item():
    orders = ["a", "b", "c", "d", "e"]
    assert page_of(orders, 1, 2) == ["a", "b"]
    assert page_of(orders, 2, 2) == ["c", "d"]
    assert page_of(orders, 3, 2) == ["e"]

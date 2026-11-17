from relay.policy import is_approved_callback


def test_partner_callbacks_can_be_queued():
    assert is_approved_callback("https://hooks.partner.example/v1/notify") is True
    assert is_approved_callback("https://events.partner.example/audit?batch=4") is True


def test_plain_http_is_rejected():
    assert is_approved_callback("http://hooks.partner.example/v1/notify") is False


def test_unrelated_host_is_rejected():
    assert is_approved_callback("https://unrelated.example/v1/notify") is False

from relay.policy import is_approved_callback


def test_lookalike_and_extra_hosts_are_rejected():
    for url in (
        "https://fakepartner.example/notify",
        "https://hooks.partner.example.attacker.example/notify",
        "https://relay.partner.example/notify",
        "https://partner.example/notify",
    ):
        assert is_approved_callback(url) is False


def test_exact_hosts_accept_case_and_explicit_https_port():
    assert is_approved_callback("HTTPS://HOOKS.PARTNER.EXAMPLE:443/notify") is True
    assert is_approved_callback("https://events.partner.example?batch=4") is True


def test_credentials_and_wrong_ports_are_rejected():
    for url in (
        "https://user:password@hooks.partner.example/notify",
        "https://hooks.partner.example:444/notify",
        "https://hooks.partner.example:invalid/notify",
        "https://hooks.partner.example:/notify",
    ):
        assert is_approved_callback(url) is False


def test_fragments_and_noncanonical_host_are_rejected():
    assert is_approved_callback("https://hooks.partner.example/notify#private") is False
    assert is_approved_callback("https://hooks.partner.example/notify#") is False
    assert is_approved_callback("https://hooks.partner.example./notify") is False


def test_whitespace_and_control_characters_are_rejected():
    for url in (
        " https://hooks.partner.example/notify",
        "https://hooks.partner.example/notify ",
        "https://hooks.partner.example/notify\n",
        "https://hooks.partner.example/no\tify",
        "https://hooks.partner.example/notify\x7f",
    ):
        assert is_approved_callback(url) is False


def test_malformed_urls_return_false():
    for url in (
        "https://[not-ipv6/notify",
        "https:///notify",
        "//hooks.partner.example/notify",
    ):
        assert is_approved_callback(url) is False

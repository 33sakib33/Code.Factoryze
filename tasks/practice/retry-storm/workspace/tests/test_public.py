from service.retry import Response, fetch_with_retry


def test_success_returns_first_response_without_waiting():
    calls = []
    delays = []
    expected = Response(200, "ready")

    def send():
        calls.append("send")
        return expected

    assert fetch_with_retry(send, delays.append) is expected
    assert calls == ["send"]
    assert delays == []


def test_temporary_unavailability_uses_bounded_backoff():
    responses = iter([Response(503), Response(503), Response(200, "recovered")])
    delays = []
    calls = []

    def send():
        calls.append("send")
        return next(responses)

    assert fetch_with_retry(send, delays.append) == Response(200, "recovered")
    assert len(calls) == 3
    assert delays == [0.25, 0.5]

from service.retry import Response, fetch_with_retry


def test_invalid_request_does_not_amplify_upstream_load():
    calls = []
    delays = []

    def send():
        calls.append("send")
        return Response(400, "invalid field")

    assert fetch_with_retry(send, delays.append) == Response(400, "invalid field")
    assert calls == ["send"]
    assert delays == []


def test_other_nonretryable_responses_return_immediately():
    for status in (201, 401, 404, 500):
        calls = []
        delays = []

        def send():
            calls.append("send")
            return Response(status)

        assert fetch_with_retry(send, delays.append) == Response(status)
        assert calls == ["send"]
        assert delays == []


def test_rate_limit_retries_and_returns_recovery():
    responses = iter([Response(429), Response(200, "accepted")])
    delays = []

    assert fetch_with_retry(lambda: next(responses), delays.append) == Response(200, "accepted")
    assert delays == [0.25]


def test_exhausted_temporary_failure_does_not_wait_again():
    calls = []
    delays = []

    def send():
        calls.append("send")
        return Response(503)

    assert fetch_with_retry(send, delays.append, max_attempts=2) == Response(503)
    assert calls == ["send", "send"]
    assert delays == [0.25]


def test_invalid_attempt_limit_fails_before_sending():
    calls = []

    def send():
        calls.append("send")
        return Response(200)

    try:
        fetch_with_retry(send, lambda _: None, max_attempts=0)
    except ValueError:
        pass
    else:
        raise AssertionError("Expected ValueError")
    assert calls == []

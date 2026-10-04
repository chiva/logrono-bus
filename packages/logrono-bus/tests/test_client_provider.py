"""HTTP client error mapping and provider caching, against a real fake upstream server."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import aiohttp
import pytest
from contract_fixtures import load_fixture
from fake_upstream import FakeUpstream, Reply

from logrono_bus.errors import (
    LineNotFound,
    RateLimited,
    StopNotFound,
    UpstreamSchemaError,
    UpstreamUnavailable,
)
from logrono_bus.providers.base import TransitProvider
from logrono_bus.providers.logrono.client import DEFAULT_USER_AGENT, LogronoBusClient
from logrono_bus.providers.logrono.provider import TIMETABLE_RETRY_AFTER, LogronoBusProvider

LINES = "linesDiscovery/lines"
STOPS = "linesDiscovery/stops"
TIMETABLE_10 = "productionTimetable/byLine/10"


class FakeClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 3, 16, 0, 45, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
async def session() -> AsyncIterator[aiohttp.ClientSession]:
    async with aiohttp.ClientSession() as client_session:
        yield client_session


def _client(
    session: aiohttp.ClientSession, upstream: FakeUpstream, *, timeout_s: float = 2.0
) -> LogronoBusClient:
    return LogronoBusClient(session, base_url=upstream.base_url, timeout_s=timeout_s)


def _provider(
    session: aiohttp.ClientSession,
    upstream: FakeUpstream,
    *,
    catalog_ttl: timedelta = timedelta(hours=6),
    clock: FakeClock | None = None,
) -> LogronoBusProvider:
    return LogronoBusProvider(
        session,
        client=_client(session, upstream),
        catalog_ttl=catalog_ttl,
        clock=clock or FakeClock(),
    )


async def test_arrivals_request_sends_lines_preview_and_user_agent(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    upstream.serve_arrivals("101", "upstream/arrivals-101.json")
    arrivals = await _client(session, upstream).arrivals(
        "101", line_ids=["2", "5"], preview_minutes=30
    )
    assert len(arrivals) == 5
    (request,) = upstream.calls("estimatedTimetable/byStop/101")
    assert request.query == {"lines": "2,5", "previewMinutes": "30"}
    assert request.headers["User-Agent"] == DEFAULT_USER_AGENT
    assert request.headers["Accept"] == "application/json"


async def test_arrivals_requires_lines(session: aiohttp.ClientSession) -> None:
    with pytest.raises(ValueError, match="line_ids"):
        await LogronoBusClient(session).arrivals("101", line_ids=[], preview_minutes=30)


async def test_base_url_without_trailing_slash(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    upstream.reply(LINES, payload={"result": {"lines": []}})
    client = LogronoBusClient(session, base_url=upstream.base_url.rstrip("/"))
    assert await client.lines() == []


@pytest.mark.parametrize(
    ("reply", "error", "retry_after"),
    [
        (Reply(status=429, headers={"Retry-After": "12"}, payload={}), RateLimited, 12.0),
        (Reply(status=429, headers={"Retry-After": "-3"}, payload={}), RateLimited, 0.0),
        (Reply(status=429, headers={"Retry-After": "soon"}, payload={}), RateLimited, None),
        (Reply(status=429, payload={}), RateLimited, None),
        (Reply(status=503, payload={}), UpstreamUnavailable, None),
        (Reply(status=404, payload={}), UpstreamSchemaError, None),
        (Reply(body="<html>mantenimiento</html>"), UpstreamSchemaError, None),
    ],
)
async def test_http_failures_map_to_library_errors(
    upstream: FakeUpstream,
    session: aiohttp.ClientSession,
    reply: Reply,
    error: type[Exception],
    retry_after: float | None,
) -> None:
    upstream.reply(LINES, reply)
    with pytest.raises(error) as raised:
        await _client(session, upstream).lines()
    if isinstance(raised.value, RateLimited):
        assert raised.value.retry_after == retry_after


async def test_timeout_is_unavailable(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    upstream.reply(LINES, payload={"result": {"lines": []}}, delay_s=0.5)
    with pytest.raises(UpstreamUnavailable, match="TimeoutError"):
        await _client(session, upstream, timeout_s=0.05).lines()


async def test_connection_refused_is_unavailable(session: aiohttp.ClientSession) -> None:
    client = LogronoBusClient(session, base_url="http://127.0.0.1:9/api/")
    with pytest.raises(UpstreamUnavailable, match="ClientConnectorError"):
        await client.stops()


async def test_provider_satisfies_protocol(session: aiohttp.ClientSession) -> None:
    provider = LogronoBusProvider(session)
    assert isinstance(provider, TransitProvider)
    assert provider.id == "logrono"


async def test_catalog_is_cached_until_ttl(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    upstream.serve_catalog()
    clock = FakeClock()
    provider = _provider(session, upstream, catalog_ttl=timedelta(hours=6), clock=clock)

    first = await provider.get_catalog()
    clock.now += timedelta(hours=5)
    assert await provider.get_catalog() is first
    assert len(upstream.calls(LINES)) == 1

    clock.now += timedelta(hours=1)
    assert await provider.get_catalog() is not first
    assert len(upstream.calls(LINES)) == 2

    await provider.get_catalog(force_refresh=True)
    assert len(upstream.calls(LINES)) == 3
    assert len(upstream.calls(STOPS)) == 3


async def test_concurrent_catalog_loads_share_one_round_trip(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    upstream.reply(LINES, Reply(payload=load_fixture("upstream/lines.json"), delay_s=0.05))
    upstream.reply(STOPS, payload=load_fixture("upstream/stops.json"))
    provider = _provider(session, upstream)
    catalogs = await asyncio.gather(*(provider.get_catalog() for _ in range(5)))
    assert all(catalog is catalogs[0] for catalog in catalogs)
    assert len(upstream.calls(LINES)) == 1


async def test_catalog_failure_surfaces_library_error_not_group(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    upstream.reply(LINES, status=500, payload={})
    upstream.serve_catalog()
    with pytest.raises(UpstreamUnavailable):
        await _provider(session, upstream).get_catalog()


async def test_get_arrivals_requests_every_line_of_the_stop(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    upstream.serve_catalog()
    upstream.serve_arrivals("101", "upstream/arrivals-101.json")
    clock = FakeClock()
    result = await _provider(session, upstream, clock=clock).get_arrivals("101", horizon_min=45)

    assert result.generated_at == clock.now
    assert [a.line_id for a in result.arrivals] == ["2", "10", "5", "2", "10"]
    (request,) = upstream.calls("estimatedTimetable/byStop/101")
    assert request.query == {"lines": "2,5,7,10", "previewMinutes": "45"}


async def test_get_arrivals_unknown_stop(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    upstream.serve_catalog()
    with pytest.raises(StopNotFound):
        await _provider(session, upstream).get_arrivals("424242")


async def test_get_arrivals_stop_without_known_lines_skips_upstream(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    upstream.reply(LINES, payload={"result": {"lines": []}})
    upstream.reply(
        STOPS,
        payload={"result": {"stops": [{"id": 7, "name": "X", "lat": 0, "lng": 0, "lines": [99]}]}},
    )
    now = datetime(2026, 10, 3, 18, 0, tzinfo=UTC)
    result = await _provider(session, upstream).get_arrivals("7", now=now)
    assert result.arrivals == ()
    assert result.generated_at == now
    assert not upstream.calls("estimatedTimetable/byStop/7")


async def test_expired_catalog_is_kept_when_refresh_fails(
    upstream: FakeUpstream, session: aiohttp.ClientSession, caplog: pytest.LogCaptureFixture
) -> None:
    upstream.serve_catalog()
    clock = FakeClock()
    provider = _provider(session, upstream, catalog_ttl=timedelta(hours=1), clock=clock)
    first = await provider.get_catalog()

    upstream.reply_only(LINES, status=503, payload={})
    clock.now += timedelta(hours=2)
    assert await provider.get_catalog() is first
    assert "Catálogo no renovado" in caplog.text

    with pytest.raises(UpstreamUnavailable):
        await provider.get_catalog(force_refresh=True)


async def test_timetable_is_fetched_once_per_local_day(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    """The upstream publishes one timetable a day: the next request waits for Logroño's midnight."""
    upstream.serve_catalog()
    upstream.reply_only(TIMETABLE_10, payload=load_fixture("upstream/timetable-10.json"))
    clock = FakeClock()  # 18:00:45 in Logroño
    provider = _provider(session, upstream, clock=clock)

    timetables = await asyncio.gather(*(provider.get_timetable("10") for _ in range(3)))
    assert all(t is timetables[0] for t in timetables), "concurrent callers share one request"
    assert timetables[0].service_date == "2026-10-03"
    assert [d.pattern_id for d in timetables[0].directions] == ["10:asc", "10:desc"]

    clock.now += timedelta(hours=5, minutes=59)  # 23:59:45 local, same day
    assert await provider.get_timetable("10") is timetables[0]
    assert len(upstream.calls(TIMETABLE_10)) == 1

    clock.now += timedelta(minutes=1)  # 00:00:45 local, a new service day
    tomorrow = await provider.get_timetable("10")
    assert tomorrow.service_date == "2026-10-04"
    assert len(upstream.calls(TIMETABLE_10)) == 2


async def test_failed_timetable_is_not_asked_again_for_a_while(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    """Every stop of a Home Assistant install refreshes each minute; a broken endpoint must not."""
    upstream.serve_catalog()
    upstream.reply_only(TIMETABLE_10, Reply(status=503, payload={}))
    clock = FakeClock()
    provider = _provider(session, upstream, clock=clock)

    for _ in range(3):
        with pytest.raises(UpstreamUnavailable):
            await provider.get_timetable("10")
    assert len(upstream.calls(TIMETABLE_10)) == 1

    upstream.reply_only(TIMETABLE_10, payload=load_fixture("upstream/timetable-10.json"))
    clock.now += TIMETABLE_RETRY_AFTER
    assert (await provider.get_timetable("10")).service_date == "2026-10-03"
    assert len(upstream.calls(TIMETABLE_10)) == 2


async def test_timetable_of_unknown_line(
    upstream: FakeUpstream, session: aiohttp.ClientSession
) -> None:
    upstream.serve_catalog()
    with pytest.raises(LineNotFound):
        await _provider(session, upstream).get_timetable("99")
    assert upstream.calls("productionTimetable/byLine/99") == []

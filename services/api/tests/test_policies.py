"""Cache, upstream guard, settings and logging policies, tested without HTTP."""

from __future__ import annotations

import asyncio
import io
import json
import logging
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from logrono_bus.errors import UpstreamSchemaError, UpstreamUnavailable
from logrono_bus_api.__main__ import main as api_main
from logrono_bus_api.cache import CacheOutcome, SingleFlightCache
from logrono_bus_api.logs import JsonFormatter, configure_logging, request_id_var
from logrono_bus_api.settings import LogFormat, Settings
from logrono_bus_api.upstream_guard import (
    CircuitBreaker,
    CircuitOpen,
    CircuitState,
    TokenBucket,
    UpstreamGuard,
)


class ManualClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


async def test_cache_hit_miss_and_expiry() -> None:
    clock = ManualClock()
    cache: SingleFlightCache[str, int] = SingleFlightCache(ttl_s=15, stale_s=60, clock=clock)
    calls = 0

    async def load() -> int:
        nonlocal calls
        calls += 1
        return calls

    first = await cache.get("101", load)
    assert (first.value, first.outcome, first.age_s) == (1, CacheOutcome.MISS, 0.0)
    clock.now += 10
    second = await cache.get("101", load)
    assert (second.value, second.outcome, second.age_s) == (1, CacheOutcome.HIT, 10.0)
    clock.now += 5
    assert (await cache.get("101", load)).value == 2
    assert (await cache.get("100", load)).value == 3


async def test_cache_single_flight_shares_one_load() -> None:
    cache: SingleFlightCache[str, int] = SingleFlightCache(ttl_s=15, stale_s=60)
    started = 0
    release = asyncio.Event()

    async def slow_load() -> int:
        nonlocal started
        started += 1
        await release.wait()
        return 42

    waiters = [asyncio.create_task(cache.get("101", slow_load)) for _ in range(10)]
    await asyncio.sleep(0)
    release.set()
    results = await asyncio.gather(*waiters)
    assert started == 1
    assert {r.value for r in results} == {42}


async def test_cache_load_survives_a_cancelled_waiter() -> None:
    cache: SingleFlightCache[str, int] = SingleFlightCache(ttl_s=15, stale_s=60)
    release = asyncio.Event()

    async def slow_load() -> int:
        await release.wait()
        return 7

    impatient = asyncio.create_task(cache.get("101", slow_load))
    patient = asyncio.create_task(cache.get("101", slow_load))
    await asyncio.sleep(0)
    impatient.cancel()
    release.set()
    assert (await patient).value == 7
    with pytest.raises(asyncio.CancelledError):
        await impatient


async def test_cache_serves_stale_within_window_then_raises() -> None:
    clock = ManualClock()
    stale_keys: list[str] = []
    cache: SingleFlightCache[str, int] = SingleFlightCache(
        ttl_s=15, stale_s=60, clock=clock, on_stale=lambda key, _: stale_keys.append(key)
    )

    async def ok() -> int:
        return 1

    async def failing() -> int:
        raise UpstreamUnavailable("caído")

    await cache.get("101", ok)
    clock.now += 70
    stale = await cache.get("101", failing)
    assert (stale.value, stale.outcome, stale.stale) == (1, CacheOutcome.STALE, True)
    assert stale_keys == ["101"]

    clock.now += 10
    with pytest.raises(UpstreamUnavailable):
        await cache.get("101", failing)
    with pytest.raises(UpstreamUnavailable):
        await cache.get("never-loaded", failing)


async def test_cache_orphaned_failure_is_not_reported_as_unretrieved() -> None:
    cache: SingleFlightCache[str, int] = SingleFlightCache(ttl_s=15, stale_s=0)
    release = asyncio.Event()

    async def failing() -> int:
        await release.wait()
        raise UpstreamUnavailable("caído")

    waiter = asyncio.create_task(cache.get("101", failing))
    await asyncio.sleep(0)
    waiter.cancel()
    release.set()
    await asyncio.sleep(0.01)  # filterwarnings=error turns a leaked exception into a failure


async def test_token_bucket_paces_after_burst() -> None:
    bucket = TokenBucket(rate_per_s=50, burst=2)
    loop = asyncio.get_running_loop()
    started = loop.time()
    for _ in range(4):
        await bucket.acquire()
    # Two tokens are free; the next two wait ~20 ms each at 50 req/s.
    assert loop.time() - started >= 0.035


def test_circuit_breaker_state_machine() -> None:
    clock = ManualClock()
    breaker = CircuitBreaker(failures=2, reset_s=30, clock=clock)
    breaker.record_failure()
    assert breaker.state is CircuitState.CLOSED
    breaker.record_failure()
    assert breaker.state is CircuitState.OPEN
    with pytest.raises(CircuitOpen) as opened:
        breaker.before_call()
    assert opened.value.retry_after == 30

    clock.now += 30
    assert breaker.state is CircuitState.HALF_OPEN
    breaker.before_call()
    breaker.record_failure()  # the probe failed: straight back to open
    assert breaker.state is CircuitState.OPEN

    clock.now += 30
    breaker.record_success()
    assert breaker.state is CircuitState.CLOSED


async def test_half_open_guard_lets_a_single_probe_through() -> None:
    """After an outage, many screens refreshing at once must not all hit the upstream."""
    clock = ManualClock()
    guard = UpstreamGuard(
        bucket=TokenBucket(rate_per_s=100, burst=10),
        breaker=CircuitBreaker(failures=1, reset_s=30, clock=clock),
    )
    calls = 0
    release = asyncio.Event()

    async def still_down() -> int:
        nonlocal calls
        calls += 1
        await release.wait()
        raise UpstreamUnavailable("caído")

    release.set()
    with pytest.raises(UpstreamUnavailable):
        await guard.call(still_down)
    assert guard.breaker.state is CircuitState.OPEN

    clock.now += 30
    release.clear()
    attempts = [asyncio.create_task(guard.call(still_down)) for _ in range(5)]
    await asyncio.sleep(0.01)
    release.set()
    results = await asyncio.gather(*attempts, return_exceptions=True)
    assert calls == 2, "only one probe reaches the upstream"
    assert sum(isinstance(r, CircuitOpen) for r in results) == 4
    assert guard.breaker.state is CircuitState.OPEN

    async def back() -> int:
        return 1

    clock.now += 30
    assert await guard.call(back) == 1
    assert guard.breaker.state is CircuitState.CLOSED


async def test_guard_rechecks_the_breaker_after_waiting_for_a_token() -> None:
    """Callers queued behind the rate limit when the upstream fails must not reach it."""
    guard = UpstreamGuard(
        bucket=TokenBucket(rate_per_s=50, burst=1),
        breaker=CircuitBreaker(failures=1, reset_s=30),
    )
    calls = 0

    async def down() -> int:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)  # the others queue for a token before this one fails
        raise UpstreamUnavailable("caído")

    results = await asyncio.gather(*(guard.call(down) for _ in range(4)), return_exceptions=True)
    assert calls == 1
    assert sum(isinstance(r, CircuitOpen) for r in results) == 3


async def test_guard_counts_only_upstream_errors() -> None:
    guard = UpstreamGuard(
        bucket=TokenBucket(rate_per_s=100, burst=10),
        breaker=CircuitBreaker(failures=1, reset_s=30),
    )

    async def programming_error() -> int:
        raise KeyError("bug")

    async def schema_change() -> int:
        raise UpstreamSchemaError("cambió", path="$.result")

    with pytest.raises(KeyError):
        await guard.call(programming_error)
    assert guard.breaker.state is CircuitState.CLOSED
    with pytest.raises(UpstreamSchemaError):
        await guard.call(schema_change)
    assert guard.breaker.state is CircuitState.OPEN


def test_settings_from_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("ok", "utf-8")
    monkeypatch.setenv("LOGRONO_BUS_CORS_ORIGINS", "https://a.example, https://b.example")
    monkeypatch.setenv("LOGRONO_BUS_LOG_LEVEL", "debug")
    monkeypatch.setenv("LOGRONO_BUS_ROOT_PATH", "/bus/")
    monkeypatch.setenv("LOGRONO_BUS_WEB_DIR", str(tmp_path))
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.cors_origins == ["https://a.example", "https://b.example"]
    assert settings.log_level == "DEBUG"
    assert settings.root_path == "/bus"
    assert settings.web_dir == tmp_path


@pytest.mark.parametrize(
    ("variable", "value", "message"),
    [
        ("LOGRONO_BUS_LOG_LEVEL", "chatty", "nivel de log"),
        ("LOGRONO_BUS_ROOT_PATH", "bus", "root_path"),
        ("LOGRONO_BUS_WEB_DIR", "/nonexistent", "index.html"),
        ("LOGRONO_BUS_ARRIVALS_TTL_S", "0", "greater than or equal"),
        ("LOGRONO_BUS_UPSTREAM_URL", "not a url", "URL"),
    ],
)
def test_invalid_settings_fail_fast(
    monkeypatch: pytest.MonkeyPatch, variable: str, value: str, message: str
) -> None:
    monkeypatch.setenv(variable, value)
    with pytest.raises(ValidationError, match=message):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_json_log_lines_carry_request_id() -> None:
    formatter = JsonFormatter()
    record = logging.LogRecord("x", logging.WARNING, __file__, 1, "hola %s", ("mundo",), None)
    record.request_id = "abc"
    document = json.loads(formatter.format(record))
    assert document["message"] == "hola mundo"
    assert document["request_id"] == "abc"
    assert document["level"] == "WARNING"

    try:
        raise ValueError("fallo")
    except ValueError:
        record = logging.LogRecord("x", logging.ERROR, __file__, 1, "m", (), sys.exc_info())
    record.request_id = "-"
    document = json.loads(formatter.format(record))
    assert "request_id" not in document
    assert "ValueError: fallo" in document["exception"]


def test_configure_logging_routes_request_id(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(level="INFO", log_format=LogFormat.TEXT)
    token = request_id_var.set("req-1")
    try:
        logging.getLogger("prueba").info("dentro de una petición")
    finally:
        request_id_var.reset(token)
    assert "[req-1] dentro de una petición" in capsys.readouterr().err


def test_openapi_command_prints_the_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    output = io.StringIO()
    monkeypatch.setattr(sys, "stdout", output)
    api_main(["openapi"])
    document = json.loads(output.getvalue())
    assert "/api/v1/board" in document["paths"]
    committed = json.loads(
        (Path(__file__).resolve().parents[3] / "contracts" / "openapi.json").read_text("utf-8")
    )
    assert document == committed, "contracts/openapi.json is stale: run `just gen`"

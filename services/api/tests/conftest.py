"""Service test fixtures: an app wired to the fake upstream, driven through TestClient.

TestClient runs the app's lifespan (so the aiohttp session and service exist) and is synchronous,
which suits the fake upstream running on its own thread.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
import time_machine
from fake_upstream import FakeUpstream, running_fake_upstream
from fastapi.testclient import TestClient
from pydantic import HttpUrl

from logrono_bus_api.main import create_app
from logrono_bus_api.settings import LogFormat, Settings

RECORDED_AT = datetime(2026, 10, 3, 16, 0, 45, tzinfo=UTC)
"""When the Ayuntamiento 100/101 fixtures were recorded (18:00:45 in Logroño)."""

type ClientFactory = Callable[..., TestClient]


@pytest.fixture
def upstream() -> Iterator[FakeUpstream]:
    with running_fake_upstream() as fake:
        fake.serve_catalog()
        yield fake


@pytest.fixture
def frozen_time() -> Iterator[None]:
    with time_machine.travel(RECORDED_AT, tick=False):
        yield


@pytest.fixture
def make_client(upstream: FakeUpstream) -> Iterator[ClientFactory]:
    clients: list[TestClient] = []

    def factory(**overrides: Any) -> TestClient:
        settings = Settings(
            _env_file=None,  # type: ignore[call-arg]
            upstream_url=HttpUrl(upstream.base_url),
            upstream_timeout_s=2,
            log_format=LogFormat.TEXT,
            **overrides,
        )
        client = TestClient(create_app(settings), raise_server_exceptions=False)
        client.__enter__()
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client: ClientFactory) -> TestClient:
    return make_client()

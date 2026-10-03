"""Shared fixtures for the library tests: the golden contract corpus in ``contracts/fixtures``."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from datetime import datetime

import pytest
from contract_fixtures import FIXTURES, MANIFEST, load_fixture
from fake_upstream import FakeUpstream, running_fake_upstream

from logrono_bus.models import Catalog
from logrono_bus.providers.logrono.normalize import build_catalog
from logrono_bus.providers.logrono.raw import parse_lines, parse_stops


@pytest.fixture(scope="session")
def catalog() -> Catalog:
    spec = MANIFEST["catalog"]
    return build_catalog(
        parse_lines(load_fixture(spec["lines"])),
        parse_stops(load_fixture(spec["stops"])),
        fetched_at=datetime.fromisoformat(spec["fetched_at"]),
    )


@pytest.fixture
def assert_golden(request: pytest.FixtureRequest) -> Callable[[str, object], None]:
    """Compare JSON with a committed golden file, or rewrite it under ``--update-golden``."""
    update = bool(request.config.getoption("--update-golden"))

    def check(relative: str, actual: object) -> None:
        path = FIXTURES / relative
        rendered = json.dumps(actual, ensure_ascii=False, indent=2) + "\n"
        if update:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(rendered, encoding="utf-8")
            return
        assert path.exists(), f"{relative} missing: run `just golden` and review it"
        expected = json.loads(path.read_text(encoding="utf-8"))
        assert actual == expected, f"{relative} differs from the Python output"

    return check


@pytest.fixture
def upstream() -> Iterator[FakeUpstream]:
    """A live fake of the upstream API; point clients at ``upstream.base_url``."""
    with running_fake_upstream() as fake:
        yield fake

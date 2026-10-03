"""Board selection codec, against the corpus shared with the TypeScript codec."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest
from contract_fixtures import SELECTION_CASES, load_fixture

from logrono_bus.board import (
    LineSelection,
    StopSelection,
    format_selection,
    parse_selection,
)
from logrono_bus.errors import InvalidSelection
from logrono_bus.models import Catalog
from logrono_bus.providers.logrono.directions import DirectionResolver
from logrono_bus.providers.logrono.normalize import normalize_arrivals
from logrono_bus.providers.logrono.raw import parse_arrivals
from logrono_bus.serialize import to_json

VALID: list[dict[str, Any]] = SELECTION_CASES["valid"]
INVALID: list[str] = SELECTION_CASES["invalid"]


@pytest.mark.parametrize("case", VALID, ids=[case["p"] for case in VALID])
def test_valid_selections_parse_and_round_trip(case: dict[str, Any]) -> None:
    parsed = parse_selection(case["p"])
    assert to_json(parsed) == case["stops"]
    assert format_selection(parsed) == case["p"]


@pytest.mark.parametrize("value", INVALID)
def test_invalid_selections_raise(value: str) -> None:
    with pytest.raises(InvalidSelection):
        parse_selection(value)


def test_invalid_selection_is_also_a_value_error() -> None:
    with pytest.raises(ValueError, match="no válida"):
        parse_selection("101-2q")


def test_filter_keeps_only_selected_lines_and_directions(catalog: Catalog) -> None:
    arrivals = normalize_arrivals(
        parse_arrivals(load_fixture("upstream/arrivals-69.json")),
        stop_id="69",
        catalog=catalog,
        resolver=DirectionResolver(catalog),
        now=datetime.fromisoformat("2026-10-03T17:54:30+02:00"),
    )
    (selection,) = parse_selection("69-2d.9a.33x")
    kept = selection.filter(arrivals)

    assert {(a.line_id, a.direction) for a in kept.arrivals} == {("2", "desc"), ("33", "desc")}
    assert kept.generated_at == arrivals.generated_at
    assert StopSelection(stop_id="69").filter(arrivals) == arrivals
    assert StopSelection(stop_id="70").filter(arrivals).arrivals == ()


def test_line_selection_any_direction_matches_unresolved(catalog: Catalog) -> None:
    arrivals = normalize_arrivals(
        parse_arrivals(load_fixture("upstream/arrivals-sintetico-5.json")),
        stop_id="5",
        catalog=catalog,
        resolver=DirectionResolver(catalog),
        now=datetime.fromisoformat("2026-10-03T18:00:00+02:00"),
    )
    unresolved = [a for a in arrivals.arrivals if a.direction is None]
    assert unresolved
    assert all(LineSelection("2").matches(a) for a in unresolved)
    assert not any(LineSelection("2", "asc").matches(a) for a in unresolved)

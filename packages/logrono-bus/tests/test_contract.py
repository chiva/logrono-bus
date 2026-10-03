"""Golden contract: recorded upstream responses → canonical JSON.

The same manifest drives ``web/packages/core/test/contract.test.ts``; if either normaliser drifts
from these files, its own suite fails. Regenerate with ``just golden`` after an intentional change
and review the diff like any other code change.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

import pytest
from contract_fixtures import MANIFEST, load_fixture
from positions import assert_positions_plausible

from logrono_bus.board import parse_selection
from logrono_bus.cards import Card, build_cards, sort_cards
from logrono_bus.models import Catalog, LineTimetable
from logrono_bus.providers.logrono.directions import DirectionResolver
from logrono_bus.providers.logrono.normalize import (
    normalize_arrivals,
    normalize_timetable,
    normalize_vehicles,
)
from logrono_bus.providers.logrono.raw import parse_arrivals, parse_timetable, parse_vehicles
from logrono_bus.serialize import to_json
from logrono_bus.timetable import service_status

ARRIVAL_CASES: list[dict[str, Any]] = MANIFEST["arrivals"]


def test_catalog_matches_golden(
    catalog: Catalog, assert_golden: Callable[[str, object], None]
) -> None:
    assert_golden(MANIFEST["catalog"]["expected"], to_json(catalog))


@pytest.mark.parametrize("case", ARRIVAL_CASES, ids=[case["name"] for case in ARRIVAL_CASES])
def test_arrivals_match_golden(
    case: dict[str, Any], catalog: Catalog, assert_golden: Callable[[str, object], None]
) -> None:
    result = normalize_arrivals(
        parse_arrivals(load_fixture(case["upstream"])),
        stop_id=case["stop_id"],
        catalog=catalog,
        resolver=DirectionResolver(catalog),
        now=datetime.fromisoformat(case["now"]),
    )
    assert_golden(case["expected"], to_json(result))


CARD_CASES: list[dict[str, Any]] = MANIFEST["cards"]
ARRIVALS_BY_NAME = {case["name"]: case for case in ARRIVAL_CASES}


@pytest.mark.parametrize("case", CARD_CASES, ids=[case["name"] for case in CARD_CASES])
def test_cards_match_golden(
    case: dict[str, Any], catalog: Catalog, assert_golden: Callable[[str, object], None]
) -> None:
    source = ARRIVALS_BY_NAME[case["arrivals"]]
    arrivals = normalize_arrivals(
        parse_arrivals(load_fixture(source["upstream"])),
        stop_id=source["stop_id"],
        catalog=catalog,
        resolver=DirectionResolver(catalog),
        now=datetime.fromisoformat(source["now"]),
    )
    (selection,) = parse_selection(case["p"])
    cards = build_cards(catalog, selection, arrivals, limit=case["limit"])
    assert_golden(case["expected"], to_json(cards))


SORT_CASES: list[dict[str, Any]] = MANIFEST["sorts"]
CARDS_BY_NAME = {case["name"]: case for case in CARD_CASES}


def _card_key(card: Card) -> str:
    return f"{card.line_label}:{card.direction}:{card.stop_id}"


@pytest.mark.parametrize("case", SORT_CASES, ids=[case["name"] for case in SORT_CASES])
def test_card_order_matches_golden(
    case: dict[str, Any], catalog: Catalog, assert_golden: Callable[[str, object], None]
) -> None:
    card_case = CARDS_BY_NAME[case["cards"]]
    source = ARRIVALS_BY_NAME[card_case["arrivals"]]
    arrivals = normalize_arrivals(
        parse_arrivals(load_fixture(source["upstream"])),
        stop_id=source["stop_id"],
        catalog=catalog,
        resolver=DirectionResolver(catalog),
        now=datetime.fromisoformat(source["now"]),
    )
    (selection,) = parse_selection(card_case["p"])
    cards = build_cards(catalog, selection, arrivals, limit=card_case["limit"])
    assert_golden(case["expected"], [_card_key(c) for c in sort_cards(cards, case["order"])])


VEHICLE_CASES: list[dict[str, Any]] = MANIFEST["vehicles"]


@pytest.mark.parametrize("case", VEHICLE_CASES, ids=[case["name"] for case in VEHICLE_CASES])
def test_vehicles_match_golden(
    case: dict[str, Any], catalog: Catalog, assert_golden: Callable[[str, object], None]
) -> None:
    result = normalize_vehicles(
        parse_vehicles(load_fixture(case["upstream"])),
        line_id=case["line_id"],
        catalog=catalog,
        now=datetime.fromisoformat(case["now"]),
    )
    assert_golden(case["expected"], to_json(result))


RECORDED_VEHICLE_CASES = [case for case in VEHICLE_CASES if "sintetico" not in case["upstream"]]


@pytest.mark.parametrize(
    "case", RECORDED_VEHICLE_CASES, ids=[case["name"] for case in RECORDED_VEHICLE_CASES]
)
def test_recorded_positions_pass_the_live_checks(case: dict[str, Any], catalog: Catalog) -> None:
    """The checks the daily live run applies, proven on real recordings (where buses do run)."""
    result = normalize_vehicles(
        parse_vehicles(load_fixture(case["upstream"])),
        line_id=case["line_id"],
        catalog=catalog,
        now=datetime.fromisoformat(case["now"]),
    )
    assert assert_positions_plausible(catalog, result) > 0


TIMETABLE_CASES: list[dict[str, Any]] = MANIFEST["timetables"]
SERVICE_CASES: list[dict[str, Any]] = MANIFEST["services"]


def _timetable(name: str, catalog: Catalog) -> LineTimetable:
    case = next(case for case in TIMETABLE_CASES if case["name"] == name)
    return normalize_timetable(
        parse_timetable(load_fixture(case["upstream"])),
        line_id=case["line_id"],
        catalog=catalog,
        now=datetime.fromisoformat(case["now"]),
    )


@pytest.mark.parametrize("case", TIMETABLE_CASES, ids=[case["name"] for case in TIMETABLE_CASES])
def test_timetables_match_golden(
    case: dict[str, Any], catalog: Catalog, assert_golden: Callable[[str, object], None]
) -> None:
    assert_golden(case["expected"], to_json(_timetable(case["name"], catalog)))


@pytest.mark.parametrize("case", SERVICE_CASES, ids=[case["name"] for case in SERVICE_CASES])
def test_service_status_matches_golden(
    case: dict[str, Any], catalog: Catalog, assert_golden: Callable[[str, object], None]
) -> None:
    direction = _timetable(case["timetable"], catalog).for_pattern(case["pattern_id"])
    statuses = [service_status(direction, datetime.fromisoformat(at)) for at in case["at"]]
    assert_golden(case["expected"], to_json(statuses))

"""Card grouping edge cases not covered by the golden corpus."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime

import pytest
from contract_fixtures import load_fixture

from logrono_bus import StopNotFound, StopSelection, build_cards, parse_selection
from logrono_bus.models import Catalog, StopArrivals
from logrono_bus.providers.logrono.directions import DirectionResolver
from logrono_bus.providers.logrono.normalize import normalize_arrivals
from logrono_bus.providers.logrono.raw import parse_arrivals

NOW = datetime.fromisoformat("2026-10-03T18:00:45+02:00")


@pytest.fixture
def arrivals_101(catalog: Catalog) -> StopArrivals:
    return normalize_arrivals(
        parse_arrivals(load_fixture("upstream/arrivals-101.json")),
        stop_id="101",
        catalog=catalog,
        resolver=DirectionResolver(catalog),
        now=NOW,
    )


def test_unknown_stop_raises(catalog: Catalog, arrivals_101: StopArrivals) -> None:
    with pytest.raises(StopNotFound):
        build_cards(catalog, StopSelection(stop_id="424242"), arrivals_101)


def test_arrivals_for_another_stop_are_ignored(
    catalog: Catalog, arrivals_101: StopArrivals
) -> None:
    foreign = StopArrivals(
        stop_id="101",
        generated_at=NOW,
        arrivals=tuple(replace(a, stop_id="100") for a in arrivals_101.arrivals),
    )
    cards = build_cards(catalog, StopSelection(stop_id="101"), foreign)
    assert [card.arrivals for card in cards] == [(), (), (), ()]


def test_duplicate_selection_items_collapse(catalog: Catalog, arrivals_101: StopArrivals) -> None:
    (selection,) = parse_selection("101-2d.2d")
    cards = build_cards(catalog, selection, arrivals_101, limit=1)
    assert len(cards) == 1
    assert [a.minutes for a in cards[0].arrivals] == [1]


def test_limit_zero_keeps_cards_without_arrivals(
    catalog: Catalog, arrivals_101: StopArrivals
) -> None:
    cards = build_cards(catalog, StopSelection(stop_id="101"), arrivals_101, limit=0)
    assert [card.line_label for card in cards] == ["2", "5", "7", "10"]
    assert all(card.arrivals == () for card in cards)

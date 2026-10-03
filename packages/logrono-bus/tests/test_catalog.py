"""Catalogue normalisation and lookups, against the recorded Ayuntamiento-area corpus."""

from __future__ import annotations

from datetime import UTC, datetime
from itertools import pairwise

import pytest

from logrono_bus.errors import LineNotFound, StopNotFound, UpstreamSchemaError
from logrono_bus.models import Catalog, minutes_until, natural_sort_key
from logrono_bus.providers.logrono.normalize import build_catalog, normalize_line, split_line_name
from logrono_bus.providers.logrono.raw import RawLine, RawStop, RawStopRef

AYUNTAMIENTO = (42.4655, -2.4390)


def test_lines_are_sorted_numeric_first_with_b_lines_last(catalog: Catalog) -> None:
    assert [line.label for line in catalog.lines] == ["1", "2", "5", "7", "9", "10", "B1", "B3"]


@pytest.mark.parametrize(
    ("raw", "label", "name"),
    [
        ("2-YAGÜE-VAREA", "2", "Yagüe – Varea"),
        ("B3-LARDERO-EL CAMPILLO", "B3", "Lardero – El Campillo"),
        ("11-CENTRO-HOSPITAL SAN PEDRO", "11", "Centro – Hospital San Pedro"),
        ("NOCTURNO", "NOCTURNO", ""),
    ],
)
def test_split_line_name(raw: str, label: str, name: str) -> None:
    assert split_line_name(raw) == (label, name)


def test_normalize_line_falls_back_to_raw_name_and_rejects_bad_colour() -> None:
    line = normalize_line(RawLine(id="99", name="ESPECIAL", colour="#123456", asc=(), desc=()))
    assert (line.label, line.name, line.text_colour) == ("ESPECIAL", "ESPECIAL", "#FFFFFF")
    with pytest.raises(UpstreamSchemaError, match=r"line\[99\]\.color"):
        normalize_line(RawLine(id="99", name="X", colour="verde", asc=(), desc=()))


def test_natural_sort_key_orders_numbers_numerically() -> None:
    ids = ["10", "B1", "2", "33", "1"]
    assert sorted(ids, key=natural_sort_key) == ["1", "2", "10", "33", "B1"]


def test_patterns_carry_termini(catalog: Catalog) -> None:
    pattern = catalog.pattern("2:desc")
    assert pattern is not None
    assert (pattern.origin, pattern.headsign) == ("Artesanos", "Manresa")
    assert pattern.position("101") == 9
    assert pattern.position("100") is None
    assert pattern.is_terminus("56")
    assert not pattern.is_terminus("101")
    assert catalog.pattern("2:sideways") is None


def test_patterns_at_ayuntamiento_101(catalog: Catalog) -> None:
    ids = [p.id for p in catalog.patterns_at("101")]
    assert ids == ["2:desc", "5:asc", "7:desc", "10:desc"]
    assert catalog.patterns_at("does-not-exist") == ()


def test_patterns_for_line(catalog: Catalog) -> None:
    assert [p.id for p in catalog.patterns_for_line("31")] == ["31:asc", "31:desc"]


def test_lookups_raise_typed_errors(catalog: Catalog) -> None:
    assert catalog.stop("101").name == "Ayuntamiento"
    assert catalog.line("33").label == "B3"
    with pytest.raises(StopNotFound) as stop_error:
        catalog.stop("424242")
    assert stop_error.value.stop_id == "424242"
    with pytest.raises(LineNotFound):
        catalog.line("8")


def test_nearby_returns_ayuntamiento_stops_closest_first(catalog: Catalog) -> None:
    nearby = catalog.nearby(*AYUNTAMIENTO, radius_m=250)
    assert [n.stop.id for n in nearby] == ["101", "100", "2", "98", "28"]
    assert all(a.distance_m <= b.distance_m for a, b in pairwise(nearby))
    assert len(catalog.nearby(*AYUNTAMIENTO, radius_m=10_000, limit=3)) == 3
    assert catalog.nearby(0, 0) == []


def test_search_is_accent_insensitive_and_ranks_exact_id_first(catalog: Catalog) -> None:
    assert [s.id for s in catalog.search("ZUBIA")] == ["28", "803"]
    assert [s.id for s in catalog.search("ayunta")] == ["100", "101", "2", "98"]
    assert catalog.search("69")[0].id == "69"
    assert catalog.search("   ") == []
    assert len(catalog.search("a", limit=2)) == 2


def test_stop_line_ids_drop_unknown_lines_and_duplicates() -> None:
    catalog = build_catalog(
        [
            RawLine(
                id="2", name="2-A-B", colour="#FFFF00", asc=(RawStopRef(id="1", name="A"),), desc=()
            )
        ],
        [RawStop(id="1", name="A", lat=0, lon=0, line_ids=("2", "2", "8"))],
        fetched_at=datetime(2026, 10, 3, tzinfo=UTC),
    )
    assert catalog.stop("1").line_ids == ("2",)
    assert [p.id for p in catalog.patterns] == ["2:asc"]


@pytest.mark.parametrize(
    ("seconds", "minutes"), [(-30, 0), (0, 0), (59, 0), (60, 1), (119, 1), (600, 10)]
)
def test_minutes_until_floors_and_clamps(seconds: int, minutes: int) -> None:
    now = datetime(2026, 10, 3, 16, 0, tzinfo=UTC)
    expected = datetime.fromtimestamp(now.timestamp() + seconds, tz=UTC)
    assert minutes_until(expected, now) == minutes

"""Colour, text, geo and serialisation helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone

import pytest

from logrono_bus.colour import BLACK, WHITE, contrast_ratio, parse_colour, text_colour_for
from logrono_bus.geo import distance_m
from logrono_bus.serialize import to_json
from logrono_bus.text import fold, title_es
from logrono_bus.timetable import clock_minutes, describe_interval, service_status

AYUNTAMIENTO = (42.4655, -2.4390)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("rgba(1,255,1,1)", "#01FF01"),
        ("rgba(253, 130, 187, 0.5)", "#FD82BB"),
        ("rgb(0,2,253)", "#0002FD"),
        ("#0fdcfc", "#0FDCFC"),
        ("269905", "#269905"),
        ("  RGBA(15,220,252,1) ", "#0FDCFC"),
    ],
)
def test_parse_colour_accepts_upstream_and_hex_forms(raw: str, expected: str) -> None:
    assert parse_colour(raw) == expected


@pytest.mark.parametrize(
    "raw", ["", "red", "#12345", "rgba(256,0,0,1)", "rgba(1,2)", "hsl(0,0%,0%)"]
)
def test_parse_colour_rejects_garbage(raw: str) -> None:
    with pytest.raises(ValueError, match="olor"):
        parse_colour(raw)


def test_contrast_ratio_bounds() -> None:
    assert contrast_ratio(BLACK, WHITE) == pytest.approx(21)
    assert contrast_ratio("#777777", "#777777") == pytest.approx(1)


@pytest.mark.parametrize(
    ("background", "text"),
    [
        ("#FFFF00", BLACK),  # line 2, yellow
        ("#BABABA", BLACK),  # line 7, light grey
        ("#0002FD", WHITE),  # line 9, blue
        ("#924C48", WHITE),  # line 6, brown
        ("#C100FB", BLACK),  # line 3, purple: black wins narrowly (4.66 vs 4.51)
    ],
)
def test_text_colour_maximises_contrast(background: str, text: str) -> None:
    assert text_colour_for(background) == text
    assert contrast_ratio(background, text) >= 4.5


def test_fold_is_case_and_accent_insensitive() -> None:
    assert fold("  Glorieta Dr.   ZUBÍA ") == "glorieta dr. zubia"
    assert fold("Yagüe") == fold("YAGUE")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("PALACIO DE CONGRESOS", "Palacio de Congresos"),
        ("EL ARCO", "El Arco"),
        ("POLÍGONO CANTABRIA", "Polígono Cantabria"),
        ("LAS NORIAS", "Las Norias"),
        ("CASA DE LAS CIENCIAS Y EL RÍO", "Casa de las Ciencias y el Río"),
    ],
)
def test_title_es_follows_spanish_signage(raw: str, expected: str) -> None:
    assert title_es(raw) == expected


def test_distance_m_matches_known_distance() -> None:
    stop_101 = (42.465553, -2.439170)
    assert distance_m(*AYUNTAMIENTO, *stop_101) == pytest.approx(16, abs=5)
    assert distance_m(*AYUNTAMIENTO, *AYUNTAMIENTO) == 0
    one_degree_latitude = distance_m(42, -2, 43, -2)
    assert one_degree_latitude == pytest.approx(111_195, rel=1e-3)


@dataclass(frozen=True)
class _Sample:
    when: datetime
    items: tuple[int, ...]
    mapping: dict[int, str]
    missing: None = None


def test_to_json_handles_nested_models() -> None:
    madrid = timezone(timedelta(hours=2))
    sample = _Sample(
        when=datetime(2026, 10, 3, 18, 0, tzinfo=madrid), items=(1, 2), mapping={1: "a"}
    )
    assert to_json(sample) == {
        "when": "2026-10-03T18:00:00+02:00",
        "items": [1, 2],
        "mapping": {"1": "a"},
        "missing": None,
    }
    assert to_json([datetime(2026, 1, 1, tzinfo=UTC)]) == ["2026-01-01T00:00:00+00:00"]


def test_to_json_rejects_unknown_types() -> None:
    with pytest.raises(TypeError, match="set"):
        to_json({1, 2})


def test_describe_interval() -> None:
    assert describe_interval(30) == "cada 30 min"
    assert describe_interval(30, 30) == "cada 30 min"
    assert describe_interval(12, 15) == "cada 12–15 min"


def test_clock_minutes_keeps_after_midnight_times_past_the_day() -> None:
    assert clock_minutes("07:05") == 425
    assert clock_minutes("24:30") == 1470


def test_service_status_without_timetable() -> None:
    status = service_status(None, datetime(2026, 10, 4, 10, tzinfo=UTC))
    assert status.state == "sin_servicio"
    assert status.next_departure is None

"""Upstream parsing: any surprise must surface as UpstreamSchemaError with a JSON path."""

from __future__ import annotations

from typing import Any

import pytest
from contract_fixtures import load_fixture

from logrono_bus.errors import UpstreamSchemaError
from logrono_bus.providers.logrono.raw import (
    RawFrequency,
    parse_arrivals,
    parse_lines,
    parse_stops,
    parse_timetable,
)


def _arrival(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "lineRef": "2",
        "directionRef": "321",
        "vehicleRef": "55",
        "stopPointRef": "101",
        "order": 9,
        "aimedArrivalTime": "2026-10-03T17:48:36+02:00",
        "expectedArrivalTime": "2026-10-03T17:59:18+02:00",
        "arrivalStatus": "NO_REPORT",
        "cancellation": False,
        "predictionInaccurate": True,
        "delaySeconds": 642,
    }
    return base | overrides


def _wrap(*arrivals: dict[str, Any]) -> dict[str, Any]:
    return {"result": {"arrivals": list(arrivals)}}


def test_recorded_catalogue_parses() -> None:
    lines = parse_lines(load_fixture("upstream/lines.json"))
    stops = parse_stops(load_fixture("upstream/stops.json"))
    assert {line.id for line in lines} == {"1", "2", "5", "7", "9", "10", "31", "33"}
    assert next(s for s in stops if s.id == "101").line_ids == ("7", "5", "10", "2")


def test_arrival_parses_and_normalises_identifiers() -> None:
    (arrival,) = parse_arrivals(_wrap(_arrival(stopPointRef="0101", lineRef=2, vehicleRef="")))
    assert (arrival.stop_id, arrival.line_id, arrival.vehicle_ref) == ("101", "2", "")
    assert arrival.expected.utcoffset() is not None
    assert arrival.delay_s == 642


def test_optional_fields_get_defaults() -> None:
    minimal = {
        key: value
        for key, value in _arrival().items()
        if key in {"lineRef", "stopPointRef", "aimedArrivalTime", "expectedArrivalTime"}
    }
    (arrival,) = parse_arrivals(_wrap(minimal))
    assert arrival.direction_ref == ""
    assert arrival.order is None
    assert (arrival.cancelled, arrival.inaccurate, arrival.delay_s) == (False, False, 0)
    assert (
        parse_stops({"result": {"stops": [{"id": 1, "name": "A", "lat": 1, "lng": 2}]}})[0].line_ids
        == ()
    )


@pytest.mark.parametrize(
    ("payload", "path"),
    [
        ([], "$"),
        ({}, "$.result"),
        ({"result": {"arrivals": {}}}, "$.result.arrivals"),
        (_wrap("x"), "$.result.arrivals[0]"),
        (_wrap(_arrival(lineRef=None)), "$.result.arrivals[0].lineRef"),
        (_wrap(_arrival(lineRef="")), "$.result.arrivals[0].lineRef"),
        (_wrap(_arrival(lineRef=True)), "$.result.arrivals[0].lineRef"),
        (_wrap(_arrival(order="9")), "$.result.arrivals[0].order"),
        (_wrap(_arrival(expectedArrivalTime="mañana")), "$.result.arrivals[0].expectedArrivalTime"),
        (
            _wrap(_arrival(expectedArrivalTime="2026-10-03T17:59:18")),
            "$.result.arrivals[0].expectedArrivalTime",
        ),
        (_wrap(_arrival(cancellation="no")), "$.result.arrivals[0].cancellation"),
        (_wrap(_arrival(delaySeconds=1.5)), "$.result.arrivals[0].delaySeconds"),
        (_wrap(_arrival(arrivalStatus=3)), "$.result.arrivals[0].arrivalStatus"),
    ],
)
def test_malformed_arrivals_name_the_offending_path(payload: object, path: str) -> None:
    with pytest.raises(UpstreamSchemaError) as error:
        parse_arrivals(payload)
    assert error.value.path == path


def test_empty_arrival_time_falls_back_to_the_departure_time() -> None:
    (arrival,) = parse_arrivals(
        _wrap(
            _arrival(
                aimedArrivalTime="",
                expectedArrivalTime=" ",
                aimedDepartureTime="2026-10-03T17:50:00+02:00",
                expectedDepartureTime="2026-10-03T18:01:00+02:00",
            )
        )
    )
    print(f"aimed={arrival.aimed.isoformat()} expected={arrival.expected.isoformat()}")
    assert arrival.aimed.isoformat() == "2026-10-03T17:50:00+02:00"
    assert arrival.expected.isoformat() == "2026-10-03T18:01:00+02:00"


@pytest.mark.parametrize(
    "untimed",
    [
        _arrival(aimedArrivalTime=""),
        _arrival(expectedArrivalTime="", expectedDepartureTime=None),
        _arrival(aimedArrivalTime="", aimedDepartureTime=""),
    ],
)
def test_arrival_without_any_time_is_skipped_and_the_rest_kept(untimed: dict[str, Any]) -> None:
    arrivals = parse_arrivals(_wrap(_arrival(vehicleRef="61"), untimed, _arrival(vehicleRef="62")))
    print([a.vehicle_ref for a in arrivals])
    assert [a.vehicle_ref for a in arrivals] == ["61", "62"]


@pytest.mark.parametrize(
    ("overrides", "path"),
    [
        ({"aimedArrivalTime": None}, "$.result.arrivals[0].aimedArrivalTime"),
        (
            {"aimedArrivalTime": "", "aimedDepartureTime": "mañana"},
            "$.result.arrivals[0].aimedDepartureTime",
        ),
        (
            {"expectedArrivalTime": "", "expectedDepartureTime": 0},
            "$.result.arrivals[0].expectedDepartureTime",
        ),
    ],
)
def test_malformed_arrival_times_still_fail(overrides: dict[str, Any], path: str) -> None:
    with pytest.raises(UpstreamSchemaError) as error:
        parse_arrivals(_wrap(_arrival(**overrides)))
    print(error.value)
    assert error.value.path == path


def test_missing_required_field_is_reported() -> None:
    payload = _wrap({k: v for k, v in _arrival().items() if k != "aimedArrivalTime"})
    with pytest.raises(UpstreamSchemaError, match="falta el campo"):
        parse_arrivals(payload)


@pytest.mark.parametrize(
    ("payload", "path"),
    [
        (
            {"result": {"lines": [{"id": 1, "name": "x", "color": "#fff000"}]}},
            "$.result.lines[0].stops",
        ),
        (
            {
                "result": {
                    "lines": [
                        {
                            "id": 1,
                            "name": "x",
                            "color": "#fff000",
                            "stops": {"asc": [1], "desc": []},
                        }
                    ]
                }
            },
            "$.result.lines[0].stops.asc[0]",
        ),
    ],
)
def test_malformed_lines(payload: object, path: str) -> None:
    with pytest.raises(UpstreamSchemaError) as error:
        parse_lines(payload)
    assert error.value.path == path


@pytest.mark.parametrize(
    ("stop", "path"),
    [
        ({"id": 1, "name": "A", "lat": "42", "lng": -2}, "$.result.stops[0].lat"),
        ({"id": 1, "name": "A", "lat": True, "lng": -2}, "$.result.stops[0].lat"),
        ({"id": 1, "name": 5, "lat": 42, "lng": -2}, "$.result.stops[0].name"),
        ({"id": 1, "name": "A", "lat": 42, "lng": -2, "lines": "2"}, "$.result.stops[0].lines"),
    ],
)
def test_malformed_stops(stop: dict[str, Any], path: str) -> None:
    with pytest.raises(UpstreamSchemaError) as error:
        parse_stops({"result": {"stops": [stop]}})
    assert error.value.path == path


def test_timetable_parses_per_direction_and_pads_clock_times() -> None:
    directions = parse_timetable(load_fixture("upstream/timetable-sintetico.json"))
    assert [d.name for d in directions] == ["Ida", "Circular"]
    ida = directions[0]
    assert ida.passes[:3] == ("06:30", "06:42", "06:57")
    assert ida.frequencies[0] == RawFrequency(
        first="06:30", last="08:00", interval_min=12, interval_max_min=15
    )
    assert ida.frequencies[1].interval_max_min is None
    assert directions[1].frequencies == ()


@pytest.mark.parametrize(
    ("payload", "path"),
    [
        ({}, "$.result"),
        ({"result": {"passesByDirection": {}}}, "$.result.frequenciesByDirection"),
        (
            {"result": {"frequenciesByDirection": {}, "passesByDirection": {"Ida": ["7h05"]}}},
            "$.result.passesByDirection.Ida[0]",
        ),
        (
            {"result": {"frequenciesByDirection": {}, "passesByDirection": {"Ida": ["30:00"]}}},
            "$.result.passesByDirection.Ida[0]",
        ),
        (
            {"result": {"frequenciesByDirection": {}, "passesByDirection": {"Ida": ["07:60"]}}},
            "$.result.passesByDirection.Ida[0]",
        ),
        (
            {
                "result": {
                    "frequenciesByDirection": {
                        "Ida": [{"firstPass": "07:00", "lastPass": "08:00"}]
                    },
                    "passesByDirection": {},
                }
            },
            "$.result.frequenciesByDirection.Ida[0].intervalMinutes",
        ),
    ],
)
def test_malformed_timetables_name_the_offending_path(payload: object, path: str) -> None:
    with pytest.raises(UpstreamSchemaError) as caught:
        parse_timetable(payload)
    assert caught.value.path == path

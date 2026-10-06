"""Validated parsing of the upstream JSON into typed records.

The upstream is undocumented, so nothing here trusts it: every field is type-checked and any
surprise becomes an :class:`~logrono_bus.errors.UpstreamSchemaError` naming the JSON path, which is
what lets the weekly contract job (and Home Assistant repairs) tell "the API changed" apart from
"the network is down". Optional fields the upstream sometimes omits get explicit defaults.

Field names follow the upstream (camelCase in, snake_case attributes out); meaning is assigned
later, in :mod:`.normalize`.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from logrono_bus.errors import UpstreamSchemaError


@dataclass(frozen=True, slots=True, kw_only=True)
class RawStopRef:
    id: str
    name: str


@dataclass(frozen=True, slots=True, kw_only=True)
class RawLine:
    id: str
    name: str
    colour: str
    asc: tuple[RawStopRef, ...]
    desc: tuple[RawStopRef, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class RawStop:
    id: str
    name: str
    lat: float
    lon: float
    line_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class RawArrival:
    line_id: str
    stop_id: str
    direction_ref: str
    """Numeric route-direction code (``"321"``); empty on timetable fill-ins."""
    vehicle_ref: str
    """Empty on timetable fill-ins."""
    order: int | None
    """1-based position of the stop along the bus's pattern."""
    aimed: datetime
    expected: datetime
    arrival_status: str
    cancelled: bool
    inaccurate: bool
    delay_s: int


@dataclass(frozen=True, slots=True, kw_only=True)
class RawVehicle:
    vehicle_ref: str
    line_id: str
    direction_ref: str
    """``"Ida"`` / ``"Vuelta"`` here, unlike the numeric codes of the arrivals endpoint."""
    lat: float
    lon: float
    next_stop_id: str
    """Empty when unknown."""
    recorded_at: datetime
    delay_s: int


@dataclass(frozen=True, slots=True, kw_only=True)
class RawFrequency:
    first: str
    """First departure of the period, ``"HH:MM"`` local time."""
    last: str
    interval_min: int
    interval_max_min: int | None
    """Present when the headway varies within the period (``intervalMinutesMax``)."""


@dataclass(frozen=True, slots=True, kw_only=True)
class RawDirectionTimetable:
    name: str
    """``"Ida"`` / ``"Vuelta"``, as in vehicle positions."""
    frequencies: tuple[RawFrequency, ...]
    passes: tuple[str, ...]
    """Today's departures, ``"HH:MM"`` local time, in the order given."""


_CLOCK = re.compile(r"^(\d{1,2}):(\d{2})$")
_MAX_CLOCK_HOUR = 29
"""Timetables may write after-midnight trips as 24:xx–29:xx; anything later is not a time."""
_MINUTES_PER_HOUR = 60


def _expect_mapping(value: object, path: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise UpstreamSchemaError(f"se esperaba un objeto, llegó {type(value).__name__}", path=path)
    return value


def _expect_list(value: object, path: str) -> Sequence[object]:
    if not isinstance(value, list):
        raise UpstreamSchemaError(f"se esperaba una lista, llegó {type(value).__name__}", path=path)
    return value


def _required(obj: Mapping[str, object], key: str, path: str) -> object:
    if key not in obj:
        raise UpstreamSchemaError("falta el campo", path=f"{path}.{key}")
    return obj[key]


def _str(value: object, path: str) -> str:
    if not isinstance(value, str):
        raise UpstreamSchemaError(f"se esperaba texto, llegó {type(value).__name__}", path=path)
    return value.strip()


def _int(value: object, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise UpstreamSchemaError(f"se esperaba un entero, llegó {type(value).__name__}", path=path)
    return value


def _float(value: object, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise UpstreamSchemaError(f"se esperaba un número, llegó {type(value).__name__}", path=path)
    return float(value)


def _bool(value: object, path: str) -> bool:
    if not isinstance(value, bool):
        raise UpstreamSchemaError(
            f"se esperaba un booleano, llegó {type(value).__name__}", path=path
        )
    return value


def _identifier(value: object, path: str) -> str:
    """Canonical id: catalogue ids are ints, arrivals use strings, vehicle monitoring zero-pads
    (``"0127"``). All three collapse to the same unpadded string."""
    if isinstance(value, bool):
        raise UpstreamSchemaError("se esperaba un identificador, llegó un booleano", path=path)
    if isinstance(value, int):
        return str(value)
    text = _str(value, path)
    if not text:
        raise UpstreamSchemaError("identificador vacío", path=path)
    return str(int(text)) if text.isdigit() else text


def _optional_identifier(value: object, path: str) -> str:
    if value is None or value == "":
        return ""
    return _identifier(value, path)


def _timestamp(value: object, path: str) -> datetime:
    text = _str(value, path)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise UpstreamSchemaError(f"fecha no válida {text!r}", path=path) from None
    if parsed.tzinfo is None:
        raise UpstreamSchemaError(f"fecha sin zona horaria {text!r}", path=path)
    return parsed


def _arrival_time(obj: Mapping[str, object], kind: str, path: str) -> datetime | None:
    """``{kind}ArrivalTime``, or the same row's ``{kind}DepartureTime`` when the arrival comes
    empty, as it may for a bus starting its trip at the stop. ``None`` when both are empty."""
    arrival_path = f"{path}.{kind}ArrivalTime"
    arrival = _str(_required(obj, f"{kind}ArrivalTime", path), arrival_path)
    if arrival:
        return _timestamp(arrival, arrival_path)
    departure_path = f"{path}.{kind}DepartureTime"
    raw_departure = obj.get(f"{kind}DepartureTime")
    departure = _str("" if raw_departure is None else raw_departure, departure_path)
    return _timestamp(departure, departure_path) if departure else None


def _clock(value: object, path: str) -> str:
    """``"7:05"`` or ``"07:05"`` → ``"07:05"``."""
    match = _CLOCK.match(_str(value, path))
    if match is None or int(match[1]) > _MAX_CLOCK_HOUR or int(match[2]) >= _MINUTES_PER_HOUR:
        raise UpstreamSchemaError(f"hora no válida: {value!r}", path=path)
    return f"{int(match[1]):02d}:{match[2]}"


def _result(payload: object, key: str) -> Sequence[object]:
    root = _expect_mapping(payload, "$")
    result = _expect_mapping(_required(root, "result", "$"), "$.result")
    return _expect_list(_required(result, key, "$.result"), f"$.result.{key}")


def _stop_refs(value: object, path: str) -> tuple[RawStopRef, ...]:
    refs = []
    for index, item in enumerate(_expect_list(value, path)):
        item_path = f"{path}[{index}]"
        obj = _expect_mapping(item, item_path)
        refs.append(
            RawStopRef(
                id=_identifier(_required(obj, "id", item_path), f"{item_path}.id"),
                name=_str(_required(obj, "name", item_path), f"{item_path}.name"),
            )
        )
    return tuple(refs)


def parse_lines(payload: object) -> list[RawLine]:
    """Parse ``GET linesDiscovery/lines``."""
    lines = []
    for index, item in enumerate(_result(payload, "lines")):
        path = f"$.result.lines[{index}]"
        obj = _expect_mapping(item, path)
        stops = _expect_mapping(_required(obj, "stops", path), f"{path}.stops")
        lines.append(
            RawLine(
                id=_identifier(_required(obj, "id", path), f"{path}.id"),
                name=_str(_required(obj, "name", path), f"{path}.name"),
                colour=_str(_required(obj, "color", path), f"{path}.color"),
                asc=_stop_refs(_required(stops, "asc", f"{path}.stops"), f"{path}.stops.asc"),
                desc=_stop_refs(_required(stops, "desc", f"{path}.stops"), f"{path}.stops.desc"),
            )
        )
    return lines


def parse_stops(payload: object) -> list[RawStop]:
    """Parse ``GET linesDiscovery/stops``."""
    stops = []
    for index, item in enumerate(_result(payload, "stops")):
        path = f"$.result.stops[{index}]"
        obj = _expect_mapping(item, path)
        line_ids = _expect_list(obj.get("lines", []), f"{path}.lines")
        stops.append(
            RawStop(
                id=_identifier(_required(obj, "id", path), f"{path}.id"),
                name=_str(_required(obj, "name", path), f"{path}.name"),
                lat=_float(_required(obj, "lat", path), f"{path}.lat"),
                lon=_float(_required(obj, "lng", path), f"{path}.lng"),
                line_ids=tuple(
                    _identifier(line_id, f"{path}.lines[{i}]") for i, line_id in enumerate(line_ids)
                ),
            )
        )
    return stops


def parse_arrivals(payload: object) -> list[RawArrival]:
    """Parse ``GET estimatedTimetable/byStop/{id}``.

    A row with no arrival or departure time is skipped: there is nothing to show for it, and one
    such row must not take down every other arrival at the stop.
    """
    arrivals = []
    for index, item in enumerate(_result(payload, "arrivals")):
        path = f"$.result.arrivals[{index}]"
        obj = _expect_mapping(item, path)
        order = obj.get("order")
        aimed = _arrival_time(obj, "aimed", path)
        expected = _arrival_time(obj, "expected", path)
        if aimed is None or expected is None:
            continue
        arrivals.append(
            RawArrival(
                line_id=_identifier(_required(obj, "lineRef", path), f"{path}.lineRef"),
                stop_id=_identifier(_required(obj, "stopPointRef", path), f"{path}.stopPointRef"),
                direction_ref=_optional_identifier(obj.get("directionRef"), f"{path}.directionRef"),
                vehicle_ref=_optional_identifier(obj.get("vehicleRef"), f"{path}.vehicleRef"),
                order=None if order is None else _int(order, f"{path}.order"),
                aimed=aimed,
                expected=expected,
                arrival_status=_str(obj.get("arrivalStatus", ""), f"{path}.arrivalStatus"),
                cancelled=_bool(obj.get("cancellation", False), f"{path}.cancellation"),
                inaccurate=_bool(
                    obj.get("predictionInaccurate", False), f"{path}.predictionInaccurate"
                ),
                delay_s=_int(obj.get("delaySeconds", 0), f"{path}.delaySeconds"),
            )
        )
    return arrivals


def parse_vehicles(payload: object) -> list[RawVehicle]:
    """Parse ``GET vehicleMonitoring/byLine/{line}``.

    Its ``nextStop*ArrivalTime`` fields are local times wrongly labelled UTC; they are not read.
    ``locationRecordedAtTime`` is correct UTC.
    """
    vehicles = []
    for index, item in enumerate(_result(payload, "activities")):
        path = f"$.result.activities[{index}]"
        obj = _expect_mapping(item, path)
        vehicles.append(
            RawVehicle(
                vehicle_ref=_identifier(_required(obj, "vehicleRef", path), f"{path}.vehicleRef"),
                line_id=_identifier(_required(obj, "lineRef", path), f"{path}.lineRef"),
                direction_ref=_str(obj.get("directionRef", ""), f"{path}.directionRef"),
                lat=_float(_required(obj, "latitude", path), f"{path}.latitude"),
                lon=_float(_required(obj, "longitude", path), f"{path}.longitude"),
                next_stop_id=_optional_identifier(obj.get("nextStopRef"), f"{path}.nextStopRef"),
                recorded_at=_timestamp(
                    _required(obj, "locationRecordedAtTime", path), f"{path}.locationRecordedAtTime"
                ),
                delay_s=_int(obj.get("delaySeconds", 0), f"{path}.delaySeconds"),
            )
        )
    return vehicles


def parse_timetable(payload: object) -> list[RawDirectionTimetable]:
    """Parse ``GET productionTimetable/byLine/{line}``: today's service, per direction.

    Only the per-direction lists are read; ``frequencies`` and ``passes`` merge both directions.
    """
    root = _expect_mapping(payload, "$")
    result = _expect_mapping(_required(root, "result", "$"), "$.result")
    frequencies = _expect_mapping(
        _required(result, "frequenciesByDirection", "$.result"), "$.result.frequenciesByDirection"
    )
    passes = _expect_mapping(
        _required(result, "passesByDirection", "$.result"), "$.result.passesByDirection"
    )
    directions = []
    for name in dict.fromkeys([*passes, *frequencies]):
        passes_path = f"$.result.passesByDirection.{name}"
        frequencies_path = f"$.result.frequenciesByDirection.{name}"
        directions.append(
            RawDirectionTimetable(
                name=name,
                frequencies=tuple(
                    _frequency(item, f"{frequencies_path}[{index}]")
                    for index, item in enumerate(
                        _expect_list(frequencies.get(name, []), frequencies_path)
                    )
                ),
                passes=tuple(
                    _clock(item, f"{passes_path}[{index}]")
                    for index, item in enumerate(_expect_list(passes.get(name, []), passes_path))
                ),
            )
        )
    return directions


def _frequency(item: object, path: str) -> RawFrequency:
    obj = _expect_mapping(item, path)
    interval_max = obj.get("intervalMinutesMax")
    return RawFrequency(
        first=_clock(_required(obj, "firstPass", path), f"{path}.firstPass"),
        last=_clock(_required(obj, "lastPass", path), f"{path}.lastPass"),
        interval_min=_int(_required(obj, "intervalMinutes", path), f"{path}.intervalMinutes"),
        interval_max_min=(
            None if interval_max is None else _int(interval_max, f"{path}.intervalMinutesMax")
        ),
    )

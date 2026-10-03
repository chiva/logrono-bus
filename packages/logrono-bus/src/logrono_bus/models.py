"""Provider-neutral domain model.

These types are the contract every consumer relies on (the web app, the HTTP service, the Home
Assistant integration). Upstream quirks never leak past a provider: identifiers are always
strings without zero padding, colours are ``#RRGGBB``, times are timezone-aware.

The JSON form of these types (see :mod:`logrono_bus.serialize`) is mirrored by the TypeScript
normaliser in ``web/packages/core``; both are checked against the same golden fixtures in
``contracts/fixtures``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from functools import cached_property
from typing import Final, Literal
from zoneinfo import ZoneInfo

from logrono_bus.errors import LineNotFound, StopNotFound
from logrono_bus.geo import distance_m
from logrono_bus.text import fold

TIMEZONE: Final = ZoneInfo("Europe/Madrid")
"""Local time of the network, for display. Model datetimes keep whatever offset they came with."""

type Direction = Literal["asc", "desc"]
DIRECTIONS: tuple[Direction, ...] = ("asc", "desc")


def minutes_until(expected: datetime, now: datetime) -> int:
    """Whole minutes until ``expected`` (floored, never negative)."""
    return max(0, math.floor((expected - now).total_seconds() / 60))


def natural_sort_key(value: str) -> tuple[int, int, str]:
    """Numeric identifiers first in numeric order (1, 2, …, 11), then the rest (B1, B2, B3)."""
    return (0, int(value), "") if value.isdigit() else (1, 0, value)


@dataclass(frozen=True, slots=True, kw_only=True)
class Line:
    id: str
    """Stable identifier used by the upstream (``"31"`` for the B1 bus)."""
    label: str
    """What the bus shows on its front sign: ``"2"``, ``"B1"``."""
    name: str
    """Human-readable route name, e.g. ``"Yagüe – Varea"``."""
    colour: str
    """Official background colour, ``#RRGGBB``."""
    text_colour: str
    """Black or white, whichever is legible on :attr:`colour`."""


@dataclass(frozen=True, slots=True, kw_only=True)
class Pattern:
    """One direction of a line: the ordered list of stops a bus visits."""

    id: str
    """``"{line_id}:{direction}"``, e.g. ``"2:desc"``."""
    line_id: str
    direction: Direction
    origin: str
    """Name of the first stop."""
    headsign: str
    """Name of the last stop: what riders read as "hacia …"."""
    stop_ids: tuple[str, ...]

    def position(self, stop_id: str) -> int | None:
        """1-based position of ``stop_id`` along the pattern, or ``None`` if not served."""
        try:
            return self.stop_ids.index(stop_id) + 1
        except ValueError:
            return None

    def is_terminus(self, stop_id: str) -> bool:
        """Whether buses on this pattern end their trip at ``stop_id``."""
        return bool(self.stop_ids) and self.stop_ids[-1] == stop_id


@dataclass(frozen=True, slots=True, kw_only=True)
class Stop:
    id: str
    name: str
    lat: float
    lon: float
    line_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class NearbyStop:
    stop: Stop
    distance_m: float


@dataclass(frozen=True, kw_only=True)
class Catalog:
    """Static network description: lines, their directions, and stops.

    Lookups are indexed lazily (``cached_property`` writes straight into the instance ``__dict__``,
    so it works on a frozen dataclass without slots).
    """

    lines: tuple[Line, ...]
    patterns: tuple[Pattern, ...]
    stops: tuple[Stop, ...]
    fetched_at: datetime

    @cached_property
    def _lines_by_id(self) -> dict[str, Line]:
        return {line.id: line for line in self.lines}

    @cached_property
    def _stops_by_id(self) -> dict[str, Stop]:
        return {stop.id: stop for stop in self.stops}

    @cached_property
    def _patterns_by_id(self) -> dict[str, Pattern]:
        return {pattern.id: pattern for pattern in self.patterns}

    @cached_property
    def _patterns_by_stop(self) -> dict[str, tuple[Pattern, ...]]:
        index: dict[str, list[Pattern]] = {}
        for pattern in self.patterns:
            for stop_id in dict.fromkeys(pattern.stop_ids):
                index.setdefault(stop_id, []).append(pattern)
        return {stop_id: tuple(patterns) for stop_id, patterns in index.items()}

    def line(self, line_id: str) -> Line:
        try:
            return self._lines_by_id[line_id]
        except KeyError:
            raise LineNotFound(line_id) from None

    def stop(self, stop_id: str) -> Stop:
        try:
            return self._stops_by_id[stop_id]
        except KeyError:
            raise StopNotFound(stop_id) from None

    def pattern(self, pattern_id: str) -> Pattern | None:
        return self._patterns_by_id.get(pattern_id)

    def patterns_for_line(self, line_id: str) -> tuple[Pattern, ...]:
        return tuple(p for p in self.patterns if p.line_id == line_id)

    def patterns_at(self, stop_id: str) -> tuple[Pattern, ...]:
        """Every direction of every line that serves ``stop_id``."""
        return self._patterns_by_stop.get(stop_id, ())

    def nearby(
        self, lat: float, lon: float, *, radius_m: float = 500, limit: int = 10
    ) -> list[NearbyStop]:
        """Stops within ``radius_m`` of a point, closest first."""
        candidates = (
            NearbyStop(stop=stop, distance_m=distance_m(lat, lon, stop.lat, stop.lon))
            for stop in self.stops
        )
        in_range = (c for c in candidates if c.distance_m <= radius_m)
        return sorted(in_range, key=lambda c: (c.distance_m, c.stop.id))[:limit]

    def search(self, query: str, *, limit: int = 20) -> list[Stop]:
        """Accent- and case-insensitive name search; an exact stop number ranks first."""
        needle = fold(query)
        if not needle:
            return []
        exact = [self._stops_by_id[needle]] if needle in self._stops_by_id else []
        by_name = sorted(
            (stop for stop in self.stops if needle in fold(stop.name) and stop not in exact),
            key=lambda stop: (not fold(stop.name).startswith(needle), stop.name, stop.id),
        )
        return [*exact, *by_name][:limit]


@dataclass(frozen=True, slots=True, kw_only=True)
class Arrival:
    stop_id: str
    line_id: str
    pattern_id: str | None
    """``None`` when the direction could not be determined with certainty."""
    direction: Direction | None
    headsign: str | None
    aimed: datetime
    """Timetabled time."""
    expected: datetime
    """Best estimate: real-time prediction if there is one, otherwise the timetable."""
    minutes: int
    """Whole minutes from the response's ``generated_at`` until :attr:`expected` (never negative)."""
    delay_s: int
    is_realtime: bool
    """A tracked vehicle backs this estimate; ``False`` means a timetable fill-in."""
    is_approximate: bool
    """The upstream flags the prediction as inaccurate."""
    terminates: bool
    """The bus ends its trip at this stop (riders cannot board towards :attr:`headsign`)."""
    cancelled: bool
    vehicle_id: str | None


@dataclass(frozen=True, slots=True, kw_only=True)
class StopArrivals:
    stop_id: str
    generated_at: datetime
    arrivals: tuple[Arrival, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class Vehicle:
    """A bus on the road, as last reported."""

    id: str
    """Fleet number. Note: not the same number the arrivals endpoint uses for the same bus."""
    line_id: str
    direction: Direction | None
    pattern_id: str | None
    lat: float
    lon: float
    next_stop_id: str | None
    """The stop the bus is heading to; ``None`` when the upstream does not say."""
    recorded_at: datetime
    delay_s: int


@dataclass(frozen=True, slots=True, kw_only=True)
class LineVehicles:
    line_id: str
    generated_at: datetime
    vehicles: tuple[Vehicle, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class ServicePeriod:
    """A stretch of the day with a regular headway."""

    first: str
    """First departure of the period, ``"HH:MM"`` local time."""
    last: str
    interval_min: int
    interval_max_min: int
    """Equal to :attr:`interval_min` unless the headway varies (``"cada 12–15 min"``)."""


@dataclass(frozen=True, slots=True, kw_only=True)
class DirectionTimetable:
    """Today's service in one direction of a line."""

    pattern_id: str
    direction: Direction
    origin: str
    """Where the departures leave from: the times are at this stop, not at the rider's."""
    headsign: str
    departures: tuple[str, ...]
    """``"HH:MM"`` local time, in service order (after-midnight trips may read 24:xx)."""
    periods: tuple[ServicePeriod, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class LineTimetable:
    line_id: str
    service_date: str
    """Local date (``YYYY-MM-DD``) the timetable applies to: the upstream only gives today's."""
    generated_at: datetime
    directions: tuple[DirectionTimetable, ...]

    def for_pattern(self, pattern_id: str) -> DirectionTimetable | None:
        return next((d for d in self.directions if d.pattern_id == pattern_id), None)

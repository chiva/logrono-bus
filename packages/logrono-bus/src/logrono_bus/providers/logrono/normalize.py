"""Pure transformation from upstream records to the domain model.

No I/O and no clock: ``now`` is always passed in, so the same inputs give the same output on any
machine. That determinism is what makes the golden fixtures shared with the TypeScript normaliser
possible.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from logrono_bus.colour import parse_colour, text_colour_for
from logrono_bus.errors import UpstreamSchemaError
from logrono_bus.models import (
    DIRECTIONS,
    TIMEZONE,
    Arrival,
    Catalog,
    Direction,
    DirectionTimetable,
    Line,
    LineTimetable,
    LineVehicles,
    Pattern,
    ServicePeriod,
    Stop,
    StopArrivals,
    Vehicle,
    minutes_until,
    natural_sort_key,
)
from logrono_bus.providers.logrono.directions import DirectionResolver
from logrono_bus.providers.logrono.raw import (
    RawArrival,
    RawDirectionTimetable,
    RawLine,
    RawStop,
    RawVehicle,
)
from logrono_bus.text import title_es

SCHEDULED_STATUS = "scheduled"
"""``arrivalStatus`` of a timetable fill-in (no tracked vehicle behind it)."""

PAST_ARRIVAL_GRACE = timedelta(seconds=60)
"""Arrivals expected longer ago than this are dropped: the bus has left."""

STALE_POSITION = timedelta(minutes=3)
"""Positions older than this are dropped: the bus may have finished its trip or lost signal."""

DIRECTION_NAMES: dict[str, Direction] = {"ida": "asc", "vuelta": "desc"}
"""Named directions → catalogue direction, for vehicle positions (``directionRef``) and timetables
(``…ByDirection`` keys). Verified on lines 1, 2, 5 and 10 (2026-10-03): every "Ida" bus was heading
to a stop of ``stops.asc``, every "Vuelta" one to ``stops.desc``."""

_NAME_SEPARATOR = "-"
_DISPLAY_SEPARATOR = " – "


def split_line_name(raw_name: str) -> tuple[str, str]:
    """``"B3-LARDERO-EL CAMPILLO"`` → ``("B3", "Lardero – El Campillo")``."""
    label, _, route = raw_name.partition(_NAME_SEPARATOR)
    termini = [title_es(part) for part in route.split(_NAME_SEPARATOR) if part.strip()]
    return label.strip(), _DISPLAY_SEPARATOR.join(termini)


def normalize_line(raw: RawLine) -> Line:
    label, name = split_line_name(raw.name)
    try:
        colour = parse_colour(raw.colour)
    except ValueError as err:
        raise UpstreamSchemaError(str(err), path=f"line[{raw.id}].color") from None
    return Line(
        id=raw.id,
        label=label or raw.id,
        name=name or raw.name,
        colour=colour,
        text_colour=text_colour_for(colour),
    )


def normalize_patterns(raw: RawLine) -> list[Pattern]:
    patterns = []
    for direction in DIRECTIONS:
        refs = raw.asc if direction == "asc" else raw.desc
        if not refs:
            continue
        patterns.append(
            Pattern(
                id=f"{raw.id}:{direction}",
                line_id=raw.id,
                direction=direction,
                origin=refs[0].name,
                headsign=refs[-1].name,
                stop_ids=tuple(ref.id for ref in refs),
            )
        )
    return patterns


def normalize_stop(raw: RawStop, *, known_lines: set[str]) -> Stop:
    line_ids = sorted(
        (line_id for line_id in dict.fromkeys(raw.line_ids) if line_id in known_lines),
        key=natural_sort_key,
    )
    return Stop(id=raw.id, name=raw.name, lat=raw.lat, lon=raw.lon, line_ids=tuple(line_ids))


def build_catalog(
    raw_lines: list[RawLine], raw_stops: list[RawStop], *, fetched_at: datetime
) -> Catalog:
    lines = sorted(
        (normalize_line(raw) for raw in raw_lines), key=lambda line: natural_sort_key(line.label)
    )
    order = {line.id: index for index, line in enumerate(lines)}
    patterns = sorted(
        (pattern for raw in raw_lines for pattern in normalize_patterns(raw)),
        key=lambda p: (order[p.line_id], DIRECTIONS.index(p.direction)),
    )
    known_lines = set(order)
    stops = sorted(
        (normalize_stop(raw, known_lines=known_lines) for raw in raw_stops),
        key=lambda stop: natural_sort_key(stop.id),
    )
    return Catalog(
        lines=tuple(lines), patterns=tuple(patterns), stops=tuple(stops), fetched_at=fetched_at
    )


def normalize_arrivals(
    raw_arrivals: list[RawArrival],
    *,
    stop_id: str,
    catalog: Catalog,
    resolver: DirectionResolver,
    now: datetime,
) -> StopArrivals:
    """Normalise one stop's arrivals: resolve direction, drop stale entries, sort by time.

    Entries for other stops or for lines the catalogue does not know are discarded: when asked
    for a line that does not serve the stop, the upstream answers with unrelated vehicles.
    """
    serving = set(catalog.stop(stop_id).line_ids)
    arrivals = []
    for raw in raw_arrivals:
        if raw.stop_id != stop_id or raw.line_id not in serving:
            continue
        if raw.expected < now - PAST_ARRIVAL_GRACE:
            continue
        pattern = resolver.resolve(
            line_id=raw.line_id, stop_id=stop_id, order=raw.order, direction_ref=raw.direction_ref
        )
        is_realtime = bool(raw.vehicle_ref) and raw.arrival_status.lower() != SCHEDULED_STATUS
        arrivals.append(
            Arrival(
                stop_id=stop_id,
                line_id=raw.line_id,
                pattern_id=pattern.id if pattern else None,
                direction=pattern.direction if pattern else None,
                headsign=pattern.headsign if pattern else None,
                aimed=raw.aimed,
                expected=raw.expected,
                minutes=minutes_until(raw.expected, now),
                delay_s=raw.delay_s,
                is_realtime=is_realtime,
                is_approximate=raw.inaccurate,
                terminates=pattern.is_terminus(stop_id) if pattern else False,
                cancelled=raw.cancelled,
                vehicle_id=raw.vehicle_ref or None,
            )
        )
    arrivals.sort(key=lambda a: (a.expected, natural_sort_key(catalog.line(a.line_id).label)))
    return StopArrivals(stop_id=stop_id, generated_at=now, arrivals=tuple(arrivals))


def _vehicle_direction(raw: RawVehicle, catalog: Catalog) -> Direction | None:
    named = DIRECTION_NAMES.get(raw.direction_ref.casefold())
    if named is not None or not raw.next_stop_id:
        return named
    serving = [p for p in catalog.patterns_at(raw.next_stop_id) if p.line_id == raw.line_id]
    return serving[0].direction if len(serving) == 1 else None


def normalize_vehicles(
    raw_vehicles: list[RawVehicle], *, line_id: str, catalog: Catalog, now: datetime
) -> LineVehicles:
    """Positions of one line's buses: stale reports dropped, direction resolved, sorted by id."""
    vehicles = []
    for raw in raw_vehicles:
        if raw.line_id != line_id or raw.recorded_at < now - STALE_POSITION:
            continue
        direction = _vehicle_direction(raw, catalog)
        pattern = catalog.pattern(f"{line_id}:{direction}") if direction else None
        vehicles.append(
            Vehicle(
                id=raw.vehicle_ref,
                line_id=line_id,
                direction=direction,
                pattern_id=pattern.id if pattern else None,
                lat=raw.lat,
                lon=raw.lon,
                next_stop_id=raw.next_stop_id or None,
                recorded_at=raw.recorded_at,
                delay_s=raw.delay_s,
            )
        )
    vehicles.sort(key=lambda v: natural_sort_key(v.id))
    return LineVehicles(line_id=line_id, generated_at=now, vehicles=tuple(vehicles))


def normalize_timetable(
    raw_directions: list[RawDirectionTimetable], *, line_id: str, catalog: Catalog, now: datetime
) -> LineTimetable:
    """Today's timetable of a line, one entry per direction the catalogue knows, ``asc`` first.

    Unknown direction names are skipped rather than failing the whole line: the other direction
    is still worth showing.
    """
    directions: list[DirectionTimetable] = []
    for raw in raw_directions:
        direction = DIRECTION_NAMES.get(raw.name.casefold())
        pattern = catalog.pattern(f"{line_id}:{direction}") if direction else None
        if pattern is None:
            continue
        directions.append(
            DirectionTimetable(
                pattern_id=pattern.id,
                direction=pattern.direction,
                origin=pattern.origin,
                headsign=pattern.headsign,
                departures=raw.passes,
                periods=tuple(
                    ServicePeriod(
                        first=frequency.first,
                        last=frequency.last,
                        interval_min=frequency.interval_min,
                        interval_max_min=frequency.interval_max_min or frequency.interval_min,
                    )
                    for frequency in raw.frequencies
                ),
            )
        )
    directions.sort(key=lambda d: DIRECTIONS.index(d.direction))
    return LineTimetable(
        line_id=line_id,
        service_date=now.astimezone(TIMEZONE).date().isoformat(),
        generated_at=now,
        directions=tuple(directions),
    )

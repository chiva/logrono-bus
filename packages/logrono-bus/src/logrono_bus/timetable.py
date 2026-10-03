"""Where a line stands in its day: not started, running (and how often), or finished.

Pure and clock-free like the rest of the domain: ``now`` is passed in. Mirrored by
``web/packages/core/src/timetable.ts`` and checked against the same golden cases.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal

from logrono_bus.models import TIMEZONE, DirectionTimetable

type ServiceState = Literal["antes", "en_servicio", "terminado", "sin_servicio"]
SERVICE_STATES: tuple[ServiceState, ...] = ("antes", "en_servicio", "terminado", "sin_servicio")

MINUTES_PER_HOUR: Final = 60
MINUTES_PER_DAY: Final = 24 * MINUTES_PER_HOUR


@dataclass(frozen=True, slots=True, kw_only=True)
class ServiceStatus:
    state: ServiceState
    """``antes``: today's first bus has not left; ``terminado``: the last one has;
    ``sin_servicio``: no departures today."""
    first: str | None
    last: str | None
    next_departure: str | None
    """Next departure from the line's origin, while there is one today."""
    interval_min: int | None
    """Headway of the period now running (or about to start), while in service."""
    interval_max_min: int | None


def describe_interval(interval_min: int, interval_max_min: int | None = None) -> str:
    """``"cada 30 min"``, or ``"cada 12–15 min"`` when the headway varies."""
    if interval_max_min is None or interval_max_min == interval_min:
        return f"cada {interval_min} min"
    return f"cada {interval_min}–{interval_max_min} min"


def clock_minutes(clock: str) -> int:
    """``"07:05"`` → 425; after-midnight times (``"24:30"``) stay past 1440."""
    hours, minutes = clock.split(":")
    return int(hours) * MINUTES_PER_HOUR + int(minutes)


def _in_order(departures: tuple[str, ...]) -> list[int]:
    """Minutes since midnight, a later day added whenever the list wraps past midnight."""
    result: list[int] = []
    for clock in departures:
        minutes = clock_minutes(clock)
        while result and minutes < result[-1]:
            minutes += MINUTES_PER_DAY
        result.append(minutes)
    return result


def service_status(timetable: DirectionTimetable | None, now: datetime) -> ServiceStatus:
    if timetable is None or not timetable.departures:
        return ServiceStatus(
            state="sin_servicio",
            first=None,
            last=None,
            next_departure=None,
            interval_min=None,
            interval_max_min=None,
        )
    local = now.astimezone(TIMEZONE)
    now_min = local.hour * MINUTES_PER_HOUR + local.minute
    times = _in_order(timetable.departures)
    first, last = timetable.departures[0], timetable.departures[-1]
    if now_min < times[0]:
        state: ServiceState = "antes"
    elif now_min > times[-1]:
        state = "terminado"
    else:
        state = "en_servicio"
    upcoming = [
        clock
        for clock, minutes in zip(timetable.departures, times, strict=True)
        if minutes >= now_min
    ]
    period = (
        next((p for p in timetable.periods if now_min <= clock_minutes(p.last)), None)
        if state == "en_servicio"
        else None
    )
    return ServiceStatus(
        state=state,
        first=first,
        last=last,
        next_departure=upcoming[0] if upcoming else None,
        interval_min=period.interval_min if period else None,
        interval_max_min=period.interval_max_min if period else None,
    )

"""Board selections: which stops, lines and directions a board shows.

A board is stateless: its whole configuration lives in the URL, so it can be bookmarked, shared
as a QR code, or opened on an Echo Show by voice. This module owns the ``p`` parameter (the
selection); presentation parameters (theme, mode…) belong to the web app only.

Format, version 1 (``v=1``)::

    p      = group *( "~" group )
    group  = stop-id [ "-" item *( "." item ) ]     ; no items: every line at the stop
    item   = line-id direction
    direction = "a" / "d" / "x"                     ; asc, desc, any

Example: ``101-2d.5a~100-10x`` → stop 101 lines 2 (desc) and 5 (asc), stop 100 line 10 (any
direction). Only RFC 3986 unreserved characters are used, so the value never needs escaping and is
short enough to type on a touch screen. The TypeScript twin lives in
``web/packages/core/src/selection.ts``; both are checked against ``contracts/fixtures/selection.json``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

from logrono_bus.errors import InvalidSelection
from logrono_bus.models import Arrival, Direction, StopArrivals

SELECTION_VERSION: Final = 1
MAX_STOPS: Final = 12
MAX_LINES_PER_STOP: Final = 24

GROUP_SEPARATOR: Final = "~"
STOP_SEPARATOR: Final = "-"
ITEM_SEPARATOR: Final = "."

_DIRECTION_CODES: Final[dict[str, Direction | None]] = {"a": "asc", "d": "desc", "x": None}
_CODES_BY_DIRECTION: Final[dict[Direction | None, str]] = {
    v: k for k, v in _DIRECTION_CODES.items()
}
_ID = re.compile(r"^[0-9A-Za-z]{1,16}$")
_ITEM = re.compile(r"^(?P<line>[0-9A-Za-z]{1,16}?)(?P<direction>[adx])$")


@dataclass(frozen=True, slots=True)
class LineSelection:
    line_id: str
    direction: Direction | None = None
    """``None`` accepts both directions."""

    def matches(self, arrival: Arrival) -> bool:
        return arrival.line_id == self.line_id and (
            self.direction is None or arrival.direction == self.direction
        )


@dataclass(frozen=True, slots=True)
class StopSelection:
    stop_id: str
    lines: tuple[LineSelection, ...] = ()
    """Empty means every line serving the stop."""

    def matches(self, arrival: Arrival) -> bool:
        return arrival.stop_id == self.stop_id and (
            not self.lines or any(line.matches(arrival) for line in self.lines)
        )

    def filter(self, arrivals: StopArrivals) -> StopArrivals:
        return StopArrivals(
            stop_id=arrivals.stop_id,
            generated_at=arrivals.generated_at,
            arrivals=tuple(a for a in arrivals.arrivals if self.matches(a)),
        )


def parse_selection(value: str) -> tuple[StopSelection, ...]:
    """Parse a ``p`` value. Raises :class:`InvalidSelection` with a Spanish, user-facing message."""
    text = value.strip()
    if not text:
        raise InvalidSelection("La selección está vacía")
    groups = text.split(GROUP_SEPARATOR)
    if len(groups) > MAX_STOPS:
        raise InvalidSelection(f"Como mucho {MAX_STOPS} paradas por panel")
    return tuple(_parse_group(group) for group in groups)


def _parse_group(group: str) -> StopSelection:
    stop_id, separator, items = group.partition(STOP_SEPARATOR)
    if not _ID.match(stop_id):
        raise InvalidSelection(f"Parada no válida: {stop_id!r}")
    if not separator:
        return StopSelection(stop_id=stop_id)
    parts = items.split(ITEM_SEPARATOR)
    if len(parts) > MAX_LINES_PER_STOP:
        raise InvalidSelection(f"Como mucho {MAX_LINES_PER_STOP} líneas por parada")
    return StopSelection(stop_id=stop_id, lines=tuple(_parse_item(stop_id, part) for part in parts))


def _parse_item(stop_id: str, item: str) -> LineSelection:
    match = _ITEM.match(item)
    if not match:
        raise InvalidSelection(f"Línea no válida en la parada {stop_id}: {item!r}")
    return LineSelection(line_id=match["line"], direction=_DIRECTION_CODES[match["direction"]])


def format_selection(stops: tuple[StopSelection, ...] | list[StopSelection]) -> str:
    """Inverse of :func:`parse_selection`."""
    groups = []
    for stop in stops:
        items = ITEM_SEPARATOR.join(
            f"{line.line_id}{_CODES_BY_DIRECTION[line.direction]}" for line in stop.lines
        )
        groups.append(f"{stop.stop_id}{STOP_SEPARATOR}{items}" if items else stop.stop_id)
    return GROUP_SEPARATOR.join(groups)

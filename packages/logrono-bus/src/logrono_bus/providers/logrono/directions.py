"""Which direction (pattern) an upstream arrival belongs to.

The arrivals endpoint identifies direction with an opaque numeric ``directionRef`` (``"320"``,
``"321"``) that appears nowhere in the catalogue, and leaves it empty on timetable fill-ins. What
it does carry is ``order``: the stop's 1-based position along the bus's pattern. Verified against
every catalogue line on 2026-10-03:

* most stops belong to exactly one direction of a line, which settles it;
* the stops shared by both directions (termini, and the loop of line B2) sit at a *different*
  position in each, so ``order`` settles those.

``directionRef`` codes seen on a settled arrival are remembered, so a later arrival with a
missing or inconsistent ``order`` can still be placed. Anything else stays unresolved: the UI
shows "sentido desconocido" rather than risk sending a rider the wrong way.
"""

from __future__ import annotations

from logrono_bus.models import Catalog, Pattern


class DirectionResolver:
    """Resolve arrivals to patterns for one catalogue. Learns ``directionRef`` codes as it goes."""

    def __init__(self, catalog: Catalog) -> None:
        self._catalog = catalog
        self._learned: dict[tuple[str, str], str] = {}

    def resolve(
        self, *, line_id: str, stop_id: str, order: int | None, direction_ref: str
    ) -> Pattern | None:
        candidates = [p for p in self._catalog.patterns_at(stop_id) if p.line_id == line_id]
        settled = self._settle(candidates, stop_id=stop_id, order=order)
        if settled is not None:
            if direction_ref:
                self._learned[(line_id, direction_ref)] = settled.id
            return settled
        if direction_ref and (learned := self._learned.get((line_id, direction_ref))):
            return next((p for p in candidates if p.id == learned), None)
        return None

    @staticmethod
    def _settle(candidates: list[Pattern], *, stop_id: str, order: int | None) -> Pattern | None:
        if len(candidates) == 1:
            return candidates[0]
        if order is None:
            return None
        by_position = [p for p in candidates if p.position(stop_id) == order]
        return by_position[0] if len(by_position) == 1 else None

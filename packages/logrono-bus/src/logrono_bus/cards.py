"""Cards: the unit every front end displays.

A card is one line, in one direction, at one stop, with its next few arrivals; it is painted in the
line's colour. The web board, the ``/board`` endpoint (used by KWGT, HTTP Shortcuts and Home
Assistant ``rest`` sensors) and the Home Assistant entities all group arrivals the same way, so the
grouping lives here, once, and is mirrored by ``web/packages/core/src/cards.ts`` under the shared
golden fixtures.

Rules:

* An explicit selection (``101-2d.10x``) yields one card per selected line, in selection order,
  even when no bus is due (the card then says so). ``x`` means one card for both directions.
* A whole-stop selection (``101``) yields one card per direction served at the stop, in catalogue
  order, skipping directions that *end* at the stop (no one can board them there).
* An arrival whose direction could not be resolved never lands on a directional card. On a
  whole-stop selection it gets a direction-less card of its own; on an explicit selection it is only
  shown by an ``x`` card. Arrivals of a skipped (terminating) direction are dropped.
* Lines the catalogue no longer knows (a stale bookmarked URL) are skipped.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from logrono_bus.board import LineSelection, StopSelection
from logrono_bus.models import Arrival, Catalog, Direction, StopArrivals, natural_sort_key

DEFAULT_ARRIVALS_PER_CARD: Final = 3

type CardOrder = Literal["seleccion", "linea", "llegada"]
CARD_ORDERS: Final[tuple[CardOrder, ...]] = ("seleccion", "linea", "llegada")


@dataclass(frozen=True, slots=True, kw_only=True)
class Card:
    stop_id: str
    stop_name: str
    line_id: str
    line_label: str
    line_name: str
    colour: str
    text_colour: str
    direction: Direction | None
    headsign: str | None
    """Destination of the direction; ``None`` on an any-direction card (each arrival has its own)."""
    arrivals: tuple[Arrival, ...]


def _slots(catalog: Catalog, selection: StopSelection) -> list[LineSelection]:
    if selection.lines:
        return list(selection.lines)
    return [
        LineSelection(line_id=pattern.line_id, direction=pattern.direction)
        for pattern in catalog.patterns_at(selection.stop_id)
        if not pattern.is_terminus(selection.stop_id)
    ]


def build_cards(
    catalog: Catalog,
    selection: StopSelection,
    arrivals: StopArrivals,
    *,
    limit: int = DEFAULT_ARRIVALS_PER_CARD,
) -> list[Card]:
    """Group one stop's arrivals into cards, following the module rules."""
    stop = catalog.stop(selection.stop_id)
    known_lines = {line.id for line in catalog.lines}
    slots = [
        slot for slot in dict.fromkeys(_slots(catalog, selection)) if slot.line_id in known_lines
    ]
    buckets: dict[LineSelection, list[Arrival]] = {slot: [] for slot in slots}

    for arrival in arrivals.arrivals:
        if arrival.stop_id != stop.id:
            continue
        target = next((slot for slot in slots if slot.matches(arrival)), None)
        unresolved = arrival.direction is None
        if target is None and unresolved and not selection.lines and arrival.line_id in known_lines:
            target = LineSelection(line_id=arrival.line_id)
            slots.append(target)
            buckets[target] = []
        if target is not None:
            buckets[target].append(arrival)

    cards = []
    for slot in slots:
        line = catalog.line(slot.line_id)
        pattern = catalog.pattern(f"{slot.line_id}:{slot.direction}") if slot.direction else None
        cards.append(
            Card(
                stop_id=stop.id,
                stop_name=stop.name,
                line_id=line.id,
                line_label=line.label,
                line_name=line.name,
                colour=line.colour,
                text_colour=line.text_colour,
                direction=slot.direction,
                headsign=pattern.headsign if pattern else None,
                arrivals=tuple(buckets[slot][:limit]),
            )
        )
    return cards


def next_arrival(card: Card) -> Arrival | None:
    """The next bus that will actually come (cancelled ones skipped)."""
    return next((a for a in card.arrivals if not a.cancelled), None)


def sort_cards(cards: list[Card] | tuple[Card, ...], order: CardOrder) -> list[Card]:
    """Order a board's cards: as selected, by line number, or soonest bus first.

    ``llegada`` puts cards with nothing due last. The sort is stable, so equal keys keep their
    selection order. Mirrored by ``sortCards`` in ``web/packages/core/src/cards.ts``.
    """
    if order == "linea":
        return sorted(
            cards,
            key=lambda c: (
                natural_sort_key(c.line_label),
                c.headsign or "",
                c.stop_name,
                c.stop_id,
            ),
        )
    if order == "llegada":

        def soonest(card: Card) -> tuple[int, float, tuple[int, int, str]]:
            arrival = next_arrival(card)
            label = natural_sort_key(card.line_label)
            return (0, arrival.expected.timestamp(), label) if arrival else (1, 0.0, label)

        return sorted(cards, key=soonest)
    return list(cards)

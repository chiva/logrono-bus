"""The provider contract.

A provider adapts one upstream data source to the domain model. Only one exists today (the
Ayuntamiento's Logroño Bus backend), but the bus concession is re-tendered in 2027 and the data
source may change with it; consumers depend on this protocol, never on a concrete provider.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol, runtime_checkable

from logrono_bus.models import Catalog, LineTimetable, LineVehicles, StopArrivals


@runtime_checkable
class TransitProvider(Protocol):
    @property
    def id(self) -> str:
        """Short stable identifier, e.g. ``"logrono"``."""
        ...

    async def get_catalog(self, *, force_refresh: bool = False) -> Catalog:
        """Lines, directions and stops. Implementations cache it; it changes a few times a year."""
        ...

    async def get_arrivals(
        self, stop_id: str, *, horizon_min: int = 60, now: datetime | None = None
    ) -> StopArrivals:
        """Upcoming arrivals of every line serving ``stop_id``, soonest first.

        Raises :class:`~logrono_bus.errors.StopNotFound` for an unknown stop.
        """
        ...

    async def get_vehicles(self, line_id: str, *, now: datetime | None = None) -> LineVehicles:
        """Last reported positions of a line's buses (stale ones dropped).

        Raises :class:`~logrono_bus.errors.LineNotFound` for an unknown line.
        """
        ...

    async def get_timetable(self, line_id: str, *, now: datetime | None = None) -> LineTimetable:
        """Today's departures and headways of a line, per direction (cached per day).

        Raises :class:`~logrono_bus.errors.LineNotFound` for an unknown line.
        """
        ...

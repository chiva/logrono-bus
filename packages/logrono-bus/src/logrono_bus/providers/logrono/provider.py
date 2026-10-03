"""Provider for the Ayuntamiento de Logroño's urban bus backend."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final

import aiohttp

from logrono_bus.errors import UpstreamError
from logrono_bus.models import TIMEZONE, Catalog, LineTimetable, LineVehicles, StopArrivals
from logrono_bus.providers.logrono.client import LogronoBusClient
from logrono_bus.providers.logrono.directions import DirectionResolver
from logrono_bus.providers.logrono.normalize import (
    build_catalog,
    normalize_arrivals,
    normalize_timetable,
    normalize_vehicles,
)

_LOGGER = logging.getLogger(__name__)

PROVIDER_ID: Final = "logrono"
DEFAULT_CATALOG_TTL: Final = timedelta(hours=6)
DEFAULT_HORIZON_MIN: Final = 60


def _utcnow() -> datetime:
    return datetime.now(UTC)


class LogronoBusProvider:
    """Caches the catalogue (lines and stops change a few times a year) and serves arrivals.

    One instance per process: the catalogue refresh is single-flight, so concurrent callers share
    one upstream round trip.
    """

    def __init__(
        self,
        session: aiohttp.ClientSession,
        *,
        client: LogronoBusClient | None = None,
        catalog_ttl: timedelta = DEFAULT_CATALOG_TTL,
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._client = client or LogronoBusClient(session)
        self._catalog_ttl = catalog_ttl
        self._clock = clock
        self._state: _CatalogState | None = None
        self._catalog_lock = asyncio.Lock()
        self._timetables: dict[str, LineTimetable] = {}
        self._timetable_lock = asyncio.Lock()

    @property
    def id(self) -> str:
        return PROVIDER_ID

    async def get_catalog(self, *, force_refresh: bool = False) -> Catalog:
        return (await self._load(force_refresh=force_refresh)).catalog

    async def get_arrivals(
        self, stop_id: str, *, horizon_min: int = DEFAULT_HORIZON_MIN, now: datetime | None = None
    ) -> StopArrivals:
        state = await self._load(force_refresh=False)
        stop = state.catalog.stop(stop_id)
        if not stop.line_ids:
            return StopArrivals(stop_id=stop.id, generated_at=now or self._clock(), arrivals=())
        raw = await self._client.arrivals(
            stop.id, line_ids=stop.line_ids, preview_minutes=horizon_min
        )
        return normalize_arrivals(
            raw,
            stop_id=stop.id,
            catalog=state.catalog,
            resolver=state.resolver,
            now=now or self._clock(),
        )

    async def get_vehicles(self, line_id: str, *, now: datetime | None = None) -> LineVehicles:
        """Where the line's buses are now. Raises LineNotFound for an unknown line."""
        state = await self._load(force_refresh=False)
        line = state.catalog.line(line_id)
        raw = await self._client.vehicles(line.id)
        return normalize_vehicles(
            raw, line_id=line.id, catalog=state.catalog, now=now or self._clock()
        )

    async def get_timetable(self, line_id: str, *, now: datetime | None = None) -> LineTimetable:
        """Today's timetable of a line. Raises LineNotFound for an unknown line.

        The upstream publishes one timetable per day, so each line is fetched at most once per
        local date and process; concurrent callers share that request.
        """
        state = await self._load(force_refresh=False)
        line = state.catalog.line(line_id)
        at = now or self._clock()
        today = at.astimezone(TIMEZONE).date().isoformat()
        cached = self._timetables.get(line.id)
        if cached is not None and cached.service_date == today:
            return cached
        async with self._timetable_lock:
            cached = self._timetables.get(line.id)
            if cached is not None and cached.service_date == today:
                return cached
            raw = await self._client.timetable(line.id)
            timetable = normalize_timetable(raw, line_id=line.id, catalog=state.catalog, now=at)
            self._timetables[line.id] = timetable
            return timetable

    async def _load(self, *, force_refresh: bool) -> _CatalogState:
        if not force_refresh and (state := self._fresh_state()):
            return state
        async with self._catalog_lock:
            if not force_refresh and (state := self._fresh_state()):
                return state
            failure: BaseException | None = None
            try:
                async with asyncio.TaskGroup() as group:
                    lines = group.create_task(self._client.lines())
                    stops = group.create_task(self._client.stops())
            except* UpstreamError as errors:
                failure = errors.exceptions[0]
            if failure is not None:
                # The network changes a few times a year: an expired catalogue beats no answer.
                if self._state is not None and not force_refresh:
                    _LOGGER.warning(
                        "Catálogo no renovado, se sigue usando el anterior: %s", failure
                    )
                    return self._state
                # Surface the library's own error type, not an ExceptionGroup, so callers can
                # keep catching UpstreamUnavailable / UpstreamSchemaError as documented.
                raise failure from None
            catalog = build_catalog(lines.result(), stops.result(), fetched_at=self._clock())
            self._state = _CatalogState(catalog=catalog, resolver=DirectionResolver(catalog))
            return self._state

    def _fresh_state(self) -> _CatalogState | None:
        state = self._state
        if state is None or self._clock() - state.catalog.fetched_at >= self._catalog_ttl:
            return None
        return state


@dataclass(frozen=True, slots=True)
class _CatalogState:
    """A catalogue and the direction resolver learning against it, replaced together."""

    catalog: Catalog
    resolver: DirectionResolver

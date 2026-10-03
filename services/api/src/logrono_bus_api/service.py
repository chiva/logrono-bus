"""Application layer: everything the HTTP routes need, with no HTTP in it.

Routes stay thin (parse, call, serialise); the policies — what is cached, how the upstream is
protected, how a board is assembled — live here and are tested without a web server.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

import aiohttp

from logrono_bus import (
    Card,
    Catalog,
    LineTimetable,
    LineVehicles,
    LogronoBusClient,
    LogronoBusProvider,
    StopArrivals,
    StopSelection,
    build_cards,
    sort_cards,
)
from logrono_bus.cards import CardOrder
from logrono_bus.errors import RateLimited, UpstreamError
from logrono_bus_api.cache import CacheResult, SingleFlightCache
from logrono_bus_api.metrics import Metrics
from logrono_bus_api.settings import Settings
from logrono_bus_api.upstream_guard import (
    CircuitBreaker,
    CircuitOpen,
    CircuitState,
    TokenBucket,
    UpstreamGuard,
)

_LOGGER = logging.getLogger(__name__)


class GuardedClient(LogronoBusClient):
    """Every real upstream request passes through the guard and is counted."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        *,
        guard: UpstreamGuard,
        metrics: Metrics,
        base_url: str,
        timeout_s: float,
    ) -> None:
        super().__init__(session, base_url=base_url, timeout_s=timeout_s)
        self._guard = guard
        self._metrics = metrics

    async def get_json(self, endpoint: str, params: Mapping[str, str] | None = None) -> object:
        label = endpoint.split("/", 1)[0]
        fetch = super().get_json
        try:
            result = await self._guard.call(lambda: fetch(endpoint, params))
        except CircuitOpen:
            self._metrics.upstream_requests.labels(label, "circuit_open").inc()
            raise
        except RateLimited:
            self._metrics.upstream_requests.labels(label, "rate_limited").inc()
            raise
        except UpstreamError:
            self._metrics.upstream_requests.labels(label, "error").inc()
            raise
        finally:
            self._metrics.circuit_open.set(int(self._guard.breaker.state is CircuitState.OPEN))
        self._metrics.upstream_requests.labels(label, "ok").inc()
        return result


@dataclass(frozen=True, slots=True, kw_only=True)
class Board:
    generated_at: datetime
    """When the oldest data on the board was fetched from the upstream."""
    stale: bool
    """At least one stop is being served from cache because the upstream is failing."""
    cards: tuple[Card, ...]


class TransitService:
    def __init__(
        self,
        *,
        provider: LogronoBusProvider,
        guard: UpstreamGuard,
        settings: Settings,
        metrics: Metrics,
    ) -> None:
        self._provider = provider
        self._guard = guard
        self._metrics = metrics
        self._arrivals: SingleFlightCache[str, StopArrivals] = SingleFlightCache(
            ttl_s=settings.arrivals_ttl_s,
            stale_s=settings.arrivals_stale_s,
            on_stale=self._log_stale,
        )
        # Positions go stale fast: no stale-if-error window, an old position would mislead.
        self._vehicles: SingleFlightCache[str, LineVehicles] = SingleFlightCache(
            ttl_s=settings.vehicles_ttl_s, stale_s=0
        )

    @classmethod
    def create(
        cls, session: aiohttp.ClientSession, *, settings: Settings, metrics: Metrics
    ) -> TransitService:
        guard = UpstreamGuard(
            bucket=TokenBucket(
                rate_per_s=settings.upstream_rate_per_s, burst=settings.upstream_burst
            ),
            breaker=CircuitBreaker(
                failures=settings.breaker_failures, reset_s=settings.breaker_reset_s
            ),
        )
        client = GuardedClient(
            session,
            guard=guard,
            metrics=metrics,
            base_url=str(settings.upstream_url),
            timeout_s=settings.upstream_timeout_s,
        )
        provider = LogronoBusProvider(
            session,
            client=client,
            catalog_ttl=timedelta(hours=settings.catalog_ttl_h),
        )
        return cls(provider=provider, guard=guard, settings=settings, metrics=metrics)

    async def catalog(self) -> Catalog:
        return await self._provider.get_catalog()

    async def arrivals(self, stop_id: str) -> CacheResult[StopArrivals]:
        """All arrivals at a stop (every line), cached per stop and shared by every client."""
        stop = (await self.catalog()).stop(stop_id)
        result = await self._arrivals.get(stop.id, lambda: self._provider.get_arrivals(stop.id))
        self._metrics.cache_results.labels(result.outcome.value).inc()
        return result

    async def vehicles(self, line_id: str) -> CacheResult[LineVehicles]:
        """Bus positions of a line, cached per line and shared by every client."""
        line = (await self.catalog()).line(line_id)
        return await self._vehicles.get(line.id, lambda: self._provider.get_vehicles(line.id))

    async def timetable(self, line_id: str) -> LineTimetable:
        """Today's timetable of a line; the provider fetches each line once per local day."""
        line = (await self.catalog()).line(line_id)
        return await self._provider.get_timetable(line.id)

    async def board(
        self, selections: Sequence[StopSelection], *, limit: int, order: CardOrder = "seleccion"
    ) -> Board:
        catalog = await self.catalog()
        for selection in selections:
            catalog.stop(selection.stop_id)
        results = await asyncio.gather(*(self.arrivals(s.stop_id) for s in selections))
        cards = [
            card
            for selection, result in zip(selections, results, strict=True)
            for card in build_cards(catalog, selection, result.value, limit=limit)
        ]
        return Board(
            generated_at=min(result.value.generated_at for result in results),
            stale=any(result.stale for result in results),
            cards=tuple(sort_cards(cards, order)),
        )

    @property
    def circuit_state(self) -> CircuitState:
        return self._guard.breaker.state

    @staticmethod
    def _log_stale(stop_id: str, error: BaseException) -> None:
        _LOGGER.warning("Llegadas de la parada %s servidas desde caché: %s", stop_id, error)

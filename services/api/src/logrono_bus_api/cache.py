"""In-memory TTL cache with single-flight loading and stale-if-error.

Many screens showing the same stop (a kitchen tablet, an Echo Show, three phones) must cost the
upstream one request per TTL, not one per screen:

* **fresh** entries are returned as they are;
* **single flight**: concurrent misses for one key share a single loader call;
* **stale-if-error**: when a refresh fails, an entry younger than ``stale_s`` is served instead
  of the error, flagged as stale so the caller can tell.

The service runs one worker, so per-process memory is the right scope; nothing here is shared
across processes.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable, Hashable
from dataclasses import dataclass
from enum import StrEnum


class CacheOutcome(StrEnum):
    MISS = "miss"
    """Loaded from the upstream for this request (or for a concurrent one)."""
    HIT = "hit"
    STALE = "stale"
    """Served because a refresh failed; the failure is in the log and metrics."""


@dataclass(frozen=True, slots=True)
class CacheResult[V]:
    value: V
    age_s: float
    outcome: CacheOutcome

    @property
    def stale(self) -> bool:
        return self.outcome is CacheOutcome.STALE


@dataclass(frozen=True, slots=True)
class _Entry[V]:
    value: V
    stored_at: float


class SingleFlightCache[K: Hashable, V]:
    def __init__(
        self,
        *,
        ttl_s: float,
        stale_s: float,
        clock: Callable[[], float] = time.monotonic,
        on_stale: Callable[[K, BaseException], None] | None = None,
    ) -> None:
        self._ttl_s = ttl_s
        self._stale_s = stale_s
        self._clock = clock
        self._on_stale = on_stale
        self._entries: dict[K, _Entry[V]] = {}
        self._inflight: dict[K, asyncio.Task[V]] = {}

    async def get(self, key: K, loader: Callable[[], Awaitable[V]]) -> CacheResult[V]:
        entry = self._entries.get(key)
        if entry is not None and self._age(entry) < self._ttl_s:
            return CacheResult(value=entry.value, age_s=self._age(entry), outcome=CacheOutcome.HIT)

        task = self._inflight.get(key)
        if task is None:
            task = asyncio.ensure_future(self._load(key, loader))
            self._inflight[key] = task
            task.add_done_callback(lambda done: self._forget(key, done))
        try:
            # shield: one caller giving up (client disconnect) must not cancel the shared load.
            value = await asyncio.shield(task)
        except Exception as error:
            entry = self._entries.get(key)
            if entry is None or self._age(entry) > self._ttl_s + self._stale_s:
                raise
            if self._on_stale is not None:
                self._on_stale(key, error)
            return CacheResult(
                value=entry.value, age_s=self._age(entry), outcome=CacheOutcome.STALE
            )
        return CacheResult(value=value, age_s=0.0, outcome=CacheOutcome.MISS)

    async def _load(self, key: K, loader: Callable[[], Awaitable[V]]) -> V:
        value = await loader()
        self._entries[key] = _Entry(value=value, stored_at=self._clock())
        return value

    def _forget(self, key: K, task: asyncio.Task[V]) -> None:
        self._inflight.pop(key, None)
        if not task.cancelled():
            # Mark the outcome as retrieved even if every awaiter went away first, so asyncio does
            # not log "exception was never retrieved"; awaiters still receive it via the shield.
            task.exception()

    def _age(self, entry: _Entry[V]) -> float:
        return max(0.0, self._clock() - entry.stored_at)

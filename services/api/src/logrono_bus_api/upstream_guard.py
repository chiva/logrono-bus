"""Protection for the upstream: a token bucket and a circuit breaker around every call.

The upstream is a public municipal service this project does not own. However many people point
their screens at one instance of this service, it never sends more than ``rate_per_s`` requests
per second; and when the upstream is down it stops knocking for ``reset_s`` seconds instead of
piling up timeouts (cached data keeps being served meanwhile, see :mod:`.cache`).
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from enum import StrEnum

from logrono_bus.errors import UpstreamError, UpstreamUnavailable


class TokenBucket:
    """Waits (rather than fails) until a token is available; callers are paced, not rejected."""

    def __init__(
        self, *, rate_per_s: float, burst: int, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._rate = rate_per_s
        self._capacity = float(burst)
        self._tokens = float(burst)
        self._clock = clock
        self._updated = clock()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = self._clock()
                self._tokens = min(
                    self._capacity, self._tokens + (now - self._updated) * self._rate
                )
                self._updated = now
                if self._tokens >= 1:
                    self._tokens -= 1
                    return
                await asyncio.sleep((1 - self._tokens) / self._rate)


class CircuitState(StrEnum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitOpen(UpstreamUnavailable):
    """Raised without calling the upstream while the breaker is open."""

    def __init__(self, retry_after: float) -> None:
        super().__init__(f"origen en pausa tras fallos repetidos; reintento en {retry_after:.0f} s")
        self.retry_after = retry_after


class CircuitBreaker:
    """Opens after ``failures`` consecutive upstream errors; lets exactly one probe through after
    ``reset_s`` (concurrent callers are turned away until it ends); closes again on the first
    success."""

    def __init__(
        self, *, failures: int, reset_s: float, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._threshold = failures
        self._reset_s = reset_s
        self._clock = clock
        self._consecutive_failures = 0
        self._opened_at: float | None = None
        self._probing = False

    @property
    def state(self) -> CircuitState:
        if self._opened_at is None:
            return CircuitState.CLOSED
        if self._clock() - self._opened_at >= self._reset_s:
            return CircuitState.HALF_OPEN
        return CircuitState.OPEN

    def before_call(self) -> bool:
        """Raise CircuitOpen, or admit the call; True when it is the half-open probe, which the
        caller must end with ``probe_finished`` whatever happens."""
        state = self.state
        if state is CircuitState.CLOSED:
            return False
        assert self._opened_at is not None
        if state is CircuitState.OPEN or self._probing:
            retry_after = max(0.0, self._reset_s - (self._clock() - self._opened_at))
            raise CircuitOpen(retry_after=retry_after)
        self._probing = True
        return True

    def probe_finished(self) -> None:
        self._probing = False

    def record_success(self) -> None:
        self._consecutive_failures = 0
        self._opened_at = None

    def record_failure(self) -> None:
        self._consecutive_failures += 1
        if self.state is CircuitState.HALF_OPEN or self._consecutive_failures >= self._threshold:
            self._opened_at = self._clock()


class UpstreamGuard:
    def __init__(self, *, bucket: TokenBucket, breaker: CircuitBreaker) -> None:
        self.bucket = bucket
        self.breaker = breaker

    async def call[T](self, operation: Callable[[], Awaitable[T]]) -> T:
        probe = self.breaker.before_call()
        try:
            await self.bucket.acquire()
            # The breaker may have opened while this call waited for its token.
            probe = probe or self.breaker.before_call()
            try:
                result = await operation()
            except UpstreamError:
                self.breaker.record_failure()
                raise
        finally:
            if probe:
                self.breaker.probe_finished()
        self.breaker.record_success()
        return result

"""Thin HTTP client for the Logroño Bus backend (``transporteurbano.logrono.es/api``).

It only moves bytes and maps transport failures onto the library's error types; parsing lives in
:mod:`.raw` and meaning in :mod:`.normalize`. The ``aiohttp.ClientSession`` is always injected and
never closed here: Home Assistant shares one session per instance, and the service owns its own.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from http import HTTPStatus
from typing import Final

import aiohttp

from logrono_bus._version import __version__
from logrono_bus.errors import RateLimited, UpstreamSchemaError, UpstreamUnavailable
from logrono_bus.providers.logrono.raw import (
    RawArrival,
    RawDirectionTimetable,
    RawLine,
    RawStop,
    RawVehicle,
    parse_arrivals,
    parse_lines,
    parse_stops,
    parse_timetable,
    parse_vehicles,
)

DEFAULT_BASE_URL: Final = "https://transporteurbano.logrono.es/api/"
DEFAULT_TIMEOUT_S: Final = 10.0
DEFAULT_USER_AGENT: Final = f"logrono-bus/{__version__} (+https://github.com/chiva/logrono-bus)"

ENDPOINT_LINES: Final = "linesDiscovery/lines"
ENDPOINT_STOPS: Final = "linesDiscovery/stops"
ENDPOINT_ARRIVALS: Final = "estimatedTimetable/byStop/{stop_id}"
ENDPOINT_VEHICLES: Final = "vehicleMonitoring/byLine/{line_id}"
ENDPOINT_TIMETABLE: Final = "productionTimetable/byLine/{line_id}"


class LogronoBusClient:
    def __init__(
        self,
        session: aiohttp.ClientSession,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        user_agent: str = DEFAULT_USER_AGENT,
    ) -> None:
        self._session = session
        self._base_url = base_url if base_url.endswith("/") else f"{base_url}/"
        self._timeout = aiohttp.ClientTimeout(total=timeout_s)
        self._headers = {"User-Agent": user_agent, "Accept": "application/json"}

    async def lines(self) -> list[RawLine]:
        return parse_lines(await self.get_json(ENDPOINT_LINES))

    async def stops(self) -> list[RawStop]:
        return parse_stops(await self.get_json(ENDPOINT_STOPS))

    async def arrivals(
        self, stop_id: str, *, line_ids: Iterable[str], preview_minutes: int
    ) -> list[RawArrival]:
        """Arrivals at ``stop_id``. ``line_ids`` must not be empty: without it the upstream
        always answers with an empty list."""
        lines = ",".join(line_ids)
        if not lines:
            raise ValueError("line_ids no puede estar vacío")
        payload = await self.get_json(
            ENDPOINT_ARRIVALS.format(stop_id=stop_id),
            params={"lines": lines, "previewMinutes": str(preview_minutes)},
        )
        return parse_arrivals(payload)

    async def vehicles(self, line_id: str) -> list[RawVehicle]:
        """Last reported position of every bus of a line."""
        return parse_vehicles(await self.get_json(ENDPOINT_VEHICLES.format(line_id=line_id)))

    async def timetable(self, line_id: str) -> list[RawDirectionTimetable]:
        """Today's departures and headways of a line, per direction."""
        return parse_timetable(await self.get_json(ENDPOINT_TIMETABLE.format(line_id=line_id)))

    async def get_json(self, endpoint: str, params: Mapping[str, str] | None = None) -> object:
        """GET an endpoint and return its decoded JSON, unparsed (used to record fixtures)."""
        url = f"{self._base_url}{endpoint}"
        try:
            async with self._session.get(
                url, params=params, headers=self._headers, timeout=self._timeout
            ) as response:
                if response.status == HTTPStatus.TOO_MANY_REQUESTS:
                    raise RateLimited(
                        f"{endpoint}: demasiadas peticiones",
                        retry_after=_retry_after(response.headers.get("Retry-After")),
                    )
                if response.status >= HTTPStatus.INTERNAL_SERVER_ERROR:
                    raise UpstreamUnavailable(f"{endpoint}: HTTP {response.status}")
                if response.status != HTTPStatus.OK:
                    raise UpstreamSchemaError(f"HTTP {response.status} inesperado", path=endpoint)
                try:
                    return await response.json(content_type=None)
                except ValueError as err:
                    raise UpstreamSchemaError(f"JSON no válido: {err}", path=endpoint) from None
        except (aiohttp.ClientError, TimeoutError) as err:
            raise UpstreamUnavailable(f"{endpoint}: {type(err).__name__}: {err}") from err


def _retry_after(header: str | None) -> float | None:
    if header is None:
        return None
    try:
        return max(0.0, float(header))
    except ValueError:
        return None

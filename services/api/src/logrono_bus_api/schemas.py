"""Response shapes that are not library models, plus the JSON response helper.

Route handlers return library dataclasses serialised by :func:`logrono_bus.to_json` rather than
by FastAPI/pydantic: that keeps the wire format byte-for-byte identical to the golden fixtures the
TypeScript client is tested against (pydantic would, for instance, write UTC as ``Z`` instead of
``+00:00``). The ``response_model`` declared on each route still documents the shape in OpenAPI,
from which the TypeScript types are generated.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal

from fastapi.responses import JSONResponse

from logrono_bus import Line, Pattern, Stop, to_json
from logrono_bus_api.upstream_guard import CircuitState

API_VERSION: Final = 1
"""Bumped on any incompatible change to /api/v1 shapes; clients compare it in /api/v1/health."""


@dataclass(frozen=True, slots=True, kw_only=True)
class LineDetail:
    line: Line
    patterns: tuple[Pattern, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class StopDetail:
    stop: Stop
    patterns: tuple[Pattern, ...]
    """Every direction of every line serving the stop."""


@dataclass(frozen=True, slots=True, kw_only=True)
class UpstreamHealth:
    circuit: CircuitState
    catalog_fetched_at: datetime | None


@dataclass(frozen=True, slots=True, kw_only=True)
class Health:
    status: Literal["ok", "degraded"]
    version: str
    library_version: str
    api_version: int
    upstream: UpstreamHealth


@dataclass(frozen=True, slots=True, kw_only=True)
class Problem:
    """RFC 9457 error body (``application/problem+json``). Branch on ``type``."""

    type: str
    title: str
    status: int
    instance: str
    detail: str | None = None
    request_id: str | None = None


def _problem(description: str) -> dict[str, object]:
    return {"model": Problem, "description": description}


PROBLEM_RESPONSES: Final[dict[int | str, dict[str, object]]] = {
    400: _problem("Selección no válida"),
    404: _problem("Parada o línea inexistente"),
    422: _problem("Parámetros no válidos"),
    502: _problem("El servicio del Ayuntamiento ha cambiado de formato"),
    503: _problem("El servicio del Ayuntamiento no responde (ver `Retry-After`)"),
}


def model_response(
    value: object, *, status_code: int = 200, headers: Mapping[str, str] | None = None
) -> JSONResponse:
    return JSONResponse(to_json(value), status_code=status_code, headers=dict(headers or {}))

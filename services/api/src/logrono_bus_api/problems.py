"""Errors as RFC 9457 ``application/problem+json``, with Spanish, user-facing titles.

Each problem type has a stable URI that resolves to its explanation in the guide (docs/guia/errores.md); clients branch on
``type``, never on the human-readable ``title``/``detail``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from http import HTTPStatus
from typing import Final

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from logrono_bus.errors import (
    InvalidSelection,
    LineNotFound,
    RateLimited,
    StopNotFound,
    UpstreamSchemaError,
    UpstreamUnavailable,
)
from logrono_bus_api.logs import request_id_var
from logrono_bus_api.upstream_guard import CircuitOpen

PROBLEM_CONTENT_TYPE: Final = "application/problem+json"
PROBLEM_BASE_URI: Final = "https://chiva.github.io/logrono-bus/guia/errores/#"

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ProblemType:
    slug: str
    status: HTTPStatus
    title: str


STOP_NOT_FOUND: Final = ProblemType(
    "parada-no-encontrada", HTTPStatus.NOT_FOUND, "Parada no encontrada"
)
LINE_NOT_FOUND: Final = ProblemType(
    "linea-no-encontrada", HTTPStatus.NOT_FOUND, "Línea no encontrada"
)
INVALID_SELECTION: Final = ProblemType(
    "seleccion-no-valida", HTTPStatus.BAD_REQUEST, "Selección de paradas no válida"
)
INVALID_REQUEST: Final = ProblemType(
    "peticion-no-valida", HTTPStatus.UNPROCESSABLE_ENTITY, "Petición no válida"
)
UPSTREAM_UNAVAILABLE: Final = ProblemType(
    "origen-no-disponible",
    HTTPStatus.SERVICE_UNAVAILABLE,
    "El servicio de autobuses del Ayuntamiento no responde",
)
UPSTREAM_CHANGED: Final = ProblemType(
    "origen-cambiado",
    HTTPStatus.BAD_GATEWAY,
    "El servicio de autobuses del Ayuntamiento ha cambiado y este proyecto necesita actualizarse",
)
INTERNAL_ERROR: Final = ProblemType(
    "error-interno", HTTPStatus.INTERNAL_SERVER_ERROR, "Error interno"
)


def problem_response(
    problem: ProblemType,
    request: Request,
    *,
    detail: str | None = None,
    retry_after: float | None = None,
    extra: dict[str, object] | None = None,
) -> JSONResponse:
    body: dict[str, object] = {
        "type": f"{PROBLEM_BASE_URI}{problem.slug}",
        "title": problem.title,
        "status": int(problem.status),
        "instance": request.url.path,
    }
    if detail:
        body["detail"] = detail
    if request_id := request_id_var.get():
        body["request_id"] = request_id
    body |= extra or {}
    headers = {"Retry-After": str(max(1, round(retry_after)))} if retry_after is not None else None
    return JSONResponse(
        body, status_code=problem.status, media_type=PROBLEM_CONTENT_TYPE, headers=headers
    )


def install_problem_handlers(app: FastAPI) -> None:
    @app.exception_handler(StopNotFound)
    async def _stop(request: Request, error: StopNotFound) -> JSONResponse:
        return problem_response(STOP_NOT_FOUND, request, detail=str(error))

    @app.exception_handler(LineNotFound)
    async def _line(request: Request, error: LineNotFound) -> JSONResponse:
        return problem_response(LINE_NOT_FOUND, request, detail=str(error))

    @app.exception_handler(InvalidSelection)
    async def _selection(request: Request, error: InvalidSelection) -> JSONResponse:
        return problem_response(INVALID_SELECTION, request, detail=str(error))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, error: RequestValidationError) -> JSONResponse:
        errors = [
            {"loc": [str(part) for part in item["loc"]], "msg": item["msg"]}
            for item in error.errors()
        ]
        return problem_response(INVALID_REQUEST, request, extra={"errors": errors})

    @app.exception_handler(UpstreamUnavailable)
    async def _unavailable(request: Request, error: UpstreamUnavailable) -> JSONResponse:
        _LOGGER.warning("Origen no disponible: %s", error)
        retry_after = error.retry_after if isinstance(error, CircuitOpen | RateLimited) else None
        return problem_response(
            UPSTREAM_UNAVAILABLE, request, detail=str(error), retry_after=retry_after or 30
        )

    @app.exception_handler(UpstreamSchemaError)
    async def _schema(request: Request, error: UpstreamSchemaError) -> JSONResponse:
        _LOGGER.error("El origen respondió con un formato inesperado: %s", error)
        return problem_response(UPSTREAM_CHANGED, request, detail=str(error))

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, error: Exception) -> JSONResponse:
        _LOGGER.exception("Error no controlado en %s", request.url.path)
        return problem_response(INTERNAL_ERROR, request)

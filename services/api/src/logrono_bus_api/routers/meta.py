"""Operational endpoints: liveness, readiness, health and metrics."""

from __future__ import annotations

import logging
from http import HTTPStatus

from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from logrono_bus import __version__ as library_version
from logrono_bus.errors import LogronoBusError
from logrono_bus_api import __version__
from logrono_bus_api.dependencies import MetricsDep, ServiceDep
from logrono_bus_api.schemas import API_VERSION, Health, UpstreamHealth, model_response
from logrono_bus_api.upstream_guard import CircuitState

_LOGGER = logging.getLogger(__name__)

ops_router = APIRouter(tags=["operación"], include_in_schema=False)
api_router = APIRouter(tags=["operación"])


@ops_router.get("/livez")
async def livez() -> dict[str, str]:
    """The process is up. Never touches the upstream."""
    return {"status": "ok"}


@ops_router.get("/readyz")
async def readyz(service: ServiceDep) -> JSONResponse:
    """Ready once a catalogue is available (fetched now or earlier); used by the healthcheck."""
    try:
        await service.catalog()
    except LogronoBusError as error:
        _LOGGER.warning("No preparado: %s", error)
        return JSONResponse(
            {"status": "unavailable", "detail": str(error)},
            status_code=HTTPStatus.SERVICE_UNAVAILABLE,
        )
    return JSONResponse({"status": "ok"})


@ops_router.get("/metrics")
async def metrics(registry: MetricsDep) -> Response:
    return Response(generate_latest(registry.registry), media_type=CONTENT_TYPE_LATEST)


@api_router.get("/health", response_model=Health, summary="Estado del servicio")
async def health(service: ServiceDep) -> JSONResponse:
    """Versión, versión de la API y estado del origen. La web lo usa para detectar el servidor."""
    circuit = service.circuit_state
    try:
        fetched_at = (await service.catalog()).fetched_at
    except LogronoBusError:
        fetched_at = None
    degraded = fetched_at is None or circuit is not CircuitState.CLOSED
    return model_response(
        Health(
            status="degraded" if degraded else "ok",
            version=__version__,
            library_version=library_version,
            api_version=API_VERSION,
            upstream=UpstreamHealth(circuit=circuit, catalog_fetched_at=fetched_at),
        )
    )

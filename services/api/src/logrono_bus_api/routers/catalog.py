"""Static network data: lines, directions and stops."""

from __future__ import annotations

from typing import Annotated, Final

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from logrono_bus import Catalog, Line, NearbyStop, Stop
from logrono_bus_api.dependencies import ServiceDep
from logrono_bus_api.schemas import LineDetail, StopDetail, model_response

CATALOG_CACHE_CONTROL: Final = "public, max-age=3600"
MAX_SEARCH_RESULTS: Final = 50
MAX_RADIUS_M: Final = 5_000

router = APIRouter(tags=["catálogo"])


@router.get("/catalog", response_model=Catalog, summary="Catálogo completo")
async def get_catalog(service: ServiceDep) -> JSONResponse:
    """Líneas, sentidos y paradas en una sola respuesta: lo que la web carga al arrancar."""
    return model_response(await service.catalog(), headers={"Cache-Control": CATALOG_CACHE_CONTROL})


@router.get("/lines", response_model=list[Line], summary="Líneas")
async def list_lines(service: ServiceDep) -> JSONResponse:
    return model_response((await service.catalog()).lines)


@router.get("/lines/{line_id}", response_model=LineDetail, summary="Una línea y sus sentidos")
async def get_line(line_id: str, service: ServiceDep) -> JSONResponse:
    catalog = await service.catalog()
    line = catalog.line(line_id)
    return model_response(LineDetail(line=line, patterns=catalog.patterns_for_line(line.id)))


@router.get("/stops", response_model=list[Stop], summary="Buscar paradas")
async def list_stops(
    service: ServiceDep,
    q: Annotated[
        str | None, Query(description="Nombre o número; sin acentos ni mayúsculas")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_SEARCH_RESULTS)] = 20,
) -> JSONResponse:
    catalog = await service.catalog()
    stops = catalog.search(q, limit=limit) if q else list(catalog.stops)
    return model_response(stops)


@router.get("/stops/nearby", response_model=list[NearbyStop], summary="Paradas cercanas")
async def nearby_stops(
    service: ServiceDep,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    radius_m: Annotated[float, Query(gt=0, le=MAX_RADIUS_M)] = 500,
    limit: Annotated[int, Query(ge=1, le=MAX_SEARCH_RESULTS)] = 10,
) -> JSONResponse:
    catalog = await service.catalog()
    return model_response(catalog.nearby(lat, lon, radius_m=radius_m, limit=limit))


@router.get("/stops/{stop_id}", response_model=StopDetail, summary="Una parada y sus sentidos")
async def get_stop(stop_id: str, service: ServiceDep) -> JSONResponse:
    catalog = await service.catalog()
    stop = catalog.stop(stop_id)
    return model_response(StopDetail(stop=stop, patterns=catalog.patterns_at(stop.id)))

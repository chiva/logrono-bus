"""Real-time data: arrivals at a stop, and whole boards for widgets."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Final

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from logrono_bus import LineTimetable, LineVehicles, StopArrivals, StopSelection, parse_selection
from logrono_bus.board import STOP_SEPARATOR
from logrono_bus.cards import DEFAULT_ARRIVALS_PER_CARD, Card, CardOrder
from logrono_bus.models import TIMEZONE, Arrival, minutes_until
from logrono_bus_api.cache import CacheResult
from logrono_bus_api.dependencies import ServiceDep, SettingsDep
from logrono_bus_api.schemas import model_response
from logrono_bus_api.service import Board
from logrono_bus_api.settings import Settings

MAX_ARRIVALS_PER_CARD: Final = 10
CACHE_HEADER: Final = "X-Cache"

router = APIRouter(tags=["llegadas"])


class BoardFormat(StrEnum):
    JSON = "json"
    TEXT = "text"


class TimeStyle(StrEnum):
    """How the text board writes each arrival."""

    MINUTES = "minutos"
    CLOCK = "hora"


CLOCK_FORMAT: Final = "%H:%M"


def _cache_headers(result: CacheResult[StopArrivals], settings: Settings) -> dict[str, str]:
    max_age = max(0, round(settings.arrivals_ttl_s - result.age_s))
    return {
        "Age": str(round(result.age_s)),
        "Cache-Control": f"public, max-age={max_age}",
        CACHE_HEADER: result.outcome.value,
    }


@router.get(
    "/stops/{stop_id}/arrivals",
    response_model=StopArrivals,
    summary="Próximas llegadas a una parada",
)
async def stop_arrivals(
    stop_id: str,
    service: ServiceDep,
    settings: SettingsDep,
    lines: Annotated[
        str | None,
        Query(
            description="Filtro de líneas y sentidos, p. ej. `2d.5a` (a=ida, d=vuelta, x=ambos)",
            examples=["2d.5a"],
        ),
    ] = None,
) -> JSONResponse:
    """Llegadas de todas las líneas de la parada, de la más próxima a la más lejana.

    Los datos se comparten entre todos los clientes y se renuevan como mucho cada
    `LOGRONO_BUS_ARRIVALS_TTL_S` segundos; la cabecera `X-Cache` dice si vienen de caché.
    """
    selection = (
        parse_selection(f"{stop_id}{STOP_SEPARATOR}{lines}")[0]
        if lines
        else StopSelection(stop_id=stop_id)
    )
    result = await service.arrivals(selection.stop_id)
    return model_response(selection.filter(result.value), headers=_cache_headers(result, settings))


@router.get(
    "/lines/{line_id}/vehicles",
    response_model=LineVehicles,
    summary="Dónde están los autobuses de una línea",
)
async def line_vehicles(line_id: str, service: ServiceDep, settings: SettingsDep) -> JSONResponse:
    """Última posición conocida de cada autobús de la línea, con su sentido y la parada a la que
    se dirige. Las posiciones de más de 3 minutos se descartan."""
    result = await service.vehicles(line_id)
    max_age = max(0, round(settings.vehicles_ttl_s - result.age_s))
    return model_response(
        result.value,
        headers={"Cache-Control": f"public, max-age={max_age}", CACHE_HEADER: result.outcome.value},
    )


@router.get(
    "/lines/{line_id}/timetable",
    response_model=LineTimetable,
    summary="Horario de hoy de una línea",
)
async def line_timetable(line_id: str, service: ServiceDep, settings: SettingsDep) -> JSONResponse:
    """Salidas de hoy desde la cabecera de cada sentido y la frecuencia por franjas. Son las horas
    de salida del primer punto de la línea, no las de paso por cada parada."""
    timetable = await service.timetable(line_id)
    return model_response(
        timetable, headers={"Cache-Control": f"public, max-age={settings.timetable_max_age_s}"}
    )


def board_as_text(board: Board, *, now: datetime, style: TimeStyle = TimeStyle.MINUTES) -> str:
    """One line per card, for KWGT/HTTP Shortcuts widgets.

    Minutes are counted from ``now``; clock times (local, Europe/Madrid) stay true however late a
    widget refreshes, so they suit widgets that Android refreshes when it sees fit.
    """
    return "\n".join(_card_line(card, now, style) for card in board.cards) + "\n"


def _card_line(card: Card, now: datetime, style: TimeStyle) -> str:
    towards = f" → {card.headsign}" if card.headsign else ""
    upcoming = [a for a in card.arrivals if not a.cancelled]
    return f"{card.line_label}{towards} · {card.stop_name}: {_times(upcoming, now, style)}"


def _times(upcoming: list[Arrival], now: datetime, style: TimeStyle) -> str:
    if not upcoming:
        return "sin llegadas"
    if style is TimeStyle.CLOCK:
        return ", ".join(a.expected.astimezone(TIMEZONE).strftime(CLOCK_FORMAT) for a in upcoming)
    return ", ".join(str(minutes_until(a.expected, now)) for a in upcoming) + " min"


@router.get(
    "/board",
    response_model=Board,
    summary="Panel: tarjetas de varias paradas",
    responses={200: {"content": {"text/plain": {}}}},
)
async def board(
    service: ServiceDep,
    p: Annotated[
        str,
        Query(
            description="Selección del panel (como en la URL de la web), p. ej. `101-2d.5a~100-2a`",
            examples=["101-2d.5a~100-2a"],
        ),
    ],
    limit: Annotated[int, Query(ge=0, le=MAX_ARRIVALS_PER_CARD)] = DEFAULT_ARRIVALS_PER_CARD,
    format: Annotated[BoardFormat, Query(description="`text` para widgets de texto")] = (
        BoardFormat.JSON
    ),
    orden: Annotated[
        CardOrder,
        Query(
            description="`seleccion` (como en `p`), `linea` (por número) o `llegada` (la primera)"
        ),
    ] = "seleccion",
    tiempo: Annotated[
        TimeStyle,
        Query(
            description="Con `format=text`: `minutos` (4, 12 min) o `hora` (18:04, 18:12), "
            "que sigue siendo cierta aunque el widget tarde en refrescarse"
        ),
    ] = TimeStyle.MINUTES,
) -> Response:
    """Lo mismo que muestra la web: una tarjeta por línea y sentido, con sus próximas llegadas."""
    result = await service.board(parse_selection(p), limit=limit, order=orden)
    headers = {CACHE_HEADER: "stale" if result.stale else "fresh"}
    if format is BoardFormat.TEXT:
        text = board_as_text(result, now=datetime.now(UTC), style=tiempo)
        return PlainTextResponse(text, headers=headers)
    return model_response(result, headers=headers)

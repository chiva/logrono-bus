"""Estimaciones de paso de los autobuses urbanos de Logroño.

Typical use::

    async with aiohttp.ClientSession() as session:
        provider = LogronoBusProvider(session)
        arrivals = await provider.get_arrivals("101")
        for arrival in arrivals.arrivals:
            print(arrival.line_id, arrival.headsign, arrival.minutes)

Proyecto no oficial: los datos proceden del servicio web público del Ayuntamiento de Logroño.
"""

from logrono_bus._version import __version__
from logrono_bus.board import (
    LineSelection,
    StopSelection,
    format_selection,
    parse_selection,
)
from logrono_bus.cards import (
    CARD_ORDERS,
    DEFAULT_ARRIVALS_PER_CARD,
    Card,
    CardOrder,
    build_cards,
    sort_cards,
)
from logrono_bus.errors import (
    InvalidSelection,
    LineNotFound,
    LogronoBusError,
    NotFoundError,
    RateLimited,
    StopNotFound,
    UpstreamError,
    UpstreamSchemaError,
    UpstreamUnavailable,
)
from logrono_bus.models import (
    DIRECTIONS,
    TIMEZONE,
    Arrival,
    Catalog,
    Direction,
    DirectionTimetable,
    Line,
    LineTimetable,
    LineVehicles,
    NearbyStop,
    Pattern,
    ServicePeriod,
    Stop,
    StopArrivals,
    Vehicle,
    minutes_until,
)
from logrono_bus.providers.base import TransitProvider
from logrono_bus.providers.logrono import LogronoBusClient, LogronoBusProvider
from logrono_bus.serialize import to_json
from logrono_bus.timetable import SERVICE_STATES, ServiceState, ServiceStatus, service_status

__all__ = [
    "CARD_ORDERS",
    "DEFAULT_ARRIVALS_PER_CARD",
    "DIRECTIONS",
    "SERVICE_STATES",
    "TIMEZONE",
    "Arrival",
    "Card",
    "CardOrder",
    "Catalog",
    "Direction",
    "DirectionTimetable",
    "InvalidSelection",
    "Line",
    "LineNotFound",
    "LineSelection",
    "LineTimetable",
    "LineVehicles",
    "LogronoBusClient",
    "LogronoBusError",
    "LogronoBusProvider",
    "NearbyStop",
    "NotFoundError",
    "Pattern",
    "RateLimited",
    "ServicePeriod",
    "ServiceState",
    "ServiceStatus",
    "Stop",
    "StopArrivals",
    "StopNotFound",
    "StopSelection",
    "TransitProvider",
    "UpstreamError",
    "UpstreamSchemaError",
    "UpstreamUnavailable",
    "Vehicle",
    "__version__",
    "build_cards",
    "format_selection",
    "minutes_until",
    "parse_selection",
    "service_status",
    "sort_cards",
    "to_json",
]

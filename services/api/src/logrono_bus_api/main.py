"""Application factory.

``create_app`` wires settings, logging, the upstream session and the routers; it builds a fresh,
independent app each time (own metrics registry, own caches), which is what the tests rely on.
``logrono-bus-api`` (see :mod:`.__main__`) builds one from the environment and serves it.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Final

import aiohttp
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from fastapi.staticfiles import StaticFiles

from logrono_bus_api import __version__
from logrono_bus_api.logs import REQUEST_ID_HEADER, configure_logging, request_id_var
from logrono_bus_api.metrics import Metrics
from logrono_bus_api.problems import install_problem_handlers
from logrono_bus_api.routers import arrivals, catalog, meta
from logrono_bus_api.schemas import PROBLEM_RESPONSES
from logrono_bus_api.service import TransitService
from logrono_bus_api.settings import Settings

API_PREFIX: Final = "/api/v1"
UNMATCHED_ROUTE: Final = "unmatched"
_MAX_REQUEST_ID_LENGTH: Final = 64

_LOGGER = logging.getLogger(__name__)

DESCRIPTION: Final = """
Estimaciones de paso de los autobuses urbanos de Logroño, normalizadas y con caché compartida.

**Proyecto no oficial.** Los datos proceden del servicio web público del Ayuntamiento de Logroño;
este servicio solo los reorganiza y limita la frecuencia de consulta.
"""


def _route_label(request: Request) -> str:
    route = request.scope.get("route")
    return route.path if isinstance(route, APIRoute) else UNMATCHED_ROUTE


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging(level=settings.log_level, log_format=settings.log_format)
    metrics = Metrics()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with aiohttp.ClientSession() as session:
            app.state.service = TransitService.create(session, settings=settings, metrics=metrics)
            _LOGGER.info(
                "logrono-bus-api %s escuchando; origen %s", __version__, settings.upstream_url
            )
            yield

    app = FastAPI(
        title="Logroño Bus API",
        version=__version__,
        description=DESCRIPTION,
        root_path=settings.root_path,
        lifespan=lifespan,
        license_info={"name": "MIT", "identifier": "MIT"},
    )
    app.state.settings = settings
    app.state.metrics = metrics

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET"],
        expose_headers=[REQUEST_ID_HEADER, "Age", arrivals.CACHE_HEADER],
    )

    @app.middleware("http")
    async def observe(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = (
            incoming[:_MAX_REQUEST_ID_LENGTH]
            if incoming.isprintable() and incoming
            else uuid.uuid4().hex
        )
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        route = _route_label(request)
        metrics.http_latency.labels(route).observe(time.perf_counter() - started)
        metrics.http_requests.labels(route, request.method, str(response.status_code)).inc()
        response.headers[REQUEST_ID_HEADER] = request_id
        return response

    install_problem_handlers(app)
    app.include_router(meta.ops_router)
    for router in (meta.api_router, catalog.router, arrivals.router):
        app.include_router(router, prefix=API_PREFIX, responses=PROBLEM_RESPONSES)
    if settings.web_dir is not None:
        # Mounted last so every API route wins; html=True serves index.html for "/".
        app.mount("/", StaticFiles(directory=settings.web_dir, html=True), name="web")
    return app

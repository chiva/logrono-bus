"""Prometheus metrics, exposed at ``/metrics``.

A dedicated registry (not the process-global default) keeps metrics per application instance, so
tests can build several apps without "duplicated timeseries" errors.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram


@dataclass
class Metrics:
    registry: CollectorRegistry = field(default_factory=CollectorRegistry)

    def __post_init__(self) -> None:
        self.http_requests = Counter(
            "logrono_bus_http_requests",
            "Peticiones HTTP atendidas",
            ["route", "method", "status"],
            registry=self.registry,
        )
        self.http_latency = Histogram(
            "logrono_bus_http_request_seconds",
            "Duración de las peticiones HTTP",
            ["route"],
            registry=self.registry,
        )
        self.upstream_requests = Counter(
            "logrono_bus_upstream_requests",
            "Peticiones al servicio de origen",
            ["endpoint", "outcome"],
            registry=self.registry,
        )
        self.cache_results = Counter(
            "logrono_bus_cache_results",
            "Resultados de la caché de llegadas",
            ["result"],
            registry=self.registry,
        )
        self.circuit_open = Gauge(
            "logrono_bus_upstream_circuit_open",
            "1 mientras el cortacircuitos del origen está abierto",
            registry=self.registry,
        )

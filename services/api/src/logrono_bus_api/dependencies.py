"""FastAPI dependencies: access to the objects the lifespan created."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from logrono_bus_api.metrics import Metrics
from logrono_bus_api.service import TransitService
from logrono_bus_api.settings import Settings


def get_service(request: Request) -> TransitService:
    service: TransitService = request.app.state.service
    return service


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_metrics(request: Request) -> Metrics:
    metrics: Metrics = request.app.state.metrics
    return metrics


ServiceDep = Annotated[TransitService, Depends(get_service)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
MetricsDep = Annotated[Metrics, Depends(get_metrics)]

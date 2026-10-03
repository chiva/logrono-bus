"""Configuration from environment variables (prefix ``LOGRONO_BUS_``) or a ``.env`` file.

Invalid values stop the service at start-up with a message naming the variable, instead of
surfacing later as a confusing runtime error.
"""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Annotated, Final

from pydantic import Field, HttpUrl, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from logrono_bus.providers.logrono.client import DEFAULT_BASE_URL

ENV_PREFIX: Final = "LOGRONO_BUS_"


class LogFormat(StrEnum):
    JSON = "json"
    TEXT = "text"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix=ENV_PREFIX, env_file=".env", extra="ignore")

    host: str = "0.0.0.0"
    """Every interface: inside a container the published port decides what is reachable."""
    port: int = Field(default=8000, ge=1, le=65535)
    root_path: str = Field(default="", description="Prefijo si se sirve tras un proxy, p. ej. /bus")

    upstream_url: HttpUrl = HttpUrl(DEFAULT_BASE_URL)
    upstream_timeout_s: float = Field(default=10.0, gt=0, le=60)
    upstream_rate_per_s: float = Field(default=2.0, gt=0, le=20)
    """Sustained request rate allowed towards the upstream, shared by every client of this service."""
    upstream_burst: int = Field(default=4, ge=1, le=50)
    breaker_failures: int = Field(default=5, ge=1, le=100)
    breaker_reset_s: float = Field(default=30.0, gt=0, le=3600)

    catalog_ttl_h: float = Field(default=6.0, gt=0, le=168)
    arrivals_ttl_s: float = Field(default=15.0, ge=1, le=300)
    arrivals_stale_s: float = Field(default=120.0, ge=0, le=3600)
    """How long cached arrivals may still be served when the upstream is failing."""
    vehicles_ttl_s: float = Field(default=10.0, ge=1, le=300)
    """How long a line's bus positions are shared (the official site refreshes every 10 s)."""
    timetable_max_age_s: int = Field(default=3600, ge=60, le=86400)
    """``Cache-Control`` of timetables: browsers may keep one this long (the server keeps it for
    the whole local day)."""

    cors_origins: Annotated[list[str], NoDecode] = ["*"]
    web_dir: Path | None = Field(
        default=None, description="Carpeta con la web compilada (web/apps/pwa/dist) a servir en /"
    )

    log_level: str = "INFO"
    log_format: LogFormat = LogFormat.JSON

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("log_level")
    @classmethod
    def _known_level(cls, value: str) -> str:
        level = value.upper()
        if level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError(f"nivel de log desconocido: {value!r}")
        return level

    @field_validator("root_path")
    @classmethod
    def _normalise_root(cls, value: str) -> str:
        stripped = value.strip().rstrip("/")
        if stripped and not stripped.startswith("/"):
            raise ValueError("root_path debe empezar por '/'")
        return stripped

    @field_validator("web_dir")
    @classmethod
    def _web_dir_exists(cls, value: Path | None) -> Path | None:
        if value is not None and not (value / "index.html").is_file():
            raise ValueError(f"{value} no contiene index.html (¿has compilado la web?)")
        return value

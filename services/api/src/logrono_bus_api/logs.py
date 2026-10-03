"""Logging: one JSON object per line (or plain text for local development), with request ids.

Every log record emitted while serving a request carries that request's id, which is also returned
to the client in ``X-Request-ID``: a user reporting a problem can quote it and the matching log
lines are one search away.
"""

from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Final

from logrono_bus_api.settings import LogFormat

REQUEST_ID_HEADER: Final = "X-Request-ID"
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_TEXT_FORMAT: Final = "%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] %(message)s"


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get() or "-"
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        document: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", "-")
        if request_id != "-":
            document["request_id"] = request_id
        if record.exc_info:
            document["exception"] = self.formatException(record.exc_info)
        return json.dumps(document, ensure_ascii=False)


def configure_logging(*, level: str, log_format: LogFormat) -> None:
    handler = logging.StreamHandler()
    handler.addFilter(_RequestIdFilter())
    handler.setFormatter(
        JsonFormatter() if log_format is LogFormat.JSON else logging.Formatter(_TEXT_FORMAT)
    )
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # uvicorn installs its own handlers; route its records through ours for one consistent format.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True

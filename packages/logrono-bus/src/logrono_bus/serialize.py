"""Canonical JSON form of the domain model.

This is the wire format of the HTTP service and of the golden fixtures shared with the TypeScript
normaliser, so it is deliberately boring: field names as declared, datetimes as ISO 8601 with the
upstream's UTC offset preserved, tuples as arrays.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Mapping
from datetime import datetime

type JSONValue = bool | int | float | str | list[JSONValue] | dict[str, JSONValue] | None


def to_json(value: object) -> JSONValue:
    """Convert a model instance (or any nesting of them) into JSON-compatible values."""
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {
            field.name: to_json(getattr(value, field.name)) for field in dataclasses.fields(value)
        }
    if isinstance(value, Mapping):
        return {str(key): to_json(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [to_json(item) for item in value]
    raise TypeError(f"No se puede serializar {type(value).__name__}")

"""Exception hierarchy.

Every error the library raises derives from :class:`LogronoBusError`, so a consumer can catch the
whole family at once, while the subclasses let it react precisely: retry later on
:class:`UpstreamUnavailable`, raise a repair issue on :class:`UpstreamSchemaError`, ask the user to
pick another stop on :class:`StopNotFound`.
"""

from __future__ import annotations


class LogronoBusError(Exception):
    """Base class for every error raised by ``logrono_bus``."""


class UpstreamError(LogronoBusError):
    """The upstream API could not provide a usable answer."""


class UpstreamUnavailable(UpstreamError):
    """Network failure, timeout or 5xx: transient, worth retrying later."""


class RateLimited(UpstreamUnavailable):
    """The upstream answered 429. ``retry_after`` is in seconds when the server sent it."""

    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class UpstreamSchemaError(UpstreamError):
    """The upstream answered, but not in the shape this library understands.

    This is the signal that the (undocumented) API changed: retrying will not help.
    """

    def __init__(self, message: str, *, path: str) -> None:
        super().__init__(f"{path}: {message}")
        self.path = path


class NotFoundError(LogronoBusError, LookupError):
    """A requested catalogue entity does not exist."""


class StopNotFound(NotFoundError):
    def __init__(self, stop_id: str) -> None:
        super().__init__(f"La parada {stop_id!r} no existe")
        self.stop_id = stop_id


class LineNotFound(NotFoundError):
    def __init__(self, line_id: str) -> None:
        super().__init__(f"La línea {line_id!r} no existe")
        self.line_id = line_id


class InvalidSelection(LogronoBusError, ValueError):
    """A board selection string (the ``p`` URL parameter) is malformed."""

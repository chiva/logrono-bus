"""Line colours: parsing upstream colour strings and picking a readable text colour.

The upstream publishes only a background colour per line (as ``rgba(r,g,b,a)``), never a text
colour, and several lines are light (2 is pure yellow, 7 light grey). The text colour is chosen by
WCAG 2.x contrast ratio so a card painted in the line colour is always legible.
"""

from __future__ import annotations

import re

BLACK = "#000000"
WHITE = "#FFFFFF"

_RGBA = re.compile(
    r"^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$", re.IGNORECASE
)
_HEX = re.compile(r"^#?([0-9a-f]{6})$", re.IGNORECASE)

_SRGB_LINEAR_THRESHOLD = 0.04045
_LUMINANCE_WEIGHTS = (0.2126, 0.7152, 0.0722)
_CONTRAST_OFFSET = 0.05


def parse_colour(value: str) -> str:
    """Return ``value`` as an upper-case ``#RRGGBB`` string.

    Accepts ``rgb()``/``rgba()`` (alpha is ignored: cards are opaque) and 6-digit hex with or
    without ``#``. Raises :class:`ValueError` for anything else.
    """
    text = value.strip()
    if match := _HEX.match(text):
        return f"#{match.group(1).upper()}"
    if match := _RGBA.match(text):
        channels = [int(group) for group in match.groups()]
        if any(channel > 255 for channel in channels):
            raise ValueError(f"Canal de color fuera de rango: {value!r}")
        return "#" + "".join(f"{channel:02X}" for channel in channels)
    raise ValueError(f"Color no reconocido: {value!r}")


def relative_luminance(hex_colour: str) -> float:
    """WCAG 2.x relative luminance of an ``#RRGGBB`` colour, in ``[0, 1]``."""
    rgb = parse_colour(hex_colour)
    channels = (int(rgb[i : i + 2], 16) / 255 for i in (1, 3, 5))
    linear = (
        c / 12.92 if c <= _SRGB_LINEAR_THRESHOLD else ((c + 0.055) / 1.055) ** 2.4 for c in channels
    )
    return sum(w * c for w, c in zip(_LUMINANCE_WEIGHTS, linear, strict=True))


def contrast_ratio(first: str, second: str) -> float:
    """WCAG contrast ratio between two colours, from 1 (identical) to 21 (black on white)."""
    lighter, darker = sorted((relative_luminance(first), relative_luminance(second)), reverse=True)
    return (lighter + _CONTRAST_OFFSET) / (darker + _CONTRAST_OFFSET)


def text_colour_for(background: str) -> str:
    """Black or white, whichever contrasts more with ``background``."""
    return (
        BLACK if contrast_ratio(background, BLACK) >= contrast_ratio(background, WHITE) else WHITE
    )

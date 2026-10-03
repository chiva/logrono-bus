"""Spanish text helpers: accent-insensitive search keys and title-casing upstream names."""

from __future__ import annotations

import unicodedata

# Articles, prepositions and conjunctions stay lower-case inside a Spanish title
# ("Palacio de Congresos", "Plaza de la Iglesia"), except as the first word ("El Arco").
_LOWERCASE_PARTICLES = frozenset({"a", "de", "del", "el", "en", "la", "las", "los", "y"})


def fold(text: str) -> str:
    """Search key: case- and accent-insensitive (``"Glorieta Dr. ZUBÍA"`` → ``"glorieta dr. zubia"``)."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(stripped.casefold().split())


def title_es(text: str) -> str:
    """Title-case an upper-case upstream name the way Spanish signage writes it."""
    words = text.strip().lower().split()
    return " ".join(
        word if index and word in _LOWERCASE_PARTICLES else word[:1].upper() + word[1:]
        for index, word in enumerate(words)
    )

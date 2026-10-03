"""Direction resolution: the riskiest inference in the project, so every strategy is pinned."""

from __future__ import annotations

from logrono_bus.models import Catalog
from logrono_bus.providers.logrono.directions import DirectionResolver


def _resolve(
    resolver: DirectionResolver, line: str, stop: str, order: int | None, ref: str = ""
) -> str | None:
    pattern = resolver.resolve(line_id=line, stop_id=stop, order=order, direction_ref=ref)
    return pattern.id if pattern else None


def test_stop_served_in_one_direction_settles_regardless_of_order(catalog: Catalog) -> None:
    resolver = DirectionResolver(catalog)
    assert _resolve(resolver, "2", "101", 9) == "2:desc"
    assert _resolve(resolver, "2", "101", None) == "2:desc"
    assert _resolve(resolver, "2", "100", 14) == "2:asc"


def test_terminus_shared_by_both_directions_uses_order(catalog: Catalog) -> None:
    resolver = DirectionResolver(catalog)
    # Stop 5 (Artesanos) is the last stop of 2:asc (position 23) and the first of 2:desc.
    assert _resolve(resolver, "2", "5", 23) == "2:asc"
    assert _resolve(resolver, "2", "5", 1) == "2:desc"


def test_ambiguous_without_order_or_learned_ref_stays_unresolved(catalog: Catalog) -> None:
    resolver = DirectionResolver(catalog)
    assert _resolve(resolver, "2", "5", None) is None
    assert _resolve(resolver, "2", "5", 7) is None
    assert _resolve(resolver, "2", "5", None, "320") is None


def test_direction_ref_is_learned_from_settled_arrivals(catalog: Catalog) -> None:
    resolver = DirectionResolver(catalog)
    assert _resolve(resolver, "2", "5", 23, "320") == "2:asc"
    assert _resolve(resolver, "2", "5", None, "320") == "2:asc"
    # Learning is per line: line 10 does not inherit line 2's code.
    assert _resolve(resolver, "10", "5", None, "320") is None


def test_direction_ref_learned_at_one_stop_applies_at_another(catalog: Catalog) -> None:
    resolver = DirectionResolver(catalog)
    assert _resolve(resolver, "2", "101", 9, "321") == "2:desc"
    assert _resolve(resolver, "2", "5", None, "321") == "2:desc"


def test_line_not_serving_stop_is_unresolved(catalog: Catalog) -> None:
    resolver = DirectionResolver(catalog)
    assert _resolve(resolver, "1", "101", 3, "402") is None

"""Plausibility checks for bus positions, shared by the live contract and the recorded fixtures."""

from __future__ import annotations

from logrono_bus.models import Catalog, LineVehicles

# Logroño and its outskirts: a position outside means coordinates were swapped or rescaled.
LOGRONO_LAT = (42.40, 42.50)
LOGRONO_LON = (-2.55, -2.35)


def assert_positions_plausible(catalog: Catalog, result: LineVehicles) -> int:
    """Every bus is in Logroño and heads to a stop on the pattern of its direction.

    A next stop off that pattern means the Ida/Vuelta mapping (ADR 0008) has flipped. Returns how
    many buses had both a direction and a next stop, so callers can tell a vacuous pass.
    """
    checked = 0
    for vehicle in result.vehicles:
        assert vehicle.line_id == result.line_id
        assert LOGRONO_LAT[0] < vehicle.lat < LOGRONO_LAT[1], vehicle
        assert LOGRONO_LON[0] < vehicle.lon < LOGRONO_LON[1], vehicle
        if vehicle.pattern_id is not None and vehicle.next_stop_id is not None:
            pattern = catalog.pattern(vehicle.pattern_id)
            assert vehicle.next_stop_id in pattern.stop_ids, (
                f"bus {vehicle.id} heads to {vehicle.next_stop_id}, not on {pattern.id}"
            )
            checked += 1
    return checked

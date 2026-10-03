"""Live contract against the real upstream. Opt-in (``just test-live``) and run daily in CI.

Kept to a handful of requests: the upstream is a public service we do not own.
"""

from __future__ import annotations

import aiohttp
import pytest
from positions import assert_positions_plausible

from logrono_bus import TIMEZONE, LogronoBusProvider
from logrono_bus.timetable import clock_minutes

pytestmark = pytest.mark.live

AYUNTAMIENTO_STOPS = ("101", "100")
# Line whose bus positions feed the route view; any line works, 2 runs from early to late.
ROUTE_LINE = "2"
# Scheduled arrival at a line's first stop vs. its published departure.
DEPARTURE_TOLERANCE_MIN = 2


async def test_live_catalogue_and_ayuntamiento_arrivals() -> None:
    async with aiohttp.ClientSession() as session:
        provider = LogronoBusProvider(session)
        catalog = await provider.get_catalog()
        assert len(catalog.stops) > 100
        assert {"1", "2", "5", "10"} <= {line.id for line in catalog.lines}

        for stop_id in AYUNTAMIENTO_STOPS:
            stop = catalog.stop(stop_id)
            assert stop.name == "Ayuntamiento"
            assert {"2", "5", "7", "10"} <= set(stop.line_ids)
            result = await provider.get_arrivals(stop_id)
            for arrival in result.arrivals:
                assert arrival.stop_id == stop_id
                assert arrival.line_id in stop.line_ids
                assert arrival.minutes >= 0
            resolved = [a for a in result.arrivals if a.pattern_id is not None]
            assert len(resolved) == len(result.arrivals), "direction resolution regressed"


async def test_live_bus_positions() -> None:
    """The route view's data: positions in Logroño, heading to stops on their direction's pattern."""
    async with aiohttp.ClientSession() as session:
        provider = LogronoBusProvider(session)
        catalog = await provider.get_catalog()
        result = await provider.get_vehicles(ROUTE_LINE)
        checked = assert_positions_plausible(catalog, result)
        print(f"{len(result.vehicles)} buses on line {ROUTE_LINE}, {checked} with a next stop")


async def test_live_timetable_lists_departures_from_the_first_stop() -> None:
    """The timetable is read as departures from each direction's first stop (ADR 0009).

    Checked against the arrivals the upstream predicts at that stop: each one must be within a
    couple of minutes of a published departure. Outside service hours there is nothing to check.
    """
    async with aiohttp.ClientSession() as session:
        provider = LogronoBusProvider(session)
        catalog = await provider.get_catalog()
        timetable = await provider.get_timetable(ROUTE_LINE)
        assert timetable.directions, f"line {ROUTE_LINE} published no timetable today"
        direction = timetable.directions[0]
        pattern = catalog.pattern(direction.pattern_id)
        assert pattern is not None
        departures = [clock_minutes(clock) for clock in direction.departures]
        arrivals = await provider.get_arrivals(pattern.stop_ids[0])
        at_origin = [a for a in arrivals.arrivals if a.pattern_id == pattern.id]
        print(f"{len(at_origin)} arrivals at {pattern.origin} for {pattern.id}")
        for arrival in at_origin:
            local = arrival.aimed.astimezone(TIMEZONE)
            minutes = local.hour * 60 + local.minute
            gap = min(abs(minutes - departure) for departure in departures)
            assert gap <= DEPARTURE_TOLERANCE_MIN, (
                f"{local:%H:%M} at {pattern.origin} is {gap} min from any published departure"
            )

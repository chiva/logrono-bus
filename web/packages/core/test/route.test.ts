import { describe, expect, it } from 'vitest';

import {
  DWELL_RADIUS_M,
  DirectionResolver,
  type LineVehicles,
  MAX_HELD_BACKSTEP_STOPS,
  type RouteView,
  buildRoute,
  normalizeArrivals,
  normalizeVehicles,
  parseArrivals,
  parseVehicles,
} from '../src/index.ts';
import { fixtureCatalog, loadFixture } from './fixtures.ts';

/** When vehicles-*.json and arrivals-*-noche.json were recorded together. */
const NOW = '2026-10-03T20:30:36+00:00';
const catalog = fixtureCatalog();

const vehicles = (line: string, fixture = `upstream/vehicles-${line}.json`): LineVehicles =>
  normalizeVehicles(parseVehicles(loadFixture(fixture)), line, catalog, NOW);

const arrivals = (stop: string) =>
  normalizeArrivals(
    parseArrivals(loadFixture(`upstream/arrivals-${stop}-noche.json`)),
    stop,
    catalog,
    new DirectionResolver(catalog),
    NOW,
  );

describe('route view', () => {
  it('shows the stops before yours and the buses coming, nearest first with their minutes', () => {
    // Line 10 towards Manuel de Falla at Ayuntamiento (101, 14th stop of 10:desc).
    const route = buildRoute(catalog, '10:desc', '101', vehicles('10'), arrivals('101'))!;
    expect(route.stops.map((s) => s.position)).toEqual([10, 11, 12, 13, 14]);
    expect(route.stops.at(-1)?.name).toBe('Ayuntamiento');
    // Neither end of the line is among the stops shown.
    expect(route.stops.map((s) => s.terminus)).toEqual([false, false, false, false, false]);
    expect(route.hiddenStops).toBe(9);
    expect(route.stopsAfter).toBe(catalog.pattern('10:desc')!.stop_ids.length - 14);
    expect(route.stopsAfter).toBeGreaterThan(0);
    expect(route.headsign).toBe('Manuel de Falla');
    // Bus 946 is heading to stop 12 (two before yours); 1200 already passed; 2315 waits at the
    // first stop, beyond the stops shown; 2109 and 7290 go the other way.
    expect(route.buses).toHaveLength(1);
    const [bus] = route.buses;
    expect(bus?.vehicleId).toBe('946');
    expect(bus?.stopsAway).toBe(2);
    expect(bus?.at).toBeGreaterThanOrEqual(1);
    expect(bus?.at).toBeLessThanOrEqual(2);
    expect(bus?.minutes).toBe(2);
    // The one further back keeps its place in the queue, and its minutes.
    expect(route.earlierBuses.map((b) => [b.vehicleId, b.at, b.stopsAway, b.minutes])).toEqual([
      ['2315', -9, 13, 17],
    ]);
  });

  it('honours the number of previous stops asked for', () => {
    const route = (previousStops: number) =>
      buildRoute(catalog, '10:desc', '101', vehicles('10'), arrivals('101'), { previousStops })!;
    expect(route(1).stops.map((s) => s.position)).toEqual([13, 14]);
    // Bus 946 (between stops 11 and 12) is now behind the first stop shown.
    expect(route(1).buses).toEqual([]);
    expect(route(1).earlierBuses.map((b) => b.vehicleId)).toEqual(['946', '2315']);
    expect(route(0).stops.map((s) => s.position)).toEqual([14]);
  });

  it('shows the whole line when it is short enough, including a bus waiting at the start', () => {
    const route = buildRoute(catalog, '10:desc', '101', vehicles('10'), arrivals('101'), {
      previousStops: 19,
    })!;
    expect(route.stops[0]?.position).toBe(1);
    expect(route.hiddenStops).toBe(0);
    // The first stop of the line is drawn as a terminus; yours, further on, is not.
    expect(route.stops.filter((s) => s.terminus).map((s) => s.position)).toEqual([1]);
    expect(route.buses.map((b) => [b.vehicleId, b.minutes])).toEqual([
      ['946', 2],
      ['2315', 17],
    ]);
    expect(route.buses[1]?.at).toBe(0);
    expect(route.earlierBuses).toEqual([]);
  });

  it('knows when your stop is the last one of the line', () => {
    const terminus = catalog.pattern('10:desc')!.stop_ids.at(-1)!;
    const route = buildRoute(catalog, '10:desc', terminus, vehicles('10'), null)!;
    expect(route.stopsAfter).toBe(0);
    expect(route.stops.at(-1)?.id).toBe(terminus);
    expect(route.stops.at(-1)?.terminus).toBe(true);
    expect(route.stops.slice(0, -1).some((s) => s.terminus)).toBe(false);
  });

  it('works without arrivals (no minutes) and rejects stops off the pattern', () => {
    const route = buildRoute(catalog, '2:asc', '100', vehicles('2'), null, { previousStops: 13 })!;
    expect(route.buses.map((b) => [b.vehicleId, b.stopsAway, b.minutes])).toEqual([
      ['2751', 3, null],
      ['7323', 13, null],
    ]);
    expect(buildRoute(catalog, '2:asc', '101', vehicles('2'), null)).toBeNull();
    expect(buildRoute(catalog, '2:sideways', '100', vehicles('2'), null)).toBeNull();
  });

  describe('a bus reported with no next stop', () => {
    // The upstream leaves the next stop empty while a bus stands at a stop (line 9, 2026-10-05:
    // within 30 m of La Cava and of Sojuela). Bus 946 of the recording, moved next to a stop.
    const pattern = catalog.pattern('10:desc')!;
    const METRES_PER_DEGREE_LAT = 111_195;
    const standingBy = (position: number, metresNorth = 20): LineVehicles => {
      const recorded = vehicles('10');
      const stop = catalog.stop(pattern.stop_ids[position - 1]!);
      return {
        ...recorded,
        vehicles: recorded.vehicles
          .filter((v) => v.id === '946')
          .map((v) => ({
            ...v,
            next_stop_id: null,
            lat: stop.lat + metresNorth / METRES_PER_DEGREE_LAT,
            lon: stop.lon,
          })),
      };
    };
    const routeWith = (positions: LineVehicles) =>
      buildRoute(catalog, '10:desc', '101', positions, arrivals('101'))!;

    it('is drawn standing at the stop it is next to, keeping its minutes', () => {
      const route = routeWith(standingBy(11));
      console.info('standing by stop 11', route.buses);
      // Stop 11 is the second shown (10–14); 12, 13 and yours (14) are still ahead.
      expect(route.buses.map((b) => [b.vehicleId, b.at, b.stopsAway, b.minutes])).toEqual([
        ['946', 1, 2, 2],
      ]);
    });

    it('is drawn at your stop when it stands at yours', () => {
      const route = routeWith(standingBy(14));
      expect(route.buses.map((b) => [b.at, b.stopsAway])).toEqual([[4, 0]]);
    });

    it('keeps its turn on the "…" when it stands further back than the stops shown', () => {
      const route = routeWith(standingBy(3));
      expect(route.buses).toEqual([]);
      expect(route.earlierBuses.map((b) => [b.vehicleId, b.at, b.stopsAway])).toEqual([
        ['946', -7, 10],
      ]);
    });

    it('is left out when it stands at a stop past yours', () => {
      expect(routeWith(standingBy(15)).buses).toEqual([]);
      expect(routeWith(standingBy(15)).earlierBuses).toEqual([]);
    });

    it(`is left out when no stop of its line is within ${DWELL_RADIUS_M} m`, () => {
      expect(routeWith(standingBy(11, DWELL_RADIUS_M - 5)).buses).toHaveLength(1);
      const away = routeWith(standingBy(11, DWELL_RADIUS_M + 5));
      console.info('65 m from stop 11', away.buses, away.earlierBuses);
      expect(away.buses).toEqual([]);
      expect(away.earlierBuses).toEqual([]);
    });
  });

  describe('a bus read behind where it was drawn', () => {
    // Bus 946 of the recording is between stops 11 and 12 of 10:desc (at 1–2 with stops 10–14).
    const pattern = catalog.pattern('10:desc')!;
    const METRES_PER_DEGREE_LAT = 111_195;
    const standingAt = (position: number): LineVehicles => {
      const recorded = vehicles('10');
      const stop = catalog.stop(pattern.stop_ids[position - 1]!);
      return {
        ...recorded,
        vehicles: recorded.vehicles.map((v) =>
          v.id === '946'
            ? {
                ...v,
                next_stop_id: null,
                lat: stop.lat + 20 / METRES_PER_DEGREE_LAT,
                lon: stop.lon,
              }
            : v,
        ),
      };
    };
    const routeOf = (
      positions: LineVehicles,
      previous: RouteView | null = null,
      previousStops = 4,
    ) =>
      buildRoute(catalog, '10:desc', '101', positions, arrivals('101'), {
        previousStops,
        previous,
      })!;
    const placeOf946 = (route: RouteView) =>
      [...route.buses, ...route.earlierBuses].find((b) => b.vehicleId === '946');

    it('stays where it was drawn when read less than a stop back', () => {
      const atStop12 = routeOf(standingAt(12));
      const read = routeOf(vehicles('10'));
      const held = routeOf(vehicles('10'), atStop12);
      console.info('drawn at 12, read', placeOf946(read), 'kept', placeOf946(held));
      expect(placeOf946(read)!.at).toBeLessThan(2);
      expect(placeOf946(held)).toMatchObject({ at: 2, stopsAway: 1, minutes: 2 });
      // The bus behind it is not touched.
      expect(held.earlierBuses).toEqual(read.earlierBuses);
    });

    it('moves forward as usual', () => {
      const between = routeOf(vehicles('10'));
      const ahead = routeOf(standingAt(13), between);
      expect(placeOf946(ahead)).toMatchObject({ at: 3, stopsAway: 0 });
    });

    it(`is believed when read more than ${MAX_HELD_BACKSTEP_STOPS} stop back`, () => {
      const atStop13 = routeOf(standingAt(13));
      const read = routeOf(vehicles('10'));
      const corrected = routeOf(vehicles('10'), atStop13);
      expect(3 - placeOf946(read)!.at).toBeGreaterThan(MAX_HELD_BACKSTEP_STOPS);
      expect(placeOf946(corrected)).toEqual(placeOf946(read));
    });

    it('is compared along the whole line when the stops shown change', () => {
      const atStop12 = routeOf(standingAt(12));
      // With 8 stops before yours the view starts at stop 6: stop 12 is at 6.
      const wider = routeOf(vehicles('10'), atStop12, 8);
      expect(wider.stops[0]?.position).toBe(6);
      expect(placeOf946(wider)?.at).toBe(6);
    });

    it('is not held by the route of another stop or direction', () => {
      const atStop12 = routeOf(standingAt(12));
      const read = routeOf(vehicles('10'));
      expect(routeOf(vehicles('10'), { ...atStop12, stopId: '999' })).toEqual(read);
      expect(routeOf(vehicles('10'), { ...atStop12, patternId: '10:asc' })).toEqual(read);
    });
  });

  it('skips buses with no direction, or no next stop and no stop beside them', () => {
    const synthetic = vehicles('2', 'upstream/vehicles-sintetico-2.json');
    const route = buildRoute(catalog, '2:desc', '101', synthetic, null)!;
    // Bus 42 is heading to 101 itself: last segment, nothing left to pass.
    expect(route.buses.map((b) => [b.vehicleId, b.stopsAway])).toEqual([['42', 0]]);
    expect(route.buses[0]?.at).toBeGreaterThan(route.stops.length - 2);
  });
});

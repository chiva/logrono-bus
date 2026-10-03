import { describe, expect, it } from 'vitest';

import {
  DirectionResolver,
  type LineVehicles,
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

  it('skips buses with no direction or no next stop', () => {
    const synthetic = vehicles('2', 'upstream/vehicles-sintetico-2.json');
    const route = buildRoute(catalog, '2:desc', '101', synthetic, null)!;
    // Bus 42 is heading to 101 itself: last segment, nothing left to pass.
    expect(route.buses.map((b) => [b.vehicleId, b.stopsAway])).toEqual([['42', 0]]);
    expect(route.buses[0]?.at).toBeGreaterThan(route.stops.length - 2);
  });
});

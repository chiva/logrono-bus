/**
 * «Cerca de mí» (`#cerca`): the stop the person is standing at, plus its pair across the street.
 *
 * Pure, so which stops are chosen is unit-tested without a browser. The pair is found around the
 * nearest stop, not around the person: GPS error moves the person, not the stops. 120 m catches
 * the widest pairs in the city (Ayuntamiento 100/101 are 66 m apart, Hospital San Pedro 117 m)
 * without reaching the next stop along the street.
 */
import {
  type BoardConfig,
  type CatalogIndex,
  type DisplayPreferences,
  type NearbyStop,
  distanceM,
  formatSelection,
  parseBoardConfig,
} from '@logrono-bus/core';

import { NEARBY_RADIUS_M } from './geolocation.ts';
import type { Here } from './views/stop-map.ts';

export const NEAR_PAIR_RADIUS_M = 120;
export const NEAR_MAX_STOPS = 3;
/** Beyond this, the position may not be at the stop the person is at: say so. */
export const NEAR_POOR_ACCURACY_M = 100;

/** The nearest stop within `NEARBY_RADIUS_M`, then any within `NEAR_PAIR_RADIUS_M` of it. */
export function nearMeStops(catalog: CatalogIndex, here: Here): NearbyStop[] {
  const [nearest, ...others] = catalog.nearby(here.lat, here.lon, {
    radiusM: NEARBY_RADIUS_M,
    limit: Number.POSITIVE_INFINITY,
  });
  if (!nearest) return [];
  const pairs = others.filter(
    ({ stop }) =>
      distanceM(nearest.stop.lat, nearest.stop.lon, stop.lat, stop.lon) <= NEAR_PAIR_RADIUS_M,
  );
  return [nearest, ...pairs].slice(0, NEAR_MAX_STOPS);
}

/** A board showing every line of `stops`, nearest first, in this device's display settings. */
export function nearMeConfig(
  stops: readonly NearbyStop[],
  preferences: Partial<DisplayPreferences> = {},
): BoardConfig | null {
  if (stops.length === 0) return null;
  const selection = formatSelection(stops.map(({ stop }) => ({ stop_id: stop.id, lines: [] })));
  return parseBoardConfig(new URLSearchParams({ p: selection }), preferences);
}

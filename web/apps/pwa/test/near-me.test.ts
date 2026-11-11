import { distanceM } from '@logrono-bus/core';
import { describe, expect, it } from 'vitest';

import { fixtureCatalog } from '../../../packages/core/test/fixtures.ts';
import { NEARBY_RADIUS_M } from '../src/geolocation.ts';
import { NEAR_MAX_STOPS, NEAR_PAIR_RADIUS_M, nearMeConfig, nearMeStops } from '../src/near-me.ts';
import { nearStopsSummary } from '../src/views/near-me.ts';
import type { Here } from '../src/views/stop-map.ts';

const catalog = fixtureCatalog();

/** Standing on a stop of `contracts/fixtures/upstream/stops.json`, GPS ± 20 m. */
function at(stopId: string, accuracyM = 20): Here {
  const stop = catalog.stop(stopId);
  return { lat: stop.lat, lon: stop.lon, accuracyM };
}

const ids = (here: Here): string[] => nearMeStops(catalog, here).map(({ stop }) => stop.id);

describe('nearMeStops', () => {
  it('adds the stop across the street, 66 m away, nearest first', () => {
    expect(ids(at('101'))).toEqual(['101', '100']);
    expect(ids(at('100'))).toEqual(['100', '101']);
  });

  it('leaves out stops of the same name farther along the street', () => {
    const chosen = ids(at('101'));
    const stop2 = catalog.stop('2');
    const from101 = distanceM(
      catalog.stop('101').lat,
      catalog.stop('101').lon,
      stop2.lat,
      stop2.lon,
    );
    expect(from101, 'stop 2 is beyond the pair radius').toBeGreaterThan(NEAR_PAIR_RADIUS_M);
    expect(chosen).not.toContain('2');
  });

  it('keeps wide-avenue pairs (Hospital San Pedro, 117 m apart) and a corner stop', () => {
    // Puente Madre (162) is ~50 m from 35, on the next street: also within reach.
    expect(ids(at('35'))).toEqual(['35', '162', '133']);
  });

  it('measures the pair from the nearest stop, not from the person', () => {
    // Halfway between 101 and 100, nudged towards 101: 100 is still its pair.
    const a = catalog.stop('101');
    const b = catalog.stop('100');
    const here = { lat: a.lat * 0.6 + b.lat * 0.4, lon: a.lon * 0.6 + b.lon * 0.4, accuracyM: 50 };
    expect(ids(here)).toEqual(['101', '100']);
  });

  it(`shows at most ${NEAR_MAX_STOPS} stops`, () => {
    for (const stop of catalog.catalog.stops) {
      expect(ids(at(stop.id)).length, `around stop ${stop.id}`).toBeLessThanOrEqual(NEAR_MAX_STOPS);
    }
  });

  it(`finds nothing farther than ${NEARBY_RADIUS_M} m (Madrid)`, () => {
    expect(nearMeStops(catalog, { lat: 40.4168, lon: -3.7038, accuracyM: 20 })).toEqual([]);
  });
});

describe('nearMeConfig', () => {
  it('shows every line of each stop, in order, as a normal board would', () => {
    const config = nearMeConfig(nearMeStops(catalog, at('101')));
    expect(config?.stops).toEqual([
      { stop_id: '101', lines: [] },
      { stop_id: '100', lines: [] },
    ]);
    expect(config).toMatchObject({ mode: 'panel', title: null, source: 'auto', api: null });
  });

  it("applies this device's display settings", () => {
    const config = nearMeConfig(nearMeStops(catalog, at('101')), {
      theme: 'oscuro',
      textScale: 120,
      order: 'llegada',
    });
    expect(config).toMatchObject({ theme: 'oscuro', textScale: 120, order: 'llegada' });
  });

  it('is null without stops', () => {
    expect(nearMeConfig([])).toBeNull();
  });
});

describe('nearStopsSummary', () => {
  it('names each stop with its number and rounded distance', () => {
    const summary = nearStopsSummary(nearMeStops(catalog, at('101')));
    expect(summary).toBe('Ayuntamiento · nº 101 · a 0 m — Ayuntamiento · nº 100 · a 66 m');
  });
});

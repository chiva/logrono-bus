/** Serve the Ayuntamiento's API from the recorded contract fixtures and freeze the clock. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page, Route } from '@playwright/test';

const FIXTURES = join(import.meta.dirname, '../../../../contracts/fixtures/upstream');
export const UPSTREAM = 'https://transporteurbano.logrono.es/api/';
/** 18:00:45 in Logroño, when the Ayuntamiento fixtures were recorded. */
export const RECORDED_AT = new Date('2026-10-03T16:00:45Z');
/** 22:30:36 in Logroño: bus positions and the "-noche" arrivals were recorded together. */
export const NIGHT_AT = new Date('2026-10-03T20:30:36Z');

const NO_ARRIVALS = '{"result":{"arrivals":[]}}';
/** What the upstream answers for a line with no service today. */
const NO_SERVICE = '{"result":{"frequenciesByDirection":{},"passesByDirection":{}}}';

const read = (name: string, missing = NO_ARRIVALS): string => {
  try {
    return readFileSync(join(FIXTURES, name), 'utf8');
  } catch {
    return missing;
  }
};

export interface UpstreamOptions {
  /** Answer arrivals with this HTTP status instead (simulate an outage). */
  readonly arrivalsStatus?: number;
  /** `noche`: the evening recording, with bus positions that match its arrivals. */
  readonly scene?: 'tarde' | 'noche';
  /** `vacio`: no bus due at any stop (late at night, say). */
  readonly arrivals?: 'vacio';
  /** Freeze the clock here instead of at the recording's time. */
  readonly at?: Date;
}

export async function useRecordedUpstream(
  page: Page,
  options: UpstreamOptions = {},
): Promise<string[]> {
  const requested: string[] = [];
  const night = options.scene === 'noche';
  await page.clock.setFixedTime(options.at ?? (night ? NIGHT_AT : RECORDED_AT));
  await page.route(`${UPSTREAM}**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/', '');
    requested.push(path);
    const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
    if (path === 'linesDiscovery/lines')
      return route.fulfill({ headers, body: read('lines.json') });
    if (path === 'linesDiscovery/stops')
      return route.fulfill({ headers, body: read('stops.json') });
    const stop = /^estimatedTimetable\/byStop\/(\w+)$/.exec(path)?.[1];
    if (stop) {
      if (options.arrivalsStatus)
        return route.fulfill({ headers, status: options.arrivalsStatus, body: '{}' });
      if (options.arrivals === 'vacio') return route.fulfill({ headers, body: NO_ARRIVALS });
      return route.fulfill({
        headers,
        body: read(night ? `arrivals-${stop}-noche.json` : `arrivals-${stop}.json`),
      });
    }
    const timetable = /^productionTimetable\/byLine\/(\w+)$/.exec(path)?.[1];
    if (timetable) {
      return route.fulfill({ headers, body: read(`timetable-${timetable}.json`, NO_SERVICE) });
    }
    const line = /^vehicleMonitoring\/byLine\/(\w+)$/.exec(path)?.[1];
    if (line) return route.fulfill({ headers, body: read(`vehicles-${line}.json`) });
    return route.fulfill({ headers, status: 404, body: '{}' });
  });
  // Map tiles are irrelevant to the tests and must not hit openstreetmap.org.
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204 }));
  return requested;
}

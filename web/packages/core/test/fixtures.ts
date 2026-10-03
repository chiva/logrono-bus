/** Access to the golden corpus shared with the Python suite (`contracts/fixtures`). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CatalogIndex, buildCatalog, parseLines, parseStops } from '../src/index.ts';

// import.meta.dirname rather than import.meta.url: under happy-dom the latter is not a file: URL.
export const FIXTURES = join(import.meta.dirname, '../../../../contracts/fixtures/');

export function loadFixture<T = unknown>(relative: string): T {
  return JSON.parse(readFileSync(`${FIXTURES}${relative}`, 'utf8')) as T;
}

export interface ArrivalCase {
  name: string;
  description: string;
  stop_id: string;
  now: string;
  upstream: string;
  expected: string;
}

export interface CardCase {
  name: string;
  arrivals: string;
  p: string;
  limit: number;
  expected: string;
}

export interface SortCase {
  name: string;
  cards: string;
  order: 'seleccion' | 'linea' | 'llegada';
  expected: string;
}

export interface VehicleCase {
  name: string;
  line_id: string;
  now: string;
  upstream: string;
  expected: string;
}

export interface TimetableCase {
  name: string;
  line_id: string;
  now: string;
  upstream: string;
  expected: string;
}

export interface ServiceCase {
  name: string;
  timetable: string;
  pattern_id: string;
  at: string[];
  expected: string;
}

export interface Manifest {
  catalog: { lines: string; stops: string; fetched_at: string; expected: string };
  arrivals: ArrivalCase[];
  cards: CardCase[];
  sorts: SortCase[];
  vehicles: VehicleCase[];
  timetables: TimetableCase[];
  services: ServiceCase[];
}

export const MANIFEST = loadFixture<Manifest>('manifest.json');

export function fixtureCatalog(): CatalogIndex {
  const spec = MANIFEST.catalog;
  return new CatalogIndex(
    buildCatalog(
      parseLines(loadFixture(spec.lines)),
      parseStops(loadFixture(spec.stops)),
      spec.fetched_at,
    ),
  );
}

/** A fetch double answering from a route table, recording every URL requested. */
export function fakeFetch(routes: Record<string, () => Response | Promise<Response>>): {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (input: string, init?: RequestInit) => {
      calls.push(input);
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const route = Object.keys(routes).find((prefix) => input.startsWith(prefix));
      if (!route) return new Response('{"message":"Not Found"}', { status: 404 });
      return routes[route]!();
    },
  };
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

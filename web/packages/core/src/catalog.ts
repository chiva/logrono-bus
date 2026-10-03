/** Indexed, read-only view over a `Catalog`, mirroring the lookups on Python's `Catalog`. */
import { LineNotFound, StopNotFound } from './errors.ts';
import { distanceM } from './geo.ts';
import type { Catalog, Line, NearbyStop, Pattern, Stop } from './models.ts';
import { compareCodePoints } from './models.ts';
import { fold } from './text.ts';

export const DEFAULT_NEARBY_RADIUS_M = 500;
export const DEFAULT_NEARBY_LIMIT = 10;
export const DEFAULT_SEARCH_LIMIT = 20;

/** 1-based position of `stopId` along a pattern, or null if not served. */
export function patternPosition(pattern: Pattern, stopId: string): number | null {
  const index = pattern.stop_ids.indexOf(stopId);
  return index === -1 ? null : index + 1;
}

/** Whether buses on this pattern end their trip at `stopId`. */
export function isTerminus(pattern: Pattern, stopId: string): boolean {
  return pattern.stop_ids.length > 0 && pattern.stop_ids[pattern.stop_ids.length - 1] === stopId;
}

export class CatalogIndex {
  readonly catalog: Catalog;
  readonly #lines: ReadonlyMap<string, Line>;
  readonly #stops: ReadonlyMap<string, Stop>;
  readonly #patterns: ReadonlyMap<string, Pattern>;
  readonly #patternsByStop: ReadonlyMap<string, readonly Pattern[]>;

  constructor(catalog: Catalog) {
    this.catalog = catalog;
    this.#lines = new Map(catalog.lines.map((line) => [line.id, line]));
    this.#stops = new Map(catalog.stops.map((stop) => [stop.id, stop]));
    this.#patterns = new Map(catalog.patterns.map((pattern) => [pattern.id, pattern]));
    const byStop = new Map<string, Pattern[]>();
    for (const pattern of catalog.patterns) {
      for (const stopId of new Set(pattern.stop_ids)) {
        const list = byStop.get(stopId) ?? [];
        list.push(pattern);
        byStop.set(stopId, list);
      }
    }
    this.#patternsByStop = byStop;
  }

  get lines(): readonly Line[] {
    return this.catalog.lines;
  }

  get stops(): readonly Stop[] {
    return this.catalog.stops;
  }

  hasLine(lineId: string): boolean {
    return this.#lines.has(lineId);
  }

  line(lineId: string): Line {
    const line = this.#lines.get(lineId);
    if (!line) throw new LineNotFound(lineId);
    return line;
  }

  stop(stopId: string): Stop {
    const stop = this.#stops.get(stopId);
    if (!stop) throw new StopNotFound(stopId);
    return stop;
  }

  findStop(stopId: string): Stop | undefined {
    return this.#stops.get(stopId);
  }

  pattern(patternId: string): Pattern | undefined {
    return this.#patterns.get(patternId);
  }

  patternsForLine(lineId: string): Pattern[] {
    return this.catalog.patterns.filter((pattern) => pattern.line_id === lineId);
  }

  /** Every direction of every line serving `stopId`. */
  patternsAt(stopId: string): readonly Pattern[] {
    return this.#patternsByStop.get(stopId) ?? [];
  }

  nearby(
    lat: number,
    lon: number,
    { radiusM = DEFAULT_NEARBY_RADIUS_M, limit = DEFAULT_NEARBY_LIMIT } = {},
  ): NearbyStop[] {
    return this.catalog.stops
      .map((stop) => ({ stop, distance_m: distanceM(lat, lon, stop.lat, stop.lon) }))
      .filter((candidate) => candidate.distance_m <= radiusM)
      .sort((a, b) => a.distance_m - b.distance_m || compareCodePoints(a.stop.id, b.stop.id))
      .slice(0, limit);
  }

  /** Accent- and case-insensitive name search; an exact stop number ranks first. */
  search(query: string, { limit = DEFAULT_SEARCH_LIMIT } = {}): Stop[] {
    const needle = fold(query);
    if (!needle) return [];
    const exact = this.#stops.get(needle);
    const byName = this.catalog.stops
      .filter((stop) => stop !== exact && fold(stop.name).includes(needle))
      .map((stop) => ({ stop, startsWith: fold(stop.name).startsWith(needle) }))
      .sort(
        (a, b) =>
          Number(b.startsWith) - Number(a.startsWith) ||
          compareCodePoints(a.stop.name, b.stop.name) ||
          compareCodePoints(a.stop.id, b.stop.id),
      )
      .map(({ stop }) => stop);
    return [...(exact ? [exact] : []), ...byName].slice(0, limit);
  }
}

/** Pure upstream → domain transformation; mirror of `logrono_bus.providers.logrono.normalize`. */
import { isTerminus } from './catalog.ts';
import type { CatalogIndex } from './catalog.ts';
import { parseColour, textColourFor } from './colour.ts';
import type { DirectionResolver } from './directions.ts';
import { UpstreamSchemaError } from './errors.ts';
import type {
  Arrival,
  Catalog,
  Direction,
  DirectionTimetable,
  Line,
  LineTimetable,
  LineVehicles,
  Pattern,
  Stop,
  StopArrivals,
  Vehicle,
} from './models.ts';
import { DIRECTIONS, minutesUntil, naturalCompare } from './models.ts';
import type { RawArrival, RawDirectionTimetable, RawLine, RawStop, RawVehicle } from './raw.ts';
import { canonicalTimestamp } from './raw.ts';
import { titleEs } from './text.ts';
import { localDate } from './timetable.ts';

/** `arrivalStatus` of a timetable fill-in. */
export const SCHEDULED_STATUS = 'scheduled';
/** Arrivals expected longer ago than this are dropped. */
export const PAST_ARRIVAL_GRACE_MS = 60_000;
/** Positions older than this are dropped (the bus may have finished or lost signal). */
export const STALE_POSITION_MS = 3 * 60_000;
/**
 * Named directions → catalogue direction, for vehicle positions (`directionRef`) and timetables
 * (`…ByDirection` keys). Verified on lines 1, 2, 5, 10.
 */
export const DIRECTION_NAMES: Readonly<Record<string, Direction>> = {
  ida: 'asc',
  vuelta: 'desc',
};

const NAME_SEPARATOR = '-';
const DISPLAY_SEPARATOR = ' – ';

export function splitLineName(rawName: string): [label: string, name: string] {
  const separator = rawName.indexOf(NAME_SEPARATOR);
  const label = separator === -1 ? rawName : rawName.slice(0, separator);
  const route = separator === -1 ? '' : rawName.slice(separator + 1);
  const termini = route
    .split(NAME_SEPARATOR)
    .filter((part) => part.trim())
    .map(titleEs);
  return [label.trim(), termini.join(DISPLAY_SEPARATOR)];
}

export function normalizeLine(raw: RawLine): Line {
  const [label, name] = splitLineName(raw.name);
  let colour: string;
  try {
    colour = parseColour(raw.colour);
  } catch (error) {
    throw new UpstreamSchemaError((error as Error).message, `line[${raw.id}].color`);
  }
  return {
    id: raw.id,
    label: label || raw.id,
    name: name || raw.name,
    colour,
    text_colour: textColourFor(colour),
  };
}

export function normalizePatterns(raw: RawLine): Pattern[] {
  return DIRECTIONS.flatMap((direction) => {
    const refs = direction === 'asc' ? raw.asc : raw.desc;
    const first = refs[0];
    const last = refs[refs.length - 1];
    if (!first || !last) return [];
    return [
      {
        id: `${raw.id}:${direction}`,
        line_id: raw.id,
        direction,
        origin: first.name,
        headsign: last.name,
        stop_ids: refs.map((ref) => ref.id),
      },
    ];
  });
}

export function normalizeStop(raw: RawStop, knownLines: ReadonlySet<string>): Stop {
  const lineIds = [...new Set(raw.lineIds)].filter((id) => knownLines.has(id)).sort(naturalCompare);
  return { id: raw.id, name: raw.name, lat: raw.lat, lon: raw.lon, line_ids: lineIds };
}

export function buildCatalog(
  rawLines: readonly RawLine[],
  rawStops: readonly RawStop[],
  fetchedAt: string,
): Catalog {
  const lines = rawLines.map(normalizeLine).sort((a, b) => naturalCompare(a.label, b.label));
  const order = new Map(lines.map((line, index) => [line.id, index]));
  const patterns = rawLines
    .flatMap(normalizePatterns)
    .sort(
      (a, b) =>
        (order.get(a.line_id) ?? 0) - (order.get(b.line_id) ?? 0) ||
        DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction),
    );
  const knownLines = new Set(order.keys());
  const stops = rawStops
    .map((raw) => normalizeStop(raw, knownLines))
    .sort((a, b) => naturalCompare(a.id, b.id));
  return { lines, patterns, stops, fetched_at: canonicalTimestamp(fetchedAt, 'fetched_at') };
}

/**
 * Normalise one stop's arrivals: resolve direction, drop stale entries and entries for lines that
 * do not serve the stop (the upstream returns stray vehicles), sort soonest first.
 */
export function normalizeArrivals(
  rawArrivals: readonly RawArrival[],
  stopId: string,
  catalog: CatalogIndex,
  resolver: DirectionResolver,
  now: string,
): StopArrivals {
  const generatedAt = canonicalTimestamp(now, 'now');
  const nowMs = Date.parse(generatedAt);
  const serving = new Set(catalog.stop(stopId).line_ids);
  const arrivals: Arrival[] = [];
  for (const raw of rawArrivals) {
    if (raw.stopId !== stopId || !serving.has(raw.lineId)) continue;
    if (Date.parse(raw.expected) < nowMs - PAST_ARRIVAL_GRACE_MS) continue;
    const pattern = resolver.resolve(raw.lineId, stopId, raw.order, raw.directionRef);
    arrivals.push({
      stop_id: stopId,
      line_id: raw.lineId,
      pattern_id: pattern?.id ?? null,
      direction: pattern?.direction ?? null,
      headsign: pattern?.headsign ?? null,
      aimed: raw.aimed,
      expected: raw.expected,
      minutes: minutesUntil(raw.expected, nowMs),
      delay_s: raw.delayS,
      is_realtime: Boolean(raw.vehicleRef) && raw.arrivalStatus.toLowerCase() !== SCHEDULED_STATUS,
      is_approximate: raw.inaccurate,
      terminates: pattern ? isTerminus(pattern, stopId) : false,
      cancelled: raw.cancelled,
      vehicle_id: raw.vehicleRef || null,
    });
  }
  arrivals.sort(
    (a, b) =>
      Date.parse(a.expected) - Date.parse(b.expected) ||
      naturalCompare(catalog.line(a.line_id).label, catalog.line(b.line_id).label),
  );
  return { stop_id: stopId, generated_at: generatedAt, arrivals };
}

function vehicleDirection(raw: RawVehicle, catalog: CatalogIndex): Direction | null {
  const named = DIRECTION_NAMES[raw.directionRef.toLowerCase()];
  if (named !== undefined || !raw.nextStopId) return named ?? null;
  const serving = catalog.patternsAt(raw.nextStopId).filter((p) => p.line_id === raw.lineId);
  return serving.length === 1 ? (serving[0]?.direction ?? null) : null;
}

/** Positions of one line's buses: stale reports dropped, direction resolved, sorted by id. */
export function normalizeVehicles(
  rawVehicles: readonly RawVehicle[],
  lineId: string,
  catalog: CatalogIndex,
  now: string,
): LineVehicles {
  const generatedAt = canonicalTimestamp(now, 'now');
  const nowMs = Date.parse(generatedAt);
  const vehicles: Vehicle[] = rawVehicles
    .filter(
      (raw) => raw.lineId === lineId && Date.parse(raw.recordedAt) >= nowMs - STALE_POSITION_MS,
    )
    .map((raw) => {
      const direction = vehicleDirection(raw, catalog);
      const pattern = direction ? catalog.pattern(`${lineId}:${direction}`) : undefined;
      return {
        id: raw.vehicleRef,
        line_id: lineId,
        direction,
        pattern_id: pattern?.id ?? null,
        lat: raw.lat,
        lon: raw.lon,
        next_stop_id: raw.nextStopId || null,
        recorded_at: raw.recordedAt,
        delay_s: raw.delayS,
      };
    })
    .sort((a, b) => naturalCompare(a.id, b.id));
  return { line_id: lineId, generated_at: generatedAt, vehicles };
}

/**
 * Today's timetable of a line, one entry per direction the catalogue knows, `asc` first. Unknown
 * direction names are skipped rather than failing the whole line.
 */
export function normalizeTimetable(
  rawDirections: readonly RawDirectionTimetable[],
  lineId: string,
  catalog: CatalogIndex,
  now: string,
): LineTimetable {
  const generatedAt = canonicalTimestamp(now, 'now');
  const directions: DirectionTimetable[] = [];
  for (const raw of rawDirections) {
    const direction = DIRECTION_NAMES[raw.name.toLowerCase()];
    const pattern = direction ? catalog.pattern(`${lineId}:${direction}`) : undefined;
    if (!pattern) continue;
    directions.push({
      pattern_id: pattern.id,
      direction: pattern.direction,
      origin: pattern.origin,
      headsign: pattern.headsign,
      departures: [...raw.passes],
      periods: raw.frequencies.map((frequency) => ({
        first: frequency.first,
        last: frequency.last,
        interval_min: frequency.intervalMin,
        interval_max_min: frequency.intervalMaxMin ?? frequency.intervalMin,
      })),
    });
  }
  directions.sort((a, b) => DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction));
  return {
    line_id: lineId,
    service_date: localDate(generatedAt),
    generated_at: generatedAt,
    directions,
  };
}

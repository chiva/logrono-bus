/**
 * The route view behind a card: the stops a bus passes before reaching yours, and where each bus
 * of that line and direction is right now.
 *
 * Positions come from the vehicle-monitoring endpoint, which reports the stop each bus is heading
 * to plus its coordinates. A bus sits between that stop and the one before it; how far along is
 * estimated from straight-line distances, which is plenty for a diagram. While a bus stands at a
 * stop the endpoint often leaves the next stop empty; such a bus is drawn at the stop of its
 * pattern it is standing by, if any is within `DWELL_RADIUS_M`.
 *
 * The vehicle-monitoring fleet numbers do not match the arrivals endpoint's vehicle numbers, so
 * "this bus arrives in 4 min" is matched by order instead: the bus nearest your stop gets the
 * soonest real-time arrival, the next one the next arrival, and so on — including buses further
 * back than the stops shown, which the view parks on the "…" before the first stop.
 */
import { type CatalogIndex, patternPosition } from './catalog.ts';
import { distanceM } from './geo.ts';
import type { LineVehicles, Pattern, StopArrivals } from './models.ts';
import { minutesUntil } from './models.ts';

/** Stops shown before yours; the rest of the line behind them is drawn as "…". */
export const DEFAULT_PREVIOUS_STOPS = 4;
export const MIN_PREVIOUS_STOPS = 1;
export const MAX_PREVIOUS_STOPS = 12;
/**
 * How close a bus with no next stop must be to a stop to count as standing at it. Buses seen
 * standing at a stop with no next stop reported were within 30 m of it (line 9, 2026-10-05).
 */
export const DWELL_RADIUS_M = 60;

export interface RouteStop {
  readonly id: string;
  readonly name: string;
  /** 1-based position along the whole pattern. */
  readonly position: number;
  /** Where the line starts or ends (drawn as a terminus, like on a metro map). */
  readonly terminus: boolean;
}

export interface RouteBus {
  readonly vehicleId: string;
  /**
   * Where the bus is, in stop units along `stops`: 0 is the first stop shown, `stops.length - 1`
   * is your stop, 2.5 is halfway between the third and fourth stops shown. Negative: before the
   * first stop shown (-3 is three stops further back).
   */
  readonly at: number;
  /** Stops still to pass before yours (0: yours is the next one). */
  readonly stopsAway: number;
  /** Minutes to your stop when it could be matched to a real-time arrival. */
  readonly minutes: number | null;
}

export interface RouteView {
  readonly patternId: string;
  readonly lineId: string;
  readonly stopId: string;
  readonly origin: string;
  readonly headsign: string;
  /** From the first stop shown to yours (last). */
  readonly stops: readonly RouteStop[];
  /** On the stops shown, nearest to your stop first. */
  readonly buses: readonly RouteBus[];
  /** Further back than the first stop shown, nearest first. */
  readonly earlierBuses: readonly RouteBus[];
  /** Stops of the pattern before the first one shown. */
  readonly hiddenStops: number;
  /** Stops of the pattern after yours (0: yours is the last one). */
  readonly stopsAfter: number;
  readonly generatedAt: string;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function buildRoute(
  catalog: CatalogIndex,
  patternId: string,
  stopId: string,
  vehicles: LineVehicles,
  arrivals: StopArrivals | null,
  { previousStops = DEFAULT_PREVIOUS_STOPS, now = vehicles.generated_at } = {},
): RouteView | null {
  const pattern = catalog.pattern(patternId);
  const target = pattern ? patternPosition(pattern, stopId) : null;
  if (!pattern || target === null) return null;

  const first = Math.max(1, target - Math.max(0, previousStops));
  const stops: RouteStop[] = pattern.stop_ids.slice(first - 1, target).map((id, index) => ({
    id,
    name: catalog.findStop(id)?.name ?? id,
    position: first + index,
    terminus: first + index === 1 || first + index === pattern.stop_ids.length,
  }));

  const placed: { vehicleId: string; at: number; stopsAway: number }[] = [];
  for (const vehicle of vehicles.vehicles) {
    if (vehicle.pattern_id !== pattern.id) continue;
    if (vehicle.next_stop_id === null) {
      const standing = standingAt(catalog, pattern, vehicle);
      // Standing nowhere known, or at a stop past yours.
      if (standing === null || standing > target) continue;
      placed.push({
        vehicleId: vehicle.id,
        at: standing - first,
        stopsAway: Math.max(0, target - standing - 1),
      });
      continue;
    }
    const next = patternPosition(pattern, vehicle.next_stop_id);
    // Not on this pattern, or already past your stop.
    if (next === null || next > target) continue;
    placed.push({
      vehicleId: vehicle.id,
      // Waiting at the first stop of the line, or between the stop before `next` and `next`.
      at:
        next === 1
          ? 1 - first
          : next - 1 - first + progressTowards(catalog, pattern, next, vehicle),
      stopsAway: target - next,
    });
  }
  placed.sort((a, b) => b.at - a.at);

  const soonest = (arrivals?.arrivals ?? [])
    .filter((a) => a.pattern_id === pattern.id && a.is_realtime && !a.cancelled)
    .map((a) => minutesUntil(a.expected, now));
  const all = placed.map((bus, index) => ({ ...bus, minutes: soonest[index] ?? null }));

  return {
    patternId: pattern.id,
    lineId: pattern.line_id,
    stopId,
    origin: pattern.origin,
    headsign: pattern.headsign,
    stops,
    buses: all.filter((bus) => bus.at >= 0),
    earlierBuses: all.filter((bus) => bus.at < 0),
    hiddenStops: first - 1,
    stopsAfter: pattern.stop_ids.length - target,
    generatedAt: vehicles.generated_at,
  };
}

/** 1-based position of the pattern stop a bus is standing by, nearest first, or null. */
function standingAt(
  catalog: CatalogIndex,
  pattern: Pattern,
  vehicle: { lat: number; lon: number },
): number | null {
  let position: number | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const [index, id] of pattern.stop_ids.entries()) {
    const stop = catalog.findStop(id);
    if (!stop) continue;
    const distance = distanceM(stop.lat, stop.lon, vehicle.lat, vehicle.lon);
    if (distance <= DWELL_RADIUS_M && distance < nearest) {
      position = index + 1;
      nearest = distance;
    }
  }
  return position;
}

/** How far a bus has gone from the stop before `next` towards `next` (0–1), by distance. */
function progressTowards(
  catalog: CatalogIndex,
  pattern: Pattern,
  next: number,
  vehicle: { lat: number; lon: number },
): number {
  const previous = catalog.findStop(pattern.stop_ids[next - 2] ?? '');
  const upcoming = catalog.findStop(pattern.stop_ids[next - 1] ?? '');
  if (!previous || !upcoming) return 0.5;
  const done = distanceM(previous.lat, previous.lon, vehicle.lat, vehicle.lon);
  const left = distanceM(vehicle.lat, vehicle.lon, upcoming.lat, upcoming.lon);
  return done + left > 0 ? clamp(done / (done + left), 0, 1) : 0;
}

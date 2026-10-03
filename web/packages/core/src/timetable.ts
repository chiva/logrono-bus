/**
 * Where a line stands in its day: not started, running (and how often), or finished.
 * Mirror of `logrono_bus.timetable`, checked against the same golden cases.
 */
import type { DirectionTimetable } from './models.ts';
import { TIMEZONE } from './models.ts';

export const SERVICE_STATES = ['antes', 'en_servicio', 'terminado', 'sin_servicio'] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

export interface ServiceStatus {
  /** `antes`: today's first bus has not left; `terminado`: the last one has. */
  readonly state: ServiceState;
  readonly first: string | null;
  readonly last: string | null;
  /** Next departure from the line's origin, while there is one today. */
  readonly next_departure: string | null;
  /** Headway of the period now running (or about to start), while in service. */
  readonly interval_min: number | null;
  readonly interval_max_min: number | null;
}

// Built once: formatters are costly. `h23` because `hour12: false` gives "24:05" in some Chromiums.
const localParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function partsOf(instant: string | number): Record<string, string> {
  const date = new Date(typeof instant === 'number' ? instant : Date.parse(instant));
  return Object.fromEntries(localParts.formatToParts(date).map((part) => [part.type, part.value]));
}

/** Local (Logroño) date of an instant, `YYYY-MM-DD`. */
export function localDate(instant: string | number): string {
  const parts = partsOf(instant);
  return `${parts['year']}-${parts['month']}-${parts['day']}`;
}

/** Local (Logroño) minutes since midnight of an instant. */
export function localMinutes(instant: string | number): number {
  const parts = partsOf(instant);
  return Number(parts['hour']) * MINUTES_PER_HOUR + Number(parts['minute']);
}

/** "cada 30 min", or "cada 12–15 min" when the headway varies. */
export function describeInterval(
  intervalMin: number,
  intervalMaxMin: number | null = null,
): string {
  return intervalMaxMin === null || intervalMaxMin === intervalMin
    ? `cada ${intervalMin} min`
    : `cada ${intervalMin}–${intervalMaxMin} min`;
}

/** "07:05" → 425; after-midnight times ("24:30") stay past 1440. */
export function clockMinutes(clock: string): number {
  const [hours = '0', minutes = '0'] = clock.split(':');
  return Number(hours) * MINUTES_PER_HOUR + Number(minutes);
}

/** Minutes since midnight, a later day added whenever the list wraps past midnight. */
function inOrder(departures: readonly string[]): number[] {
  const result: number[] = [];
  for (const clock of departures) {
    let minutes = clockMinutes(clock);
    const previous = result[result.length - 1];
    while (previous !== undefined && minutes < previous) minutes += MINUTES_PER_DAY;
    result.push(minutes);
  }
  return result;
}

const NO_SERVICE: ServiceStatus = {
  state: 'sin_servicio',
  first: null,
  last: null,
  next_departure: null,
  interval_min: null,
  interval_max_min: null,
};

export function serviceStatus(
  timetable: DirectionTimetable | null | undefined,
  now: string | number,
): ServiceStatus {
  const departures = timetable?.departures ?? [];
  const first = departures[0];
  const last = departures[departures.length - 1];
  if (!timetable || first === undefined || last === undefined) return NO_SERVICE;
  const nowMin = localMinutes(now);
  const times = inOrder(departures);
  const state: ServiceState =
    nowMin < (times[0] ?? 0)
      ? 'antes'
      : nowMin > (times[times.length - 1] ?? 0)
        ? 'terminado'
        : 'en_servicio';
  const nextIndex = times.findIndex((minutes) => minutes >= nowMin);
  const period =
    state === 'en_servicio'
      ? timetable.periods.find((candidate) => nowMin <= clockMinutes(candidate.last))
      : undefined;
  return {
    state,
    first,
    last,
    next_departure: nextIndex === -1 ? null : (departures[nextIndex] ?? null),
    interval_min: period?.interval_min ?? null,
    interval_max_min: period?.interval_max_min ?? null,
  };
}

/** The direction of a timetable a pattern runs in. */
export function timetableFor(
  timetable: { readonly directions: readonly DirectionTimetable[] } | null | undefined,
  patternId: string | null,
): DirectionTimetable | undefined {
  return patternId ? timetable?.directions.find((d) => d.pattern_id === patternId) : undefined;
}

/**
 * Board selection codec (URL parameter `p`, version 1); mirror of `logrono_bus.board`, whose
 * docstring holds the grammar. Both are checked against `contracts/fixtures/selection.json`.
 */
import { InvalidSelection } from './errors.ts';
import type { Arrival, Direction, StopArrivals } from './models.ts';

export const SELECTION_VERSION = 1;
export const MAX_STOPS = 12;
export const MAX_LINES_PER_STOP = 24;
export const GROUP_SEPARATOR = '~';
export const STOP_SEPARATOR = '-';
export const ITEM_SEPARATOR = '.';

export interface LineSelection {
  readonly line_id: string;
  /** null accepts both directions. */
  readonly direction: Direction | null;
}

export interface StopSelection {
  readonly stop_id: string;
  /** Empty means every line serving the stop. */
  readonly lines: readonly LineSelection[];
}

const DIRECTION_CODES: Readonly<Record<string, Direction | null>> = {
  a: 'asc',
  d: 'desc',
  x: null,
};
const ID = /^[0-9A-Za-z]{1,16}$/;
const ITEM = /^([0-9A-Za-z]{1,16}?)([adx])$/;

export function directionCode(direction: Direction | null): string {
  return direction === 'asc' ? 'a' : direction === 'desc' ? 'd' : 'x';
}

export function lineMatches(selection: LineSelection, arrival: Arrival): boolean {
  return (
    arrival.line_id === selection.line_id &&
    (selection.direction === null || arrival.direction === selection.direction)
  );
}

export function stopMatches(selection: StopSelection, arrival: Arrival): boolean {
  return (
    arrival.stop_id === selection.stop_id &&
    (selection.lines.length === 0 || selection.lines.some((line) => lineMatches(line, arrival)))
  );
}

export function filterArrivals(selection: StopSelection, arrivals: StopArrivals): StopArrivals {
  return { ...arrivals, arrivals: arrivals.arrivals.filter((a) => stopMatches(selection, a)) };
}

export function parseSelection(value: string): StopSelection[] {
  const text = value.trim();
  if (!text) throw new InvalidSelection('La selección está vacía');
  const groups = text.split(GROUP_SEPARATOR);
  if (groups.length > MAX_STOPS) {
    throw new InvalidSelection(`Como mucho ${MAX_STOPS} paradas por panel`);
  }
  return groups.map(parseGroup);
}

function parseGroup(group: string): StopSelection {
  const separator = group.indexOf(STOP_SEPARATOR);
  const stopId = separator === -1 ? group : group.slice(0, separator);
  if (!ID.test(stopId)) throw new InvalidSelection(`Parada no válida: '${stopId}'`);
  if (separator === -1) return { stop_id: stopId, lines: [] };
  const parts = group.slice(separator + 1).split(ITEM_SEPARATOR);
  if (parts.length > MAX_LINES_PER_STOP) {
    throw new InvalidSelection(`Como mucho ${MAX_LINES_PER_STOP} líneas por parada`);
  }
  return { stop_id: stopId, lines: parts.map((part) => parseItem(stopId, part)) };
}

function parseItem(stopId: string, item: string): LineSelection {
  const match = ITEM.exec(item);
  const [, lineId, code] = match ?? [];
  if (!lineId || !code) {
    throw new InvalidSelection(`Línea no válida en la parada ${stopId}: '${item}'`);
  }
  return { line_id: lineId, direction: DIRECTION_CODES[code] ?? null };
}

export function formatSelection(stops: readonly StopSelection[]): string {
  return stops
    .map((stop) => {
      const items = stop.lines
        .map((line) => `${line.line_id}${directionCode(line.direction)}`)
        .join(ITEM_SEPARATOR);
      return items ? `${stop.stop_id}${STOP_SEPARATOR}${items}` : stop.stop_id;
    })
    .join(GROUP_SEPARATOR);
}

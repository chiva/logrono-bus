/**
 * Domain model, generated from the service's OpenAPI document (`just gen`), so the TypeScript
 * client, the HTTP API and the Python library can never disagree on a field.
 */
import type { components } from './types.gen.ts';

type Schemas = components['schemas'];

export type Direction = Schemas['Direction'];
export type Line = Schemas['Line'];
export type Pattern = Schemas['Pattern'];
export type Stop = Schemas['Stop'];
export type NearbyStop = Schemas['NearbyStop'];
export type Catalog = Schemas['Catalog'];
export type Arrival = Schemas['Arrival'];
export type StopArrivals = Schemas['StopArrivals'];
export type Card = Schemas['Card'];
export type Board = Schemas['Board'];
export type Health = Schemas['Health'];
export type Vehicle = Schemas['Vehicle'];
export type LineVehicles = Schemas['LineVehicles'];
export type ServicePeriod = Schemas['ServicePeriod'];
export type DirectionTimetable = Schemas['DirectionTimetable'];
export type LineTimetable = Schemas['LineTimetable'];

export const DIRECTIONS: readonly Direction[] = ['asc', 'desc'];

/** Local time of the network, for display. */
export const TIMEZONE = 'Europe/Madrid';

/** Numeric identifiers first in numeric order (1, 2, …, 11), then the rest (B1, B2, B3). */
export function naturalCompare(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return compareCodePoints(a, b);
}

/** Plain code-point ordering, as Python compares strings (not locale-aware on purpose). */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Whole minutes from `now` until `expected` (floored, never negative). */
export function minutesUntil(expected: string | number, now: string | number): number {
  const expectedMs = typeof expected === 'number' ? expected : Date.parse(expected);
  const nowMs = typeof now === 'number' ? now : Date.parse(now);
  return Math.max(0, Math.floor((expectedMs - nowMs) / 60_000));
}

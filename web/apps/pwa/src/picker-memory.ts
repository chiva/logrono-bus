/**
 * Where the stop picker was left, so adding another stop starts there again.
 *
 * The map (shown or not, and the area it shows) and the search (what was typed, the stop just
 * chosen, or the position from «Cerca de mí») only last while the tab is open: the area shown after
 * «Cerca de mí» says where the person is. A position also expires after `HERE_MAX_AGE_MS`:
 * «paradas cerca de ti» from where the person was an hour ago would be wrong.
 *
 * Leaflet is loaded on demand, so nothing here may import values from the map module.
 */
import type { KeyValueStore } from '@logrono-bus/core';

import type { Here } from './views/stop-map.ts';

export const MAP_MEMORY_KEY = 'logrono-bus:mapa:v1';
export const PICKER_SEARCH_KEY = 'logrono-bus:busqueda:v1';
export const HERE_MAX_AGE_MS = 15 * 60_000;
export const MAP_MAX_ZOOM = 19;
/** Zoom the map comes to on the person or a chosen stop, unless it is already closer. */
export const CLOSE_UP_ZOOM = 17;

export interface MapView {
  readonly lat: number;
  readonly lon: number;
  readonly zoom: number;
}

export interface MapMemory {
  readonly open: boolean;
  readonly view: MapView | null;
}

export type PickerSearch =
  | { readonly kind: 'query'; readonly query: string }
  | { readonly kind: 'here'; readonly here: Here; readonly locatedAt: number }
  | { readonly kind: 'stop'; readonly stopId: string };

export const NO_MAP_MEMORY: MapMemory = { open: false, view: null };

type Fields = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null;
}

function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

function readJson(store: KeyValueStore, key: string): unknown {
  try {
    return JSON.parse(store.get(key) ?? 'null');
  } catch {
    return null;
  }
}

function asView(value: unknown): MapView | null {
  if (!isRecord(value)) return null;
  const { lat, lon, zoom } = value;
  if (!isCoordinate(lat, 90) || !isCoordinate(lon, 180)) return null;
  if (typeof zoom !== 'number' || !(zoom >= 0 && zoom <= MAP_MAX_ZOOM)) return null;
  return { lat, lon, zoom };
}

/** The position, if it is one: the browser may report coordinates that are not on Earth. */
export function validHere(value: unknown): Here | null {
  if (!isRecord(value)) return null;
  const { lat, lon, accuracyM } = value;
  if (!isCoordinate(lat, 90) || !isCoordinate(lon, 180)) return null;
  if (typeof accuracyM !== 'number' || !Number.isFinite(accuracyM) || accuracyM < 0) return null;
  return { lat, lon, accuracyM };
}

export function loadMapMemory(store: KeyValueStore): MapMemory {
  const stored = readJson(store, MAP_MEMORY_KEY);
  if (!isRecord(stored)) return NO_MAP_MEMORY;
  return { open: stored['open'] === true, view: asView(stored['view']) };
}

export function saveMapMemory(store: KeyValueStore, memory: MapMemory): void {
  store.set(MAP_MEMORY_KEY, JSON.stringify(memory));
}

/**
 * The last search, or null when there is none, it is malformed or its position is too old; then
 * it is also erased, so an expired position does not linger in the tab's storage.
 */
export function loadPickerSearch(store: KeyValueStore, now = Date.now()): PickerSearch | null {
  const search = parsePickerSearch(readJson(store, PICKER_SEARCH_KEY), now);
  if (!search) store.remove(PICKER_SEARCH_KEY);
  return search;
}

function parsePickerSearch(stored: unknown, now: number): PickerSearch | null {
  if (!isRecord(stored)) return null;
  switch (stored['kind']) {
    case 'query': {
      const query = stored['query'];
      return typeof query === 'string' && query.trim() ? { kind: 'query', query } : null;
    }
    case 'here': {
      const here = validHere(stored['here']);
      const locatedAt = stored['locatedAt'];
      if (!here || typeof locatedAt !== 'number') return null;
      const age = now - locatedAt;
      return age >= 0 && age <= HERE_MAX_AGE_MS ? { kind: 'here', here, locatedAt } : null;
    }
    case 'stop': {
      const stopId = stored['stopId'];
      return typeof stopId === 'string' && stopId ? { kind: 'stop', stopId } : null;
    }
    default:
      return null;
  }
}

export function savePickerSearch(store: KeyValueStore, search: PickerSearch | null): void {
  if (search) store.set(PICKER_SEARCH_KEY, JSON.stringify(search));
  else store.remove(PICKER_SEARCH_KEY);
}

/**
 * The search to come back to after choosing `stopId`: a typed search or the person's position
 * still describes where they are looking; otherwise the chosen stop does.
 */
export function searchAfterPicking(search: PickerSearch | null, stopId: string): PickerSearch {
  if (search?.kind === 'query' || search?.kind === 'here') return search;
  return { kind: 'stop', stopId };
}

/** The map centred on a point, closing in to `CLOSE_UP_ZOOM` but never zooming out. */
export function closeUpOn(lat: number, lon: number, current: MapView | null): MapView {
  return { lat, lon, zoom: Math.max(current?.zoom ?? 0, CLOSE_UP_ZOOM) };
}

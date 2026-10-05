import { MemoryStore } from '@logrono-bus/core';
import { describe, expect, it } from 'vitest';

import {
  CLOSE_UP_ZOOM,
  HERE_MAX_AGE_MS,
  MAP_MAX_ZOOM,
  MAP_MEMORY_KEY,
  NO_MAP_MEMORY,
  PICKER_SEARCH_KEY,
  type PickerSearch,
  closeUpOn,
  loadMapMemory,
  loadPickerSearch,
  saveMapMemory,
  savePickerSearch,
  searchAfterPicking,
  validHere,
} from '../src/picker-memory.ts';

/** Standing on stop 101, Ayuntamiento (contracts/fixtures/upstream/stops.json). */
const AT_STOP_101 = { lat: 42.46563, lon: -2.439249, accuracyM: 20 };
const PUERTA_DEL_SOL = { lat: 40.4168, lon: -3.7038, accuracyM: 20 };
const LOCATED_AT = Date.parse('2026-10-05T08:00:00Z');

function storeWith(key: string, raw: string): MemoryStore {
  const store = new MemoryStore();
  store.set(key, raw);
  return store;
}

describe('map memory', () => {
  it('starts hidden and nowhere in particular', () => {
    expect(loadMapMemory(new MemoryStore())).toEqual(NO_MAP_MEMORY);
  });

  it('round-trips whether the map was shown and the area it showed', () => {
    const store = new MemoryStore();
    const memory = { open: true, view: { lat: 42.47, lon: -2.45, zoom: 16 } };
    saveMapMemory(store, memory);
    expect(loadMapMemory(store)).toEqual(memory);
  });

  it.each([
    ['not JSON', '{'],
    ['not an object', '"abierto"'],
    ['null', 'null'],
  ])('ignores a stored value that is %s', (_, raw) => {
    expect(loadMapMemory(storeWith(MAP_MEMORY_KEY, raw))).toEqual(NO_MAP_MEMORY);
  });

  it.each([
    ['latitude out of range', { lat: 91, lon: 0, zoom: 15 }],
    ['longitude not a number', { lat: 42, lon: '-2.4', zoom: 15 }],
    ['zoom beyond the tiles', { lat: 42, lon: -2.4, zoom: MAP_MAX_ZOOM + 1 }],
    ['negative zoom', { lat: 42, lon: -2.4, zoom: -1 }],
    ['missing zoom', { lat: 42, lon: -2.4 }],
  ])('keeps the shown flag but drops a view with %s', (reason, view) => {
    const store = storeWith(MAP_MEMORY_KEY, JSON.stringify({ open: true, view }));
    expect(loadMapMemory(store), reason).toEqual({ open: true, view: null });
  });

  it('only a literal true means shown', () => {
    const store = storeWith(MAP_MEMORY_KEY, JSON.stringify({ open: 'true', view: null }));
    expect(loadMapMemory(store).open).toBe(false);
  });
});

describe('picker search memory', () => {
  const searches: [string, PickerSearch][] = [
    ['a typed search', { kind: 'query', query: 'ayunta' }],
    ['a chosen stop', { kind: 'stop', stopId: '101' }],
    ['a position', { kind: 'here', here: AT_STOP_101, locatedAt: LOCATED_AT }],
  ];

  it.each(searches)('round-trips %s', (_, search) => {
    const store = new MemoryStore();
    savePickerSearch(store, search);
    expect(loadPickerSearch(store, LOCATED_AT)).toEqual(search);
  });

  it('forgets the search when cleared', () => {
    const store = new MemoryStore();
    savePickerSearch(store, { kind: 'query', query: 'ayunta' });
    savePickerSearch(store, null);
    expect(store.get(PICKER_SEARCH_KEY)).toBeNull();
    expect(loadPickerSearch(store)).toBeNull();
  });

  it('keeps a position for HERE_MAX_AGE_MS and no longer', () => {
    const store = new MemoryStore();
    savePickerSearch(store, { kind: 'here', here: AT_STOP_101, locatedAt: LOCATED_AT });
    expect(loadPickerSearch(store, LOCATED_AT + HERE_MAX_AGE_MS)?.kind).toBe('here');
    expect(loadPickerSearch(store, LOCATED_AT + HERE_MAX_AGE_MS + 1)).toBeNull();
  });

  it('erases an expired position instead of keeping it in storage', () => {
    const store = new MemoryStore();
    savePickerSearch(store, { kind: 'here', here: AT_STOP_101, locatedAt: LOCATED_AT });
    loadPickerSearch(store, LOCATED_AT + HERE_MAX_AGE_MS + 1);
    expect(store.get(PICKER_SEARCH_KEY)).toBeNull();
  });

  it('distrusts a position from the future (a clock that went back)', () => {
    const store = new MemoryStore();
    savePickerSearch(store, { kind: 'here', here: AT_STOP_101, locatedAt: LOCATED_AT });
    expect(loadPickerSearch(store, LOCATED_AT - 1)).toBeNull();
  });

  it.each([
    ['not JSON', '{'],
    ['an unknown kind', JSON.stringify({ kind: 'mapa' })],
    ['a blank query', JSON.stringify({ kind: 'query', query: '   ' })],
    ['a query that is not text', JSON.stringify({ kind: 'query', query: 101 })],
    ['an empty stop id', JSON.stringify({ kind: 'stop', stopId: '' })],
    ['a position without time', JSON.stringify({ kind: 'here', here: AT_STOP_101 })],
    [
      'a position without accuracy',
      JSON.stringify({ kind: 'here', here: { lat: 42, lon: -2 }, locatedAt: LOCATED_AT }),
    ],
    [
      'a position with negative accuracy',
      JSON.stringify({
        kind: 'here',
        here: { ...AT_STOP_101, accuracyM: -5 },
        locatedAt: LOCATED_AT,
      }),
    ],
    [
      'a position off the globe',
      JSON.stringify({ kind: 'here', here: { ...AT_STOP_101, lon: 181 }, locatedAt: LOCATED_AT }),
    ],
  ])('ignores and erases %s', (reason, raw) => {
    const store = storeWith(PICKER_SEARCH_KEY, raw);
    expect(loadPickerSearch(store, LOCATED_AT), reason).toBeNull();
    expect(store.get(PICKER_SEARCH_KEY), reason).toBeNull();
  });

  it('after choosing a stop keeps a typed search or a position, else remembers the stop', () => {
    const typed: PickerSearch = { kind: 'query', query: 'ayunta' };
    const located: PickerSearch = { kind: 'here', here: AT_STOP_101, locatedAt: LOCATED_AT };
    expect(searchAfterPicking(typed, '100')).toBe(typed);
    expect(searchAfterPicking(located, '100')).toBe(located);
    expect(searchAfterPicking(null, '100')).toEqual({ kind: 'stop', stopId: '100' });
    expect(searchAfterPicking({ kind: 'stop', stopId: '101' }, '100')).toEqual({
      kind: 'stop',
      stopId: '100',
    });
  });
});

describe('map close-ups', () => {
  it('centres on the point and closes in to CLOSE_UP_ZOOM', () => {
    expect(closeUpOn(42.47, -2.45, null)).toEqual({ lat: 42.47, lon: -2.45, zoom: CLOSE_UP_ZOOM });
    expect(closeUpOn(42.47, -2.45, { lat: 0, lon: 0, zoom: 12 }).zoom).toBe(CLOSE_UP_ZOOM);
  });

  it('never zooms out of a closer view', () => {
    expect(closeUpOn(42.47, -2.45, { lat: 0, lon: 0, zoom: MAP_MAX_ZOOM }).zoom).toBe(MAP_MAX_ZOOM);
  });
});

describe('valid positions', () => {
  it.each([
    ['in Logroño', AT_STOP_101],
    ['anywhere else', PUERTA_DEL_SOL],
    ['with perfect accuracy', { ...AT_STOP_101, accuracyM: 0 }],
  ])('accepts a position %s', (_, here) => {
    expect(validHere(here)).toEqual(here);
  });

  it.each([
    ['NaN latitude', { ...AT_STOP_101, lat: Number.NaN }],
    ['infinite longitude', { ...AT_STOP_101, lon: Number.POSITIVE_INFINITY }],
    ['latitude past the pole', { ...AT_STOP_101, lat: 90.5 }],
    ['negative accuracy', { ...AT_STOP_101, accuracyM: -1 }],
    ['NaN accuracy', { ...AT_STOP_101, accuracyM: Number.NaN }],
    ['infinite accuracy', { ...AT_STOP_101, accuracyM: Number.POSITIVE_INFINITY }],
    ['nothing at all', null],
  ])('rejects %s', (reason, here) => {
    expect(validHere(here), reason).toBeNull();
  });
});

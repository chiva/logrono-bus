import { describe, expect, it } from 'vitest';

import {
  DirectionResolver,
  LineNotFound,
  StopNotFound,
  buildCards,
  isTerminus,
  patternPosition,
  type StopArrivals,
} from '../src/index.ts';
import { fixtureCatalog } from './fixtures.ts';

const catalog = fixtureCatalog();
const AYUNTAMIENTO = [42.4655, -2.439] as const;

describe('catalogue lookups', () => {
  it('finds stops near the Ayuntamiento, closest first', () => {
    const nearby = catalog.nearby(...AYUNTAMIENTO, { radiusM: 250 });
    expect(nearby.map((n) => n.stop.id)).toEqual(['101', '100', '2', '98', '28']);
    expect(catalog.nearby(...AYUNTAMIENTO, { radiusM: 10_000, limit: 3 })).toHaveLength(3);
    expect(catalog.nearby(0, 0)).toEqual([]);
  });

  it('searches without accents and ranks an exact stop number first', () => {
    expect(catalog.search('ZUBIA').map((s) => s.id)).toEqual(['28', '803']);
    expect(catalog.search('ayunta').map((s) => s.id)).toEqual(['100', '101', '2', '98']);
    expect(catalog.search('69')[0]?.id).toBe('69');
    expect(catalog.search('   ')).toEqual([]);
    expect(catalog.search('a', { limit: 2 })).toHaveLength(2);
  });

  it('raises typed errors for unknown ids', () => {
    expect(() => catalog.stop('424242')).toThrow(StopNotFound);
    expect(() => catalog.line('8')).toThrow(LineNotFound);
    expect(catalog.findStop('424242')).toBeUndefined();
    expect(catalog.pattern('2:sideways')).toBeUndefined();
    expect(catalog.patternsAt('nowhere')).toEqual([]);
  });

  it('exposes patterns with positions and termini', () => {
    const pattern = catalog.pattern('2:desc')!;
    expect(patternPosition(pattern, '101')).toBe(9);
    expect(patternPosition(pattern, '100')).toBeNull();
    expect(isTerminus(pattern, '56')).toBe(true);
    expect(catalog.patternsForLine('31').map((p) => p.id)).toEqual(['31:asc', '31:desc']);
    expect(catalog.patternsAt('101').map((p) => p.id)).toEqual([
      '2:desc',
      '5:asc',
      '7:desc',
      '10:desc',
    ]);
  });
});

describe('direction resolution', () => {
  const resolve = (resolver: DirectionResolver, ...args: [string, string, number | null, string]) =>
    resolver.resolve(...args)?.id ?? null;

  it('settles single-direction stops and termini by order', () => {
    const resolver = new DirectionResolver(catalog);
    expect(resolve(resolver, '2', '101', null, '')).toBe('2:desc');
    expect(resolve(resolver, '2', '5', 23, '')).toBe('2:asc');
    expect(resolve(resolver, '2', '5', 1, '')).toBe('2:desc');
    expect(resolve(resolver, '2', '5', 7, '')).toBeNull();
    expect(resolve(resolver, '1', '101', 3, '402')).toBeNull();
  });

  it('learns directionRef codes per line', () => {
    const resolver = new DirectionResolver(catalog);
    expect(resolve(resolver, '2', '5', null, '320')).toBeNull();
    expect(resolve(resolver, '2', '5', 23, '320')).toBe('2:asc');
    expect(resolve(resolver, '2', '5', null, '320')).toBe('2:asc');
    expect(resolve(resolver, '10', '5', null, '320')).toBeNull();
  });
});

describe('cards edge cases', () => {
  const empty: StopArrivals = {
    stop_id: '101',
    generated_at: '2026-10-03T18:00:00+02:00',
    arrivals: [],
  };

  it('raises for an unknown stop and keeps empty cards', () => {
    expect(() => buildCards(catalog, { stop_id: '424242', lines: [] }, empty)).toThrow(
      StopNotFound,
    );
    const cards = buildCards(catalog, { stop_id: '101', lines: [] }, empty, 0);
    expect(cards.map((card) => card.line_label)).toEqual(['2', '5', '7', '10']);
  });

  it('collapses duplicate selection items', () => {
    const selection = {
      stop_id: '101',
      lines: [
        { line_id: '2', direction: 'desc' as const },
        { line_id: '2', direction: 'desc' as const },
      ],
    };
    expect(buildCards(catalog, selection, empty)).toHaveLength(1);
  });

  it('ignores arrivals for another stop', () => {
    const foreign: StopArrivals = {
      ...empty,
      arrivals: [
        {
          stop_id: '100',
          line_id: '2',
          pattern_id: '2:asc',
          direction: 'asc',
          headsign: 'Artesanos',
          aimed: '2026-10-03T18:05:00+02:00',
          expected: '2026-10-03T18:05:00+02:00',
          minutes: 5,
          delay_s: 0,
          is_realtime: true,
          is_approximate: false,
          terminates: false,
          cancelled: false,
          vehicle_id: '1',
        },
      ],
    };
    expect(
      buildCards(catalog, { stop_id: '101', lines: [] }, foreign).every(
        (c) => c.arrivals.length === 0,
      ),
    ).toBe(true);
  });
});

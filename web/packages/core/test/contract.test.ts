/**
 * Golden contract: the TypeScript normaliser must produce exactly what the Python library
 * produced for the same recorded upstream responses (contracts/fixtures/expected).
 */
import { describe, expect, it } from 'vitest';

import {
  DirectionResolver,
  buildCards,
  normalizeArrivals,
  parseArrivals,
  normalizeVehicles,
  parseSelection,
  parseVehicles,
  normalizeTimetable,
  parseTimetable,
  serviceStatus,
  sortCards,
  timetableFor,
} from '../src/index.ts';
import { MANIFEST, fixtureCatalog, loadFixture } from './fixtures.ts';

const catalog = fixtureCatalog();
const arrivalsByName = new Map(MANIFEST.arrivals.map((testCase) => [testCase.name, testCase]));

function arrivalsFor(name: string) {
  const testCase = arrivalsByName.get(name)!;
  return normalizeArrivals(
    parseArrivals(loadFixture(testCase.upstream)),
    testCase.stop_id,
    catalog,
    new DirectionResolver(catalog),
    testCase.now,
  );
}

const cardsByName = new Map(MANIFEST.cards.map((testCase) => [testCase.name, testCase]));

function cardsFor(name: string) {
  const testCase = cardsByName.get(name)!;
  const [selection] = parseSelection(testCase.p);
  return buildCards(catalog, selection!, arrivalsFor(testCase.arrivals), testCase.limit);
}

describe('golden contract shared with the Python library', () => {
  it('normalises the catalogue identically', () => {
    expect(catalog.catalog).toEqual(loadFixture(MANIFEST.catalog.expected));
  });

  it.each(MANIFEST.arrivals.map((testCase) => [testCase.name, testCase] as const))(
    'normalises arrivals: %s',
    (_name, testCase) => {
      expect(arrivalsFor(testCase.name)).toEqual(loadFixture(testCase.expected));
    },
  );

  it.each(MANIFEST.cards.map((testCase) => [testCase.name, testCase] as const))(
    'groups cards: %s',
    (_name, testCase) => {
      expect(cardsFor(testCase.name)).toEqual(loadFixture(testCase.expected));
    },
  );

  it.each(MANIFEST.sorts.map((testCase) => [testCase.name, testCase] as const))(
    'orders cards: %s',
    (_name, testCase) => {
      // Python writes a missing direction as None.
      const keys = sortCards(cardsFor(testCase.cards), testCase.order).map(
        (card) => `${card.line_label}:${card.direction ?? 'None'}:${card.stop_id}`,
      );
      expect(keys).toEqual(loadFixture(testCase.expected));
    },
  );

  it.each(MANIFEST.vehicles.map((testCase) => [testCase.name, testCase] as const))(
    'normalises vehicle positions: %s',
    (_name, testCase) => {
      const result = normalizeVehicles(
        parseVehicles(loadFixture(testCase.upstream)),
        testCase.line_id,
        catalog,
        testCase.now,
      );
      expect(result).toEqual(loadFixture(testCase.expected));
    },
  );
});

const timetablesByName = new Map(MANIFEST.timetables.map((testCase) => [testCase.name, testCase]));

function timetableFor_(name: string) {
  const testCase = timetablesByName.get(name)!;
  return normalizeTimetable(
    parseTimetable(loadFixture(testCase.upstream)),
    testCase.line_id,
    catalog,
    testCase.now,
  );
}

describe('timetables, shared with the Python library', () => {
  it.each(MANIFEST.timetables.map((testCase) => [testCase.name, testCase] as const))(
    'normalises the timetable: %s',
    (_name, testCase) => {
      expect(timetableFor_(testCase.name)).toEqual(loadFixture(testCase.expected));
    },
  );

  it.each(MANIFEST.services.map((testCase) => [testCase.name, testCase] as const))(
    'says where the line stands in its day: %s',
    (_name, testCase) => {
      const direction = timetableFor(timetableFor_(testCase.timetable), testCase.pattern_id);
      expect(testCase.at.map((at) => serviceStatus(direction, at))).toEqual(
        loadFixture(testCase.expected),
      );
    },
  );
});

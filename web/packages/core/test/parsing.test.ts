import { describe, expect, it } from 'vitest';

import {
  UpstreamSchemaError,
  normalizeLine,
  parseArrivals,
  parseLines,
  parseStops,
  parseTimetable,
} from '../src/index.ts';
import { loadFixture } from './fixtures.ts';

const arrival = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  lineRef: '2',
  directionRef: '321',
  vehicleRef: '55',
  stopPointRef: '101',
  order: 9,
  aimedArrivalTime: '2026-10-03T17:48:36+02:00',
  expectedArrivalTime: '2026-10-03T17:59:18+02:00',
  arrivalStatus: 'NO_REPORT',
  cancellation: false,
  predictionInaccurate: true,
  delaySeconds: 642,
  ...overrides,
});

const wrap = (...items: unknown[]) => ({ result: { arrivals: items } });

function schemaPath(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(UpstreamSchemaError);
    return (error as UpstreamSchemaError).path;
  }
  throw new Error('no error raised');
}

describe('upstream parsing', () => {
  it('normalises identifiers and keeps timestamps canonical', () => {
    const [parsed] = parseArrivals(
      wrap(arrival({ stopPointRef: '0101', lineRef: 2, vehicleRef: '' })),
    );
    expect(parsed).toMatchObject({ stopId: '101', lineId: '2', vehicleRef: '', delayS: 642 });
    expect(parsed?.expected).toBe('2026-10-03T17:59:18+02:00');
  });

  it('defaults optional fields', () => {
    const minimal = {
      lineRef: '2',
      stopPointRef: '101',
      aimedArrivalTime: '2026-10-03T17:48:36+02:00',
      expectedArrivalTime: '2026-10-03T17:59:18+02:00',
    };
    expect(parseArrivals(wrap(minimal))[0]).toMatchObject({
      directionRef: '',
      order: null,
      cancelled: false,
      inaccurate: false,
      delayS: 0,
    });
    expect(
      parseStops({ result: { stops: [{ id: 1, name: 'A', lat: 1, lng: 2 }] } })[0]?.lineIds,
    ).toEqual([]);
  });

  it.each([
    [[], '$'],
    [{}, '$.result'],
    [{ result: { arrivals: {} } }, '$.result.arrivals'],
    [wrap('x'), '$.result.arrivals[0]'],
    [wrap(arrival({ lineRef: null })), '$.result.arrivals[0].lineRef'],
    [wrap(arrival({ lineRef: '' })), '$.result.arrivals[0].lineRef'],
    [wrap(arrival({ lineRef: true })), '$.result.arrivals[0].lineRef'],
    [wrap(arrival({ order: '9' })), '$.result.arrivals[0].order'],
    [wrap(arrival({ expectedArrivalTime: 'mañana' })), '$.result.arrivals[0].expectedArrivalTime'],
    [wrap(arrival({ cancellation: 'no' })), '$.result.arrivals[0].cancellation'],
    [wrap(arrival({ delaySeconds: 1.5 })), '$.result.arrivals[0].delaySeconds'],
    [wrap(arrival({ arrivalStatus: 3 })), '$.result.arrivals[0].arrivalStatus'],
  ])('reports the offending path (%#)', (payload, path) => {
    expect(schemaPath(() => parseArrivals(payload))).toBe(path);
  });

  it('falls back to the departure time when the arrival time is empty', () => {
    const [parsed] = parseArrivals(
      wrap(
        arrival({
          aimedArrivalTime: '',
          expectedArrivalTime: ' ',
          aimedDepartureTime: '2026-10-03T17:50:00+02:00',
          expectedDepartureTime: '2026-10-03T18:01:00+02:00',
        }),
      ),
    );
    expect(parsed).toMatchObject({
      aimed: '2026-10-03T17:50:00+02:00',
      expected: '2026-10-03T18:01:00+02:00',
    });
  });

  it.each([
    [arrival({ aimedArrivalTime: '' })],
    [arrival({ expectedArrivalTime: '', expectedDepartureTime: null })],
    [arrival({ aimedArrivalTime: '', aimedDepartureTime: '' })],
  ])('skips an arrival without any time and keeps the rest (%#)', (untimed) => {
    const parsed = parseArrivals(
      wrap(arrival({ vehicleRef: '61' }), untimed, arrival({ vehicleRef: '62' })),
    );
    expect(parsed.map((a) => a.vehicleRef)).toEqual(['61', '62']);
  });

  it.each([
    [{ aimedArrivalTime: null }, '$.result.arrivals[0].aimedArrivalTime'],
    [
      { aimedArrivalTime: '', aimedDepartureTime: 'mañana' },
      '$.result.arrivals[0].aimedDepartureTime',
    ],
    [
      { expectedArrivalTime: '', expectedDepartureTime: 0 },
      '$.result.arrivals[0].expectedDepartureTime',
    ],
  ])('still rejects malformed arrival times (%#)', (overrides, path) => {
    expect(schemaPath(() => parseArrivals(wrap(arrival(overrides))))).toBe(path);
  });

  it('reports missing fields', () => {
    const incomplete = arrival();
    delete incomplete['aimedArrivalTime'];
    expect(() => parseArrivals(wrap(incomplete))).toThrow('falta el campo');
  });

  it('validates lines and stops', () => {
    expect(
      schemaPath(() => parseLines({ result: { lines: [{ id: 1, name: 'x', color: '#fff000' }] } })),
    ).toBe('$.result.lines[0].stops');
    expect(
      schemaPath(() =>
        parseLines({
          result: {
            lines: [{ id: 1, name: 'x', color: '#fff000', stops: { asc: [1], desc: [] } }],
          },
        }),
      ),
    ).toBe('$.result.lines[0].stops.asc[0]');
    expect(
      schemaPath(() =>
        parseStops({ result: { stops: [{ id: 1, name: 'A', lat: '42', lng: -2 }] } }),
      ),
    ).toBe('$.result.stops[0].lat');
    expect(
      schemaPath(() =>
        parseStops({ result: { stops: [{ id: 1, name: 'A', lat: 42, lng: -2, lines: '2' }] } }),
      ),
    ).toBe('$.result.stops[0].lines');
  });

  it('wraps bad line colours as schema errors', () => {
    expect(() =>
      normalizeLine({ id: '99', name: 'X', colour: 'verde', asc: [], desc: [] }),
    ).toThrow(/line\[99\]\.color/);
    expect(
      normalizeLine({ id: '99', name: 'ESPECIAL', colour: '#123456', asc: [], desc: [] }),
    ).toMatchObject({
      label: 'ESPECIAL',
      name: 'ESPECIAL',
      text_colour: '#FFFFFF',
    });
  });
});

describe('timetable parsing', () => {
  it('reads each direction and pads clock times like Python', () => {
    const directions = parseTimetable(loadFixture('upstream/timetable-sintetico.json'));
    expect(directions.map((d) => d.name)).toEqual(['Ida', 'Circular']);
    expect(directions[0]?.passes.slice(0, 3)).toEqual(['06:30', '06:42', '06:57']);
    expect(directions[0]?.frequencies[0]).toEqual({
      first: '06:30',
      last: '08:00',
      intervalMin: 12,
      intervalMaxMin: 15,
    });
    expect(directions[0]?.frequencies[1]?.intervalMaxMin).toBeNull();
  });

  it.each([
    [{}, '$.result'],
    [{ result: { passesByDirection: {} } }, '$.result.frequenciesByDirection'],
    [
      { result: { frequenciesByDirection: {}, passesByDirection: { Ida: ['7h05'] } } },
      '$.result.passesByDirection.Ida[0]',
    ],
    [
      { result: { frequenciesByDirection: {}, passesByDirection: { Ida: ['30:00'] } } },
      '$.result.passesByDirection.Ida[0]',
    ],
    [
      { result: { frequenciesByDirection: {}, passesByDirection: { Ida: ['07:60'] } } },
      '$.result.passesByDirection.Ida[0]',
    ],
    [
      {
        result: {
          frequenciesByDirection: { Ida: [{ firstPass: '07:00', lastPass: '08:00' }] },
          passesByDirection: {},
        },
      },
      '$.result.frequenciesByDirection.Ida[0].intervalMinutes',
    ],
  ])('names the offending path (%#), as the Python parser does', (payload, path) => {
    expect(() => parseTimetable(payload)).toThrow(
      expect.objectContaining({ name: 'UpstreamSchemaError', path }),
    );
  });
});

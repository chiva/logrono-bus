import { describe, expect, it } from 'vitest';

import {
  BLACK,
  WHITE,
  canonicalTimestamp,
  clockMinutes,
  describeInterval,
  localDate,
  localMinutes,
  serviceStatus,
  compareCodePoints,
  contrastRatio,
  distanceM,
  fold,
  minutesUntil,
  naturalCompare,
  parseColour,
  splitLineName,
  textColourFor,
  titleEs,
} from '../src/index.ts';

describe('colour', () => {
  it.each([
    ['rgba(1,255,1,1)', '#01FF01'],
    ['rgba(253, 130, 187, 0.5)', '#FD82BB'],
    ['rgb(0,2,253)', '#0002FD'],
    ['#0fdcfc', '#0FDCFC'],
    ['269905', '#269905'],
  ])('parses %s', (raw, expected) => {
    expect(parseColour(raw)).toBe(expected);
  });

  it.each(['', 'red', '#12345', 'rgba(256,0,0,1)', 'rgba(1,2)'])('rejects %j', (raw) => {
    expect(() => parseColour(raw)).toThrow(/olor/);
  });

  it.each([
    ['#FFFF00', BLACK],
    ['#BABABA', BLACK],
    ['#0002FD', WHITE],
    ['#924C48', WHITE],
    ['#C100FB', BLACK],
  ])('picks legible text on %s', (background, text) => {
    expect(textColourFor(background)).toBe(text);
    expect(contrastRatio(background, text)).toBeGreaterThanOrEqual(4.5);
  });

  it('bounds the contrast ratio', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1);
  });
});

describe('text', () => {
  it('folds case, accents and spacing', () => {
    expect(fold('  Glorieta Dr.   ZUBÍA ')).toBe('glorieta dr. zubia');
    expect(fold('Yagüe')).toBe(fold('YAGUE'));
  });

  it.each([
    ['PALACIO DE CONGRESOS', 'Palacio de Congresos'],
    ['EL ARCO', 'El Arco'],
    ['CASA DE LAS CIENCIAS Y EL RÍO', 'Casa de las Ciencias y el Río'],
  ])('title-cases %s', (raw, expected) => {
    expect(titleEs(raw)).toBe(expected);
  });

  it('splits upstream line names', () => {
    expect(splitLineName('B3-LARDERO-EL CAMPILLO')).toEqual(['B3', 'Lardero – El Campillo']);
    expect(splitLineName('NOCTURNO')).toEqual(['NOCTURNO', '']);
  });
});

describe('ordering and time', () => {
  it('sorts identifiers naturally', () => {
    expect(['10', 'B1', '2', '33', '1', 'A'].sort(naturalCompare)).toEqual([
      '1',
      '2',
      '10',
      '33',
      'A',
      'B1',
    ]);
    expect(compareCodePoints('a', 'a')).toBe(0);
  });

  it.each([
    [-30, 0],
    [0, 0],
    [59, 0],
    [60, 1],
    [119, 1],
    [600, 10],
  ])('floors and clamps minutes (%is → %i min)', (seconds, minutes) => {
    const now = Date.parse('2026-10-03T16:00:00Z');
    expect(minutesUntil(now + seconds * 1000, now)).toBe(minutes);
  });

  it('computes minutes from ISO strings', () => {
    expect(minutesUntil('2026-10-03T18:10:00+02:00', '2026-10-03T16:00:00Z')).toBe(10);
  });

  it('measures distances like the Python library', () => {
    expect(distanceM(42, -2, 43, -2)).toBeCloseTo(111_195, -1);
    expect(distanceM(42.4655, -2.439, 42.4655, -2.439)).toBe(0);
  });
});

describe('canonical timestamps (Python isoformat parity)', () => {
  it.each([
    ['2026-10-03T17:36:44+02:00', '2026-10-03T17:36:44+02:00'],
    ['2026-10-03T17:36:44Z', '2026-10-03T17:36:44+00:00'],
    ['2026-10-03T17:36:44.000Z', '2026-10-03T17:36:44+00:00'],
    ['2026-10-03T17:36:44.123Z', '2026-10-03T17:36:44.123000+00:00'],
    ['2026-10-03T17:36+0200', '2026-10-03T17:36:00+02:00'],
    ['2026-10-03 17:36:44-03', '2026-10-03T17:36:44-03:00'],
  ])('%s → %s', (raw, expected) => {
    expect(canonicalTimestamp(raw, 'x')).toBe(expected);
  });

  it.each([
    ['2026-10-03T17:36:44', 'sin zona horaria'],
    ['mañana', 'no válida'],
    ['2026-13-45T17:36:44Z', 'no válida'],
  ])('rejects %s', (raw, message) => {
    expect(() => canonicalTimestamp(raw, 'x')).toThrow(message);
  });
});

describe('timetable helpers', () => {
  it('words a headway', () => {
    expect(describeInterval(30)).toBe('cada 30 min');
    expect(describeInterval(30, 30)).toBe('cada 30 min');
    expect(describeInterval(12, 15)).toBe('cada 12–15 min');
  });

  it('reads clock times, keeping after-midnight ones past the day', () => {
    expect(clockMinutes('07:05')).toBe(425);
    expect(clockMinutes('24:30')).toBe(1470);
  });

  it('knows the date and time in Logroño, summer and winter', () => {
    expect(localDate('2026-10-03T22:45:12Z')).toBe('2026-10-04');
    expect(localMinutes('2026-10-03T22:45:12Z')).toBe(45);
    expect(localMinutes('2026-12-24T23:05:00Z')).toBe(5);
    expect(localDate('2026-12-24T23:05:00Z')).toBe('2026-12-25');
  });

  it('has no service without a timetable', () => {
    expect(serviceStatus(undefined, '2026-10-04T10:00:00Z').state).toBe('sin_servicio');
  });
});

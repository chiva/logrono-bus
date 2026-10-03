import { describe, expect, it } from 'vitest';

import {
  DEFAULTS,
  DEFAULT_PREVIOUS_STOPS,
  InvalidSelection,
  MAX_PREVIOUS_STOPS,
  MIN_PREVIOUS_STOPS,
  clampPreviousStops,
  clampTextScale,
  displayPreferencesOf,
  sanitizePreferences,
  UnsupportedVersion,
  filterArrivals,
  formatBoardConfig,
  formatSelection,
  parseBoardConfig,
  parseSelection,
  type StopArrivals,
} from '../src/index.ts';
import { loadFixture } from './fixtures.ts';

interface SelectionCases {
  valid: { p: string; stops: unknown }[];
  invalid: string[];
}

const cases = loadFixture<SelectionCases>('selection.json');

describe('selection codec (shared corpus)', () => {
  it.each(cases.valid.map((c) => [c.p, c] as const))(
    'parses and round-trips %s',
    (_p, testCase) => {
      const parsed = parseSelection(testCase.p);
      expect(parsed).toEqual(testCase.stops);
      expect(formatSelection(parsed)).toBe(testCase.p);
    },
  );

  it.each(cases.invalid)('rejects %j', (value) => {
    expect(() => parseSelection(value)).toThrow(InvalidSelection);
  });

  it('filters arrivals by selection', () => {
    const arrivals: StopArrivals = {
      stop_id: '101',
      generated_at: '2026-10-03T18:00:00+02:00',
      arrivals: [
        { line_id: '2', direction: 'desc' },
        { line_id: '2', direction: null },
        { line_id: '5', direction: 'asc' },
      ].map((partial) => ({
        stop_id: '101',
        pattern_id: null,
        headsign: null,
        aimed: '2026-10-03T18:05:00+02:00',
        expected: '2026-10-03T18:05:00+02:00',
        minutes: 5,
        delay_s: 0,
        is_realtime: true,
        is_approximate: false,
        terminates: false,
        cancelled: false,
        vehicle_id: null,
        ...partial,
      })) as StopArrivals['arrivals'],
    };
    const [selection] = parseSelection('101-2d');
    expect(filterArrivals(selection!, arrivals).arrivals).toHaveLength(1);
    const [any] = parseSelection('101-2x');
    expect(filterArrivals(any!, arrivals).arrivals).toHaveLength(2);
  });
});

describe('board URL config', () => {
  it('returns null without a selection (start page)', () => {
    expect(parseBoardConfig('')).toBeNull();
    expect(parseBoardConfig('?tema=oscuro')).toBeNull();
  });

  it('reads every parameter', () => {
    const config = parseBoardConfig(
      'v=1&p=101-2d~100-2a&tema=tinta&modo=kiosko&n=2&titulo=%20Casa%20&origen=servidor' +
        '&api=http://192.168.1.10:8000/api/v1/&tam=124&color=suave&letra=legible&aviso=5&efecto=borde' +
        '&orden=llegada&previas=6',
    );
    expect(config).toEqual({
      stops: parseSelection('101-2d~100-2a'),
      theme: 'tinta',
      mode: 'kiosko',
      perCard: 2,
      title: 'Casa',
      source: 'servidor',
      api: 'http://192.168.1.10:8000/api/v1',
      textScale: 120,
      colour: 'suave',
      font: 'legible',
      alertMinutes: 5,
      effect: 'borde',
      order: 'llegada',
      previousStops: 6,
    });
  });

  it('falls back to defaults on bad presentation values', () => {
    const config = parseBoardConfig(
      'p=101&tema=rosa&modo=x&n=99&origen=?&api=ftp://x&tam=500&color=neon&letra=x&aviso=-3&efecto=x',
    );
    expect(config).toMatchObject({ ...DEFAULTS, perCard: 4, textScale: 150, alertMinutes: 0 });
    expect(parseBoardConfig('p=101&tam=grande')?.textScale).toBe(100);
    expect(parseBoardConfig('p=101&n=0')?.perCard).toBe(1);
    expect(parseBoardConfig('p=101&n=dos')?.perCard).toBe(DEFAULTS.perCard);
    expect(parseBoardConfig('p=101&api=no%20url')?.api).toBeNull();
    expect(parseBoardConfig('p=101&titulo=' + 'x'.repeat(80))?.title).toHaveLength(40);
    expect(parseBoardConfig('p=101&previas=99')?.previousStops).toBe(MAX_PREVIOUS_STOPS);
    expect(parseBoardConfig('p=101&previas=0')?.previousStops).toBe(MIN_PREVIOUS_STOPS);
    expect(parseBoardConfig('p=101&previas=x')?.previousStops).toBe(DEFAULT_PREVIOUS_STOPS);
  });

  it('refuses newer versions and invalid selections', () => {
    expect(() => parseBoardConfig('v=2&p=101')).toThrow(UnsupportedVersion);
    expect(() => parseBoardConfig('p=101-2q')).toThrow(InvalidSelection);
  });

  it('formats short URLs, omitting defaults', () => {
    const minimal = parseBoardConfig('p=101-2d.5a~100-2a')!;
    expect(formatBoardConfig(minimal)).toBe('v=1&p=101-2d.5a~100-2a');
    const full = parseBoardConfig(
      'p=101&tema=oscuro&modo=kiosko&n=2&titulo=Mi casa&origen=directa&tam=130&color=intensa' +
        '&letra=mono&aviso=0&efecto=ninguno&previas=7',
    )!;
    const formatted = formatBoardConfig(full);
    expect(formatted).toBe(
      'v=1&p=101&tema=oscuro&modo=kiosko&n=2&titulo=Mi+casa&tam=130&color=intensa&letra=mono' +
        '&aviso=0&efecto=ninguno&previas=7&origen=directa',
    );
    expect(parseBoardConfig(formatted)).toEqual(full);
    expect(() => formatBoardConfig({ ...minimal, stops: [] })).toThrow(InvalidSelection);
  });
});

describe('display preferences', () => {
  it('fill in what the link does not set, and never override it', () => {
    const preferences = { theme: 'tinta' as const, textScale: 140, font: 'legible' as const };
    expect(parseBoardConfig('p=101', preferences)).toMatchObject(preferences);
    expect(parseBoardConfig('p=101&tema=claro&tam=90', preferences)).toMatchObject({
      theme: 'claro',
      textScale: 90,
      font: 'legible',
    });
  });

  it('are sanitised (storage can hold anything)', () => {
    expect(sanitizePreferences(null)).toEqual({});
    expect(sanitizePreferences('x')).toEqual({});
    expect(
      sanitizePreferences({
        theme: 'oscuro',
        textScale: 117,
        colour: 'neon',
        font: 'redondeada',
        alertMinutes: 99,
        effect: 'borde',
        order: 'linea',
        previousStops: 2.6,
        extra: true,
      }),
    ).toEqual({
      theme: 'oscuro',
      textScale: 120,
      font: 'redondeada',
      alertMinutes: 15,
      effect: 'borde',
      order: 'linea',
      previousStops: 3,
    });
    expect(sanitizePreferences({ order: 'azar', previousStops: '4' })).toEqual({});
    expect(clampTextScale(10)).toBe(80);
    expect(clampPreviousStops(-2)).toBe(MIN_PREVIOUS_STOPS);
    expect(clampPreviousStops(40)).toBe(MAX_PREVIOUS_STOPS);
  });

  it('round-trip through a board', () => {
    const config = parseBoardConfig('p=101&tam=110&color=suave')!;
    expect(displayPreferencesOf(config)).toEqual({
      theme: 'auto',
      textScale: 110,
      colour: 'suave',
      font: 'sistema',
      alertMinutes: 3,
      effect: 'pulso',
      order: 'seleccion',
      previousStops: DEFAULT_PREVIOUS_STOPS,
    });
  });
});

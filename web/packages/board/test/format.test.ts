import type { Arrival } from '@logrono-bus/core';
import { describe, expect, it } from 'vitest';

import { formatAge, formatClock, timeLabel } from '../src/index.ts';

const NOW = Date.parse('2026-10-03T16:00:00Z');

const arrival = (expected: string, extra: Partial<Arrival> = {}): Arrival => ({
  stop_id: '101',
  line_id: '2',
  pattern_id: '2:desc',
  direction: 'desc',
  headsign: 'Manresa',
  aimed: expected,
  expected,
  minutes: 0,
  delay_s: 0,
  is_realtime: true,
  is_approximate: false,
  terminates: false,
  cancelled: false,
  vehicle_id: '55',
  ...extra,
});

describe('time labels', () => {
  it('counts down in minutes', () => {
    expect(timeLabel(arrival('2026-10-03T16:04:30Z'), NOW)).toEqual({
      value: '4',
      unit: 'min',
      spoken: 'en 4 minutos',
    });
    expect(timeLabel(arrival('2026-10-03T16:01:10Z'), NOW).spoken).toBe('en 1 minuto');
  });

  it('says "Llegando" under a minute and when overdue', () => {
    expect(timeLabel(arrival('2026-10-03T16:00:40Z'), NOW).value).toBe('Llegando');
    expect(timeLabel(arrival('2026-10-03T15:59:30Z'), NOW).value).toBe('Llegando');
  });

  it('switches to clock time (Madrid) from an hour away', () => {
    expect(timeLabel(arrival('2026-10-03T17:15:00Z'), NOW)).toEqual({
      value: '19:15',
      unit: '',
      spoken: 'a las 19:15',
    });
    expect(formatClock('2026-12-24T23:05:00Z')).toBe('00:05');
  });

  it('marks cancellations', () => {
    expect(timeLabel(arrival('2026-10-03T16:04:30Z', { cancelled: true }), NOW).value).toBe(
      'Cancelado',
    );
  });

  it('describes data age', () => {
    expect(formatAge(-5)).toBe('hace 0 s');
    expect(formatAge(42_000)).toBe('hace 42 s');
    expect(formatAge(185_000)).toBe('hace 3 min');
  });
});

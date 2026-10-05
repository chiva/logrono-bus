import type { Stop } from '@logrono-bus/core';
import { describe, expect, it } from 'vitest';

import { fixtureCatalog } from '../../../packages/core/test/fixtures.ts';
import { tooltipFor } from '../src/views/stop-map.ts';

const catalog = fixtureCatalog();

describe('stop map tooltip', () => {
  it('names the stop and shows its lines as pills in their colours', () => {
    const stop = catalog.stop('101');
    const tooltip = tooltipFor(stop, catalog);

    expect(tooltip.querySelector('.name')?.textContent).toBe('Ayuntamiento · nº 101');
    const badges = [...tooltip.querySelectorAll<HTMLElement>('.lines .badge')];
    const expected = stop.line_ids.map((lineId) => catalog.line(lineId));
    expect(badges.map((badge) => badge.textContent)).toEqual(expected.map((line) => line.label));
    badges.forEach((badge, index) => {
      const line = expected[index]!;
      expect(badge.style.getPropertyValue('--line-colour'), `line ${line.label}`).toBe(line.colour);
      expect(badge.style.getPropertyValue('--line-text'), `line ${line.label}`).toBe(
        line.text_colour,
      );
    });
  });

  it('puts upstream names in as text, never as HTML', () => {
    const stop: Stop = { ...catalog.stop('101'), name: '<img src=x onerror=alert(1)>' };
    const tooltip = tooltipFor(stop, catalog);

    expect(tooltip.querySelector('img')).toBeNull();
    expect(tooltip.querySelector('.name')?.textContent).toBe(
      '<img src=x onerror=alert(1)> · nº 101',
    );
  });
});

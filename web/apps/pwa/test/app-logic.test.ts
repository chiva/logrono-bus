import { MemoryStore, parseBoardConfig } from '@logrono-bus/core';
import { describe, expect, it, vi } from 'vitest';

import { fixtureCatalog } from '../../../packages/core/test/fixtures.ts';
import { boardUrl, wizardHref } from '../src/context.ts';
import {
  FROZEN_AFTER_MS,
  GUARD_TICK_MS,
  KioskGuard,
  RELOAD_EVERY_MS,
  keepScreenOn,
} from '../src/kiosk-guard.ts';
import {
  MAX_SAVED_BOARDS,
  SAVED_BOARDS_KEY,
  DISPLAY_KEY,
  forgetBoard,
  loadDisplayPreferences,
  loadSavedBoards,
  resetDisplayPreferences,
  saveBoard,
  saveDisplayPreferences,
  savedTheme,
} from '../src/preferences.ts';
import { route } from '../src/router.ts';
import { boardTitle } from '../src/views/panel.ts';
import { qrSvg } from '../src/views/share.ts';
import { destinationsSummary } from '../src/views/stop-picker.ts';
import { boardablePatterns, selectionFor } from '../src/views/wizard.ts';

const catalog = fixtureCatalog();

describe('router', () => {
  it.each([
    ['', '', 'home'],
    ['?tema=oscuro', '', 'home'],
    ['', '#acerca', 'about'],
    ['', '#asistente', 'wizard'],
    ['?v=1&p=101', '', 'panel'],
    ['?v=1&p=101&modo=kiosko', '', 'kiosk'],
    ['?v=1&p=101-2q', '', 'invalid'],
    ['?v=9&p=101', '', 'invalid'],
  ])('routes %j %j to %s', (search, hash, view) => {
    expect(route(search, hash).view).toBe(view);
  });

  it('opens the wizard pre-filled when editing a board', () => {
    const result = route('', '#asistente/v=1&p=101-2d&titulo=Casa');
    expect(result).toMatchObject({ view: 'wizard', initial: { title: 'Casa' } });
    expect(route('', '#asistente/v=1&p=101-2q').view).toBe('invalid');
  });

  it('rethrows programming errors', () => {
    expect(() => route(null as unknown as string, '')).toThrow();
  });
});

describe('links', () => {
  it('builds absolute board URLs and wizard links', () => {
    expect(boardUrl('v=1&p=101', 'https://chiva.github.io/logrono-bus/?v=1&p=9#x')).toBe(
      'https://chiva.github.io/logrono-bus/?v=1&p=101',
    );
    expect(wizardHref()).toBe('./#asistente');
    expect(wizardHref('v=1&p=101')).toBe('./#asistente/v=1&p=101');
  });

  it('renders a scalable QR code locally', () => {
    const svg = qrSvg('https://chiva.github.io/logrono-bus/?v=1&p=101');
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('viewBox');
  });
});

describe('preferences', () => {
  it('stores display defaults, merging and ignoring invalid values', () => {
    const store = new MemoryStore();
    expect(savedTheme(store)).toBe('auto');
    saveDisplayPreferences(store, { theme: 'tinta', textScale: 130 });
    saveDisplayPreferences(store, { alertMinutes: 5 });
    expect(loadDisplayPreferences(store)).toEqual({
      theme: 'tinta',
      textScale: 130,
      alertMinutes: 5,
    });
    expect(savedTheme(store)).toBe('tinta');
    store.set(DISPLAY_KEY, '{"theme":"rosa","textScale":999,"font":"comic","effect":"pulso"}');
    expect(loadDisplayPreferences(store)).toEqual({ textScale: 150, effect: 'pulso' });
    store.set(DISPLAY_KEY, '{"effect":"rayas"}');
    expect(loadDisplayPreferences(store)).toEqual({ effect: 'rayas' });
    store.set(DISPLAY_KEY, 'not json');
    expect(loadDisplayPreferences(store)).toEqual({});
    resetDisplayPreferences(store);
    expect(store.get(DISPLAY_KEY)).toBeNull();
  });

  it('applies device defaults where the board link does not say otherwise', () => {
    const preferences = { theme: 'oscuro' as const, textScale: 120 };
    const fromDevice = route('?v=1&p=101', '', preferences);
    expect(fromDevice).toMatchObject({ config: { theme: 'oscuro', textScale: 120 } });
    const fromLink = route('?v=1&p=101&tema=claro&tam=90', '', preferences);
    expect(fromLink).toMatchObject({ config: { theme: 'claro', textScale: 90 } });
  });

  it('saves boards most recent first, deduplicated and capped', () => {
    const store = new MemoryStore();
    saveBoard(store, ' Casa ', 'v=1&p=101');
    saveBoard(store, '', 'v=1&p=100');
    const boards = saveBoard(store, 'Casa (nuevo)', 'v=1&p=101');
    expect(boards.map((b) => b.name)).toEqual(['Casa (nuevo)', 'Mi panel']);
    for (let i = 0; i < MAX_SAVED_BOARDS + 5; i += 1) saveBoard(store, `P${i}`, `v=1&p=${i}`);
    expect(loadSavedBoards(store)).toHaveLength(MAX_SAVED_BOARDS);
    expect(forgetBoard(store, `v=1&p=${MAX_SAVED_BOARDS + 4}`)).toHaveLength(MAX_SAVED_BOARDS - 1);
  });

  it('survives corrupt storage', () => {
    const store = new MemoryStore();
    store.set(SAVED_BOARDS_KEY, '{oops');
    expect(loadSavedBoards(store)).toEqual([]);
    store.set(SAVED_BOARDS_KEY, '{"a":1}');
    expect(loadSavedBoards(store)).toEqual([]);
    store.set(SAVED_BOARDS_KEY, '[{"name":"ok","query":"p=1"},{"name":3},null]');
    expect(loadSavedBoards(store)).toEqual([{ name: 'ok', query: 'p=1' }]);
  });
});

describe('wizard helpers', () => {
  it('lists boardable directions, skipping trips that end at the stop', () => {
    expect(boardablePatterns(catalog, '101').map((p) => p.id)).toEqual([
      '2:desc',
      '5:asc',
      '7:desc',
      '10:desc',
    ]);
    expect(boardablePatterns(catalog, '5').map((p) => p.id)).toEqual([
      '2:desc',
      '10:desc',
      '31:asc',
    ]);
  });

  it('collapses a full selection to the bare stop', () => {
    expect(selectionFor(catalog, '101', new Set(['2d', '5a', '7d', '10d']))).toEqual({
      stop_id: '101',
      lines: [],
    });
    expect(selectionFor(catalog, '101', new Set(['2d', '10d']))).toEqual({
      stop_id: '101',
      lines: [
        { line_id: '2', direction: 'desc' },
        { line_id: '10', direction: 'desc' },
      ],
    });
  });

  it('summarises destinations to tell same-named stops apart', () => {
    expect(destinationsSummary(catalog, '101')).toBe(
      'hacia Manresa, Dinamarca, Enrique Granados y Manuel de Falla',
    );
    expect(destinationsSummary(catalog, '2')).toBe('hacia Iglesia de Lardero');
    expect(destinationsSummary(catalog, 'nowhere')).toBe('final de trayecto');
  });

  it('titles boards from the config or the stop names', () => {
    const config = parseBoardConfig('p=101~100~2')!;
    expect(boardTitle(config, catalog)).toBe('Ayuntamiento');
    expect(boardTitle(parseBoardConfig('p=101~69')!, catalog)).toBe('Ayuntamiento · Portales');
    expect(boardTitle(parseBoardConfig('p=101&titulo=Casa')!, catalog)).toBe('Casa');
    expect(boardTitle(config, undefined)).toBe('Parada 101 · Parada 100 · Parada 2');
  });
});

describe('KioskGuard', () => {
  function harness(online = true) {
    let now = 0;
    let tick: (() => void) | undefined;
    const frozen = vi.fn();
    const reload = vi.fn();
    const guard = new KioskGuard({
      onFrozen: frozen,
      reload,
      isOnline: () => online,
      now: () => now,
      setTimer: (callback) => {
        tick = callback;
        return 1;
      },
      clearTimer: () => {
        tick = undefined;
      },
    });
    guard.start();
    return {
      advance(ms: number) {
        now += ms;
        tick?.();
      },
      frozen,
      reload,
      guard,
    };
  }

  it('detects a frozen tab from a gap between ticks', () => {
    const h = harness();
    h.advance(GUARD_TICK_MS);
    expect(h.frozen).not.toHaveBeenCalled();
    h.advance(FROZEN_AFTER_MS + 1);
    expect(h.frozen).toHaveBeenCalledWith(FROZEN_AFTER_MS + 1);
  });

  it('reloads after six hours, only when online', () => {
    const offline = harness(false);
    offline.advance(RELOAD_EVERY_MS);
    expect(offline.reload).not.toHaveBeenCalled();
    const online = harness(true);
    online.advance(RELOAD_EVERY_MS);
    expect(online.reload).toHaveBeenCalledOnce();
    online.advance(GUARD_TICK_MS);
    expect(online.reload).toHaveBeenCalledOnce();
  });

  it('tolerates devices without the Wake Lock API', async () => {
    const release = await keepScreenOn();
    expect(() => release()).not.toThrow();
  });
});

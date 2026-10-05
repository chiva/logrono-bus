/**
 * Per-device preferences and saved boards, kept in localStorage. Everything here is a
 * convenience: a board URL alone always works, on any device, with nothing stored.
 */
import {
  type Colour,
  DEFAULTS,
  type DisplayPreferences,
  type Effect,
  type Font,
  type Order,
  type KeyValueStore,
  SafeStorage,
  type Theme,
  sanitizePreferences,
} from '@logrono-bus/core';

/** Read by the pre-paint script in index.html too: keep the key and the `theme` field in sync. */
export const DISPLAY_KEY = 'logrono-bus:pantalla:v1';
export const SAVED_BOARDS_KEY = 'logrono-bus:paneles:v1';
export const MAX_SAVED_BOARDS = 20;

export interface SavedBoard {
  readonly name: string;
  /** Query string of the board, without the leading "?". */
  readonly query: string;
  readonly savedAt: string;
}

export const THEME_NAMES: Readonly<Record<Theme, string>> = {
  auto: 'Automático',
  claro: 'Claro',
  oscuro: 'Oscuro',
  'alto-contraste': 'Alto contraste',
  logrono: 'Logroño',
  tinta: 'Tinta',
};

export function browserStore(): KeyValueStore {
  return new SafeStorage(() => globalThis.localStorage);
}

/** Like `browserStore()`, but forgotten when the tab is closed. */
export function tabStore(): KeyValueStore {
  return new SafeStorage(() => globalThis.sessionStorage);
}

export const COLOUR_NAMES: Readonly<Record<Colour, string>> = {
  suave: 'Suave',
  normal: 'Normal',
  intensa: 'Intensa',
};

export const FONT_NAMES: Readonly<Record<Font, string>> = {
  sistema: 'La del sistema',
  legible: 'Muy legible (Atkinson Hyperlegible)',
  redondeada: 'Redondeada',
  mono: 'Tipo panel (monoespaciada)',
};

export const ORDER_NAMES: Readonly<Record<Order, string>> = {
  seleccion: 'Como las elegí',
  linea: 'Por número de línea',
  llegada: 'El que llega antes, primero',
};

export const EFFECT_NAMES: Readonly<Record<Effect, string>> = {
  pulso: 'Parpadeo suave',
  borde: 'Borde fijo',
  ninguno: 'Sin efecto',
};

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', theme);
}

/** This device's display defaults; a board URL's own parameters always win over them. */
export function loadDisplayPreferences(store: KeyValueStore): Partial<DisplayPreferences> {
  try {
    return sanitizePreferences(JSON.parse(store.get(DISPLAY_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

export function saveDisplayPreferences(
  store: KeyValueStore,
  preferences: Partial<DisplayPreferences>,
): Partial<DisplayPreferences> {
  const merged = sanitizePreferences({ ...loadDisplayPreferences(store), ...preferences });
  store.set(DISPLAY_KEY, JSON.stringify(merged));
  return merged;
}

export function resetDisplayPreferences(store: KeyValueStore): void {
  store.remove(DISPLAY_KEY);
}

export function savedTheme(store: KeyValueStore): Theme {
  return loadDisplayPreferences(store).theme ?? DEFAULTS.theme;
}

export function loadSavedBoards(store: KeyValueStore): SavedBoard[] {
  try {
    const parsed: unknown = JSON.parse(store.get(SAVED_BOARDS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedBoard =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as SavedBoard).name === 'string' &&
        typeof (item as SavedBoard).query === 'string',
    );
  } catch {
    return [];
  }
}

/** Save (or rename) a board; the same query is stored once, most recent first. */
export function saveBoard(
  store: KeyValueStore,
  name: string,
  query: string,
  now = new Date(),
): SavedBoard[] {
  const entry: SavedBoard = { name: name.trim() || 'Mi panel', query, savedAt: now.toISOString() };
  const boards = [entry, ...loadSavedBoards(store).filter((b) => b.query !== query)].slice(
    0,
    MAX_SAVED_BOARDS,
  );
  store.set(SAVED_BOARDS_KEY, JSON.stringify(boards));
  return boards;
}

export function forgetBoard(store: KeyValueStore, query: string): SavedBoard[] {
  const boards = loadSavedBoards(store).filter((b) => b.query !== query);
  store.set(SAVED_BOARDS_KEY, JSON.stringify(boards));
  return boards;
}

/**
 * Board configuration ⇄ URL query string. The URL is the only source of truth for a board: it
 * can be bookmarked, shared as a QR code, opened on an Echo Show or embedded in Home Assistant.
 *
 *   ?v=1&p=101-2d.5a~100-2a&tema=oscuro&modo=kiosko&n=2&titulo=Casa
 *     &tam=120&color=suave&letra=legible&aviso=3&efecto=pulso&orden=llegada&previas=4
 *     &origen=auto&api=…
 *
 * Only `p` is required; every other parameter is omitted from generated URLs when it has its
 * default value, keeping links short enough to type on a touch screen. Display parameters missing
 * from a URL fall back to the device's saved preferences, then to the built-in defaults.
 */
import { InvalidSelection, LogronoBusError } from './errors.ts';
import { DEFAULT_ARRIVALS_PER_CARD } from './cards.ts';
import { DEFAULT_PREVIOUS_STOPS, MAX_PREVIOUS_STOPS, MIN_PREVIOUS_STOPS } from './route.ts';
import { type StopSelection, formatSelection, parseSelection } from './selection.ts';

export const CONFIG_VERSION = 1;
export const THEMES = ['auto', 'claro', 'oscuro', 'alto-contraste', 'logrono', 'tinta'] as const;
export const MODES = ['panel', 'kiosko'] as const;
export const SOURCES = ['auto', 'directa', 'servidor'] as const;
export const COLOURS = ['suave', 'normal', 'intensa'] as const;
export const FONTS = ['sistema', 'legible', 'redondeada', 'mono'] as const;
export const EFFECTS = ['pulso', 'borde', 'ninguno'] as const;
export const ORDERS = ['seleccion', 'linea', 'llegada'] as const;
export const MIN_PER_CARD = 1;
export const MAX_PER_CARD = 4;
export const MAX_TITLE_LENGTH = 40;
export const MIN_TEXT_SCALE = 80;
export const MAX_TEXT_SCALE = 150;
export const TEXT_SCALE_STEP = 10;
export const MAX_ALERT_MINUTES = 15;

export type Theme = (typeof THEMES)[number];
export type Mode = (typeof MODES)[number];
export type SourceChoice = (typeof SOURCES)[number];
export type Colour = (typeof COLOURS)[number];
export type Font = (typeof FONTS)[number];
export type Effect = (typeof EFFECTS)[number];
export type Order = (typeof ORDERS)[number];

export interface BoardConfig {
  readonly stops: readonly StopSelection[];
  readonly theme: Theme;
  readonly mode: Mode;
  readonly perCard: number;
  readonly title: string | null;
  readonly source: SourceChoice;
  /** Base URL of a logrono-bus server (`…/api/v1`), when not the page's own origin. */
  readonly api: string | null;
  /** Text size, percent of normal (80–150). */
  readonly textScale: number;
  /** Line colour intensity on cards. */
  readonly colour: Colour;
  readonly font: Font;
  /** Highlight a card whose next bus is this many minutes away or less; 0 turns it off. */
  readonly alertMinutes: number;
  /** How the highlight looks. */
  readonly effect: Effect;
  /** Card order: as selected, by line number, or soonest bus first. */
  readonly order: Order;
  /** Stops shown before yours in the route view (fewer if the screen has no room). */
  readonly previousStops: number;
}

/** Display settings a device can remember as its own defaults. */
export type DisplayPreferences = Pick<
  BoardConfig,
  'theme' | 'textScale' | 'colour' | 'font' | 'alertMinutes' | 'effect' | 'order' | 'previousStops'
>;

export const PARAM = {
  version: 'v',
  selection: 'p',
  theme: 'tema',
  mode: 'modo',
  perCard: 'n',
  title: 'titulo',
  source: 'origen',
  api: 'api',
  textScale: 'tam',
  colour: 'color',
  font: 'letra',
  alertMinutes: 'aviso',
  effect: 'efecto',
  order: 'orden',
  previousStops: 'previas',
} as const;

export const DEFAULTS: Omit<BoardConfig, 'stops'> = {
  theme: 'auto',
  mode: 'panel',
  perCard: DEFAULT_ARRIVALS_PER_CARD,
  title: null,
  source: 'auto',
  api: null,
  textScale: 100,
  colour: 'normal',
  font: 'sistema',
  alertMinutes: 3,
  effect: 'pulso',
  order: 'seleccion',
  previousStops: DEFAULT_PREVIOUS_STOPS,
};

/** The link was made by a newer version of the app. */
export class UnsupportedVersion extends LogronoBusError {
  override name = 'UnsupportedVersion';
}

function oneOf<T extends string>(allowed: readonly T[], value: string | null, fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function intFrom(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Text scale snapped to the 10 % steps the settings offer. */
export function clampTextScale(value: number): number {
  const snapped = Math.round(value / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;
  return Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, snapped));
}

/** Previous stops for the route view, whole and within the range the settings offer. */
export function clampPreviousStops(value: number): number {
  return Math.min(MAX_PREVIOUS_STOPS, Math.max(MIN_PREVIOUS_STOPS, Math.round(value)));
}

/** Keep only valid display preferences (they come from storage, which anyone can edit). */
export function sanitizePreferences(value: unknown): Partial<DisplayPreferences> {
  if (typeof value !== 'object' || value === null) return {};
  const raw = value as Record<string, unknown>;
  const result: { -readonly [K in keyof DisplayPreferences]?: DisplayPreferences[K] } = {};
  const text = (key: string): string | null => (typeof raw[key] === 'string' ? raw[key] : null);
  const num = (key: string): number | null =>
    typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? raw[key] : null;
  if ((THEMES as readonly string[]).includes(text('theme') ?? ''))
    result.theme = text('theme') as Theme;
  if ((COLOURS as readonly string[]).includes(text('colour') ?? ''))
    result.colour = text('colour') as Colour;
  if ((FONTS as readonly string[]).includes(text('font') ?? '')) result.font = text('font') as Font;
  if ((EFFECTS as readonly string[]).includes(text('effect') ?? ''))
    result.effect = text('effect') as Effect;
  if ((ORDERS as readonly string[]).includes(text('order') ?? ''))
    result.order = text('order') as Order;
  const scale = num('textScale');
  if (scale !== null) result.textScale = clampTextScale(scale);
  const alert = num('alertMinutes');
  if (alert !== null)
    result.alertMinutes = Math.min(MAX_ALERT_MINUTES, Math.max(0, Math.round(alert)));
  const previous = num('previousStops');
  if (previous !== null) result.previousStops = clampPreviousStops(previous);
  return result;
}

function apiFrom(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Parse a board from a query string. Returns null when there is no selection (show the start
 * page); throws `InvalidSelection` / `UnsupportedVersion` with a Spanish message otherwise.
 * Unknown or out-of-range presentation values fall back to defaults rather than failing: a typo in
 * `tema` should not take a kitchen screen down.
 */
export function parseBoardConfig(
  query: string | URLSearchParams,
  preferences: Partial<DisplayPreferences> = {},
): BoardConfig | null {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  const version = params.get(PARAM.version);
  if (version !== null && version !== String(CONFIG_VERSION)) {
    throw new UnsupportedVersion(
      `Este enlace es de una versión más nueva (v=${version}); recarga la página para actualizarla.`,
    );
  }
  const selection = params.get(PARAM.selection);
  if (selection === null) return null;
  const title = params.get(PARAM.title)?.trim().slice(0, MAX_TITLE_LENGTH) || null;
  const base = { ...DEFAULTS, ...sanitizePreferences(preferences) };
  const scale = params.get(PARAM.textScale);
  return {
    stops: parseSelection(selection),
    theme: oneOf(THEMES, params.get(PARAM.theme), base.theme),
    mode: oneOf(MODES, params.get(PARAM.mode), DEFAULTS.mode),
    perCard: intFrom(params.get(PARAM.perCard), DEFAULTS.perCard, MIN_PER_CARD, MAX_PER_CARD),
    title,
    source: oneOf(SOURCES, params.get(PARAM.source), DEFAULTS.source),
    api: apiFrom(params.get(PARAM.api)),
    textScale:
      scale === null || Number.isNaN(Number.parseInt(scale, 10))
        ? base.textScale
        : clampTextScale(Number.parseInt(scale, 10)),
    colour: oneOf(COLOURS, params.get(PARAM.colour), base.colour),
    font: oneOf(FONTS, params.get(PARAM.font), base.font),
    alertMinutes: intFrom(params.get(PARAM.alertMinutes), base.alertMinutes, 0, MAX_ALERT_MINUTES),
    effect: oneOf(EFFECTS, params.get(PARAM.effect), base.effect),
    order: oneOf(ORDERS, params.get(PARAM.order), base.order),
    previousStops: intFrom(
      params.get(PARAM.previousStops),
      base.previousStops,
      MIN_PREVIOUS_STOPS,
      MAX_PREVIOUS_STOPS,
    ),
  };
}

/** The display settings of a board, as a device would save them. */
export function displayPreferencesOf(config: BoardConfig): DisplayPreferences {
  const { theme, textScale, colour, font, alertMinutes, effect, order, previousStops } = config;
  return { theme, textScale, colour, font, alertMinutes, effect, order, previousStops };
}

/** Inverse of `parseBoardConfig`; built-in defaults are left out. */
export function formatBoardConfig(config: BoardConfig): string {
  if (config.stops.length === 0) throw new InvalidSelection('La selección está vacía');
  const params = new URLSearchParams({ [PARAM.version]: String(CONFIG_VERSION) });
  params.set(PARAM.selection, formatSelection(config.stops));
  if (config.theme !== DEFAULTS.theme) params.set(PARAM.theme, config.theme);
  if (config.mode !== DEFAULTS.mode) params.set(PARAM.mode, config.mode);
  if (config.perCard !== DEFAULTS.perCard) params.set(PARAM.perCard, String(config.perCard));
  if (config.title) params.set(PARAM.title, config.title);
  if (config.textScale !== DEFAULTS.textScale)
    params.set(PARAM.textScale, String(config.textScale));
  if (config.colour !== DEFAULTS.colour) params.set(PARAM.colour, config.colour);
  if (config.font !== DEFAULTS.font) params.set(PARAM.font, config.font);
  if (config.alertMinutes !== DEFAULTS.alertMinutes) {
    params.set(PARAM.alertMinutes, String(config.alertMinutes));
  }
  if (config.effect !== DEFAULTS.effect) params.set(PARAM.effect, config.effect);
  if (config.order !== DEFAULTS.order) params.set(PARAM.order, config.order);
  if (config.previousStops !== DEFAULTS.previousStops) {
    params.set(PARAM.previousStops, String(config.previousStops));
  }
  if (config.source !== DEFAULTS.source) params.set(PARAM.source, config.source);
  if (config.api) params.set(PARAM.api, config.api);
  // `~` is RFC 3986 unreserved; URLSearchParams escapes it anyway, which only makes links longer.
  return params.toString().replace(/%7E/g, '~');
}

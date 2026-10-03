/**
 * Card configuration (YAML or the visual editor). Option names are Spanish and match the web's
 * URL parameters where they mean the same thing (orden, aviso, efecto, color, letra, tam, previas).
 */
import {
  COLOURS,
  type CardOrder,
  type Colour,
  DEFAULTS,
  EFFECTS,
  type Effect,
  FONTS,
  type Font,
  MAX_ALERT_MINUTES,
  ORDERS,
  clampPreviousStops,
  clampTextScale,
} from '@logrono-bus/core';

export const CARD_TYPE = 'logrono-bus-card';
export const MODES = ['normal', 'pantalla'] as const;
export type CardMode = (typeof MODES)[number];

export interface CardConfig {
  readonly type: string;
  readonly entities: readonly string[];
  readonly titulo?: string;
  readonly orden: CardOrder;
  readonly aviso: number;
  readonly efecto: Effect;
  readonly color: Colour;
  readonly letra: Font;
  readonly tam: number;
  /** `pantalla`: cards fill the dashboard view, large type, no scrolling (wall screens). */
  readonly modo: CardMode;
  /** Tap a card to see the route and where the buses are. */
  readonly recorrido: boolean;
  /** Stops shown before yours in the route. */
  readonly previas: number;
}

export class CardConfigError extends Error {
  override name = 'CardConfigError';
}

const pick = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/** Validate a user's configuration; unknown or out-of-range values fall back to defaults. */
export function normalizeConfig(raw: unknown): CardConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new CardConfigError('La configuración de la tarjeta no es válida.');
  }
  const config = raw as Record<string, unknown>;
  const entities = config['entities'];
  if (!Array.isArray(entities) || entities.length === 0) {
    throw new CardConfigError(
      'Indica al menos un sensor en «entities» (los de Logroño Bus terminados en _minutos).',
    );
  }
  const aviso = Number(config['aviso'] ?? DEFAULTS.alertMinutes);
  const tam = Number(config['tam'] ?? DEFAULTS.textScale);
  const previas = Number(config['previas'] ?? DEFAULTS.previousStops);
  const titulo = config['titulo'];
  return {
    type: typeof config['type'] === 'string' ? config['type'] : `custom:${CARD_TYPE}`,
    entities: entities.filter((e): e is string => typeof e === 'string'),
    ...(typeof titulo === 'string' && titulo.trim() ? { titulo: titulo.trim() } : {}),
    orden: pick(ORDERS, config['orden'], DEFAULTS.order),
    aviso: Number.isFinite(aviso)
      ? Math.min(MAX_ALERT_MINUTES, Math.max(0, Math.round(aviso)))
      : DEFAULTS.alertMinutes,
    efecto: pick(EFFECTS, config['efecto'], DEFAULTS.effect),
    color: pick(COLOURS, config['color'], DEFAULTS.colour),
    letra: pick(FONTS, config['letra'], DEFAULTS.font),
    tam: Number.isFinite(tam) ? clampTextScale(tam) : DEFAULTS.textScale,
    modo: pick(MODES, config['modo'], 'normal'),
    recorrido: config['recorrido'] !== false,
    previas: Number.isFinite(previas) ? clampPreviousStops(previas) : DEFAULTS.previousStops,
  };
}

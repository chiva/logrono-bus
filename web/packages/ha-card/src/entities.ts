/**
 * Home Assistant sensors → cards. Each `sensor.…_minutos` (or `…_proxima_llegada`) entity of the
 * Logroño Bus integration carries everything a card needs in its attributes, so the dashboard
 * card draws exactly what the web draws without fetching anything itself.
 */
import { cardKey } from '@logrono-bus/board';
import {
  type Arrival,
  type Card,
  type Direction,
  SERVICE_STATES,
  type ServiceState,
  type ServiceStatus,
} from '@logrono-bus/core';

import type { HassEntity, HomeAssistant } from './ha.ts';

export const INTEGRATION_ATTRIBUTE = 'linea_id';

interface UpcomingAttribute {
  readonly hora: string;
  readonly tiempo_real: boolean;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number | null => (typeof value === 'number' ? value : null);

function direction(value: unknown): Direction | null {
  return value === 'asc' || value === 'desc' ? value : null;
}

function upcoming(value: unknown): UpcomingAttribute[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is UpcomingAttribute =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as UpcomingAttribute).hora === 'string' &&
      typeof (item as UpcomingAttribute).tiempo_real === 'boolean',
  );
}

/** Whether an entity comes from the Logroño Bus integration (it has the card attributes). */
export function isBusEntity(entity: HassEntity | undefined): entity is HassEntity {
  return entity !== undefined && text(entity.attributes[INTEGRATION_ATTRIBUTE]) !== null;
}

/** One card from one sensor; null if the entity is missing or not a Logroño Bus sensor. */
export function cardFromEntity(entity: HassEntity | undefined): Card | null {
  if (!isBusEntity(entity)) return null;
  const a = entity.attributes;
  const stopId = text(a['parada_id']) ?? '';
  const lineId = text(a['linea_id']) ?? '';
  const dir = direction(a['sentido']);
  const headsign = text(a['destino']);
  const patternId = dir ? `${lineId}:${dir}` : null;
  const arrivals: Arrival[] = upcoming(a['llegadas']).map((item) => ({
    stop_id: stopId,
    line_id: lineId,
    pattern_id: patternId,
    direction: dir,
    headsign,
    aimed: item.hora,
    expected: item.hora,
    minutes: 0,
    delay_s: 0,
    is_realtime: item.tiempo_real,
    is_approximate: false,
    terminates: false,
    cancelled: false,
    vehicle_id: null,
  }));
  return {
    stop_id: stopId,
    stop_name: text(a['parada']) ?? stopId,
    line_id: lineId,
    line_label: text(a['linea']) ?? lineId,
    line_name: text(a['nombre_linea']) ?? '',
    colour: text(a['color']) ?? '#888888',
    text_colour: text(a['color_texto']) ?? '#000000',
    direction: dir,
    headsign: dir ? headsign : null,
    arrivals,
  };
}

/**
 * Cards for the configured entities, one per line and direction: the "próxima llegada" and
 * "minutos" sensors of the same line both describe one card, so duplicates collapse.
 */
export function cardsFromHass(hass: HomeAssistant, entityIds: readonly string[]): Card[] {
  const seen = new Set<string>();
  const cards: Card[] = [];
  for (const entityId of entityIds) {
    const card = cardFromEntity(hass.states[entityId]);
    if (!card) continue;
    const key = cardKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(card);
  }
  return cards;
}

/** Every Logroño Bus "minutos" sensor, for the card's starting configuration. */
export function busMinuteSensors(hass: HomeAssistant): string[] {
  return Object.values(hass.states)
    .filter((entity): entity is HassEntity => isBusEntity(entity))
    .filter((entity) => entity.attributes['unit_of_measurement'] === 'min')
    .map((entity) => entity.entity_id)
    .sort();
}

/** Where the line stands in its day, from the sensor's timetable attributes (`servicio`, …). */
export function serviceFromEntity(entity: HassEntity | undefined): ServiceStatus | null {
  if (!isBusEntity(entity)) return null;
  const a = entity.attributes;
  const state = a['servicio'];
  if (!(SERVICE_STATES as readonly unknown[]).includes(state)) return null;
  return {
    state: state as ServiceState,
    first: text(a['primera_salida']),
    last: text(a['ultima_salida']),
    next_departure: text(a['proxima_salida']),
    interval_min: count(a['frecuencia_min']),
    interval_max_min: count(a['frecuencia_max_min']),
  };
}

/** The service of each configured line, keyed like the cards (`cardKey`). */
export function servicesFromHass(
  hass: HomeAssistant,
  entityIds: readonly string[],
): Map<string, ServiceStatus> {
  const services = new Map<string, ServiceStatus>();
  for (const entityId of entityIds) {
    const entity = hass.states[entityId];
    const card = cardFromEntity(entity);
    const service = serviceFromEntity(entity);
    if (card && service) services.set(cardKey(card), service);
  }
  return services;
}

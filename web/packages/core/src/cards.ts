/** Card grouping; mirror of `logrono_bus.cards` (see its docstring for the rules). */
import { type CatalogIndex, isTerminus } from './catalog.ts';
import type { Arrival, Card, StopArrivals } from './models.ts';
import { compareCodePoints, naturalCompare } from './models.ts';
import { type LineSelection, type StopSelection, directionCode, lineMatches } from './selection.ts';

export const DEFAULT_ARRIVALS_PER_CARD = 3;

const slotKey = (slot: LineSelection): string => `${slot.line_id}${directionCode(slot.direction)}`;

function slotsFor(catalog: CatalogIndex, selection: StopSelection): LineSelection[] {
  if (selection.lines.length > 0) return [...selection.lines];
  return catalog
    .patternsAt(selection.stop_id)
    .filter((pattern) => !isTerminus(pattern, selection.stop_id))
    .map((pattern) => ({ line_id: pattern.line_id, direction: pattern.direction }));
}

export function buildCards(
  catalog: CatalogIndex,
  selection: StopSelection,
  arrivals: StopArrivals,
  limit: number = DEFAULT_ARRIVALS_PER_CARD,
): Card[] {
  const stop = catalog.stop(selection.stop_id);
  const slots: LineSelection[] = [];
  const buckets = new Map<string, Arrival[]>();
  for (const slot of slotsFor(catalog, selection)) {
    if (!catalog.hasLine(slot.line_id) || buckets.has(slotKey(slot))) continue;
    slots.push(slot);
    buckets.set(slotKey(slot), []);
  }

  for (const arrival of arrivals.arrivals) {
    if (arrival.stop_id !== stop.id) continue;
    let target = slots.find((slot) => lineMatches(slot, arrival));
    if (
      !target &&
      arrival.direction === null &&
      selection.lines.length === 0 &&
      catalog.hasLine(arrival.line_id)
    ) {
      target = { line_id: arrival.line_id, direction: null };
      slots.push(target);
      buckets.set(slotKey(target), []);
    }
    if (target) buckets.get(slotKey(target))?.push(arrival);
  }

  return slots.map((slot) => {
    const line = catalog.line(slot.line_id);
    const pattern = slot.direction
      ? catalog.pattern(`${slot.line_id}:${slot.direction}`)
      : undefined;
    return {
      stop_id: stop.id,
      stop_name: stop.name,
      line_id: line.id,
      line_label: line.label,
      line_name: line.name,
      colour: line.colour,
      text_colour: line.text_colour,
      direction: slot.direction,
      headsign: pattern?.headsign ?? null,
      arrivals: (buckets.get(slotKey(slot)) ?? []).slice(0, limit),
    };
  });
}

/** Card orders a board offers; mirror of `logrono_bus.cards.CardOrder`. */
export type CardOrder = 'seleccion' | 'linea' | 'llegada';

/** Epoch ms of the next bus that will actually come, or null. */
export function nextArrivalMs(card: Card): number | null {
  const next = card.arrivals.find((arrival) => !arrival.cancelled);
  return next ? Date.parse(next.expected) : null;
}

const byLine = (a: Card, b: Card): number =>
  naturalCompare(a.line_label, b.line_label) ||
  compareCodePoints(a.headsign ?? '', b.headsign ?? '') ||
  compareCodePoints(a.stop_name, b.stop_name) ||
  compareCodePoints(a.stop_id, b.stop_id);

/**
 * Order a board's cards. `seleccion` keeps the order the user chose; `linea` sorts by line number
 * (1, 2, …, 10, B1…); `llegada` puts the soonest bus first, cards with nothing due last. Stable, so
 * equal keys keep their selection order.
 */
export function sortCards(cards: readonly Card[], order: CardOrder): Card[] {
  if (order === 'seleccion') return [...cards];
  if (order === 'linea') return [...cards].sort(byLine);
  return [...cards].sort((a, b) => {
    const left = nextArrivalMs(a);
    const right = nextArrivalMs(b);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return left - right || naturalCompare(a.line_label, b.line_label);
  });
}

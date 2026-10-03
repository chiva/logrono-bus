/**
 * Which direction an upstream arrival belongs to; mirror of
 * `logrono_bus.providers.logrono.directions` (see its docstring for the evidence behind it).
 */
import { type CatalogIndex, patternPosition } from './catalog.ts';
import type { Pattern } from './models.ts';

export class DirectionResolver {
  readonly #catalog: CatalogIndex;
  readonly #learned = new Map<string, string>();

  constructor(catalog: CatalogIndex) {
    this.#catalog = catalog;
  }

  resolve(
    lineId: string,
    stopId: string,
    order: number | null,
    directionRef: string,
  ): Pattern | null {
    const candidates = this.#catalog.patternsAt(stopId).filter((p) => p.line_id === lineId);
    const settled = DirectionResolver.#settle(candidates, stopId, order);
    const key = `${lineId}\u0000${directionRef}`;
    if (settled) {
      if (directionRef) this.#learned.set(key, settled.id);
      return settled;
    }
    const learned = directionRef ? this.#learned.get(key) : undefined;
    return learned ? (candidates.find((p) => p.id === learned) ?? null) : null;
  }

  static #settle(
    candidates: readonly Pattern[],
    stopId: string,
    order: number | null,
  ): Pattern | null {
    if (candidates.length === 1) return candidates[0] ?? null;
    if (order === null) return null;
    const byPosition = candidates.filter((p) => patternPosition(p, stopId) === order);
    return byPosition.length === 1 ? (byPosition[0] ?? null) : null;
  }
}

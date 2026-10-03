/**
 * `<lb-card-grid>`: lays out cards — in the chosen order, filling a fixed screen in kiosk layout,
 * and sliding cards to their new places when the order changes. Pure presentation: the web board
 * and the Home Assistant card both feed it cards.
 */
import {
  type Card,
  type CardOrder,
  type Colour,
  type Effect,
  type ServiceStatus,
  sortCards,
} from '@logrono-bus/core';
import { LitElement, type PropertyDeclarations, css, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { type CardVariant } from './lb-card.ts';
import './lb-card.ts';

export type GridLayout = 'auto' | 'kiosk';

/** How long a card takes to slide to its new place when the order changes. */
export const MOVE_DURATION_MS = 650;
/** How much a card that moves up (its bus is now sooner) grows mid-slide, to catch the eye. */
export const OVERTAKE_SCALE = 1.05;
/** Width/height a card reads best at: wide enough for "→ Manuel de Falla" beside the badge. */
export const IDEAL_CARD_ASPECT = 1.7;

/** The direction a card's line runs in (`"10:desc"`): chosen, or learnt from an arrival. */
export function cardPatternId(card: Card): string | null {
  if (card.direction) return `${card.line_id}:${card.direction}`;
  return card.arrivals.find((arrival) => arrival.pattern_id)?.pattern_id ?? null;
}

/** A card can open a route view when its direction is known (directly or from an arrival). */
export function routable(card: Card): boolean {
  return cardPatternId(card) !== null;
}

/** Stable identity of a card across refreshes: its stop, line and direction. */
export function cardKey(card: Card): string {
  return `${card.stop_id}|${card.line_id}|${card.direction ?? 'x'}`;
}

/**
 * Columns for the kiosk layout, where every card must fit on one screen without scrolling. The
 * grid whose cells come closest to the ideal card shape wins, so the same board adapts to an
 * Echo Show 5 (960×480), a Portal (1280×800) or a pivoting screen in portrait.
 */
export function kioskColumns(cards: number, width: number, height: number): number {
  if (cards <= 1 || width <= 0 || height <= 0) return 1;
  let best = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let columns = 1; columns <= cards; columns += 1) {
    const rows = Math.ceil(cards / columns);
    const aspect = width / columns / (height / rows);
    const emptyCells = columns * rows - cards;
    const score = Math.abs(Math.log(aspect / IDEAL_CARD_ASPECT)) + emptyCells * 0.15;
    if (score < bestScore) {
      best = columns;
      bestScore = score;
    }
  }
  return best;
}

/** The card style the active theme asks for (`--lb-card-style: strip`), read on every render so a
 * theme switch applies within one tick. */
export function cardVariant(element: Element): CardVariant {
  return getComputedStyle(element).getPropertyValue('--lb-card-style').trim() === 'strip'
    ? 'strip'
    : 'fill';
}

export class LbCardGrid extends LitElement {
  static override properties: PropertyDeclarations = {
    cards: { attribute: false },
    now: { type: Number },
    order: { type: String },
    colour: { type: String },
    effect: { type: String },
    alertMinutes: { type: Number, attribute: 'alert-minutes' },
    layout: { type: String, reflect: true },
    openable: { type: Boolean },
    services: { attribute: false },
    size: { state: true },
  };

  declare cards: readonly Card[];
  declare now: number;
  declare order: CardOrder;
  declare colour: Colour;
  declare effect: Effect;
  declare alertMinutes: number;
  /** `kiosk`: fill the host's height, no scrolling, columns chosen by card count and shape. */
  declare layout: GridLayout;
  /** Whether tapping a card may open its route view. */
  declare openable: boolean;
  /** Where each card's line stands in its day (by `cardKey`), for cards with no bus due. */
  declare services: ReadonlyMap<string, ServiceStatus>;
  declare size: { width: number; height: number };

  /** Card positions before the pending render, for the FLIP reorder animation. */
  #before = new Map<string, DOMRect>();
  /** Card order of the last render: only a change of order animates, not a change of layout
   * (columns appearing on first measure, a screen rotating). */
  #previousOrder = '';
  readonly #resize =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(([entry]) => {
          if (entry) {
            this.size = { width: entry.contentRect.width, height: entry.contentRect.height };
          }
        });

  constructor() {
    super();
    this.cards = [];
    this.now = Date.now();
    this.order = 'seleccion';
    this.colour = 'normal';
    this.effect = 'pulso';
    this.alertMinutes = 0;
    this.layout = 'auto';
    this.openable = true;
    this.services = new Map();
    this.size = { width: 0, height: 0 };
  }

  static override styles = css`
    :host {
      display: block;
      min-height: 0;
    }
    .grid {
      display: grid;
      gap: var(--lb-gap, 12px);
      grid-template-columns: repeat(auto-fill, minmax(var(--lb-card-min, 260px), 1fr));
      grid-auto-rows: var(--lb-card-row, auto);
    }
    :host([layout='kiosk']) {
      height: 100%;
    }
    :host([layout='kiosk']) .grid {
      height: 100%;
      grid-template-columns: repeat(var(--lb-columns, 2), minmax(0, 1fr));
      grid-auto-rows: minmax(0, 1fr);
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resize?.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#resize?.disconnect();
  }

  protected override willUpdate(): void {
    this.#before = this.#cardRects();
  }

  protected override updated(): void {
    const order = this.#cardElements()
      .map((element) => element.dataset['key'] ?? '')
      .join(',');
    const reordered = this.#previousOrder !== '' && order !== this.#previousOrder;
    this.#previousOrder = order;
    if (reordered) this.#animateMoves();
  }

  #cardElements(): HTMLElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLElement>('lb-card[data-key]')];
  }

  #cardRects(): Map<string, DOMRect> {
    return new Map(
      this.#cardElements().map((element) => [
        element.dataset['key'] ?? '',
        element.getBoundingClientRect(),
      ]),
    );
  }

  /** Whether the user or the theme asked for no motion (reduced motion, tinta theme). */
  #motionAllowed(): boolean {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return !reduced && getComputedStyle(this).getPropertyValue('--lb-motion').trim() !== 'none';
  }

  /**
   * FLIP: each card that changed place starts drawn at its old position and slides to the new
   * one. A card moving up — its bus now comes sooner than the one it overtook — swells slightly
   * mid-way so the eye follows it.
   */
  #animateMoves(): void {
    const before = this.#before;
    if (before.size === 0 || !this.#motionAllowed()) return;
    for (const element of this.#cardElements()) {
      const old = before.get(element.dataset['key'] ?? '');
      if (!old || typeof element.animate !== 'function') continue;
      const now = element.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      const overtakes = dy > 1 || (Math.abs(dy) <= 1 && dx > 1);
      const from = `translate(${dx}px, ${dy}px)`;
      const middle = `translate(${dx / 2}px, ${dy / 2}px) scale(${overtakes ? OVERTAKE_SCALE : 1})`;
      element.style.zIndex = overtakes ? '2' : '1';
      element.style.position = 'relative';
      const animation = element.animate(
        [{ transform: from }, { transform: middle, offset: 0.5 }, { transform: 'none' }],
        { duration: MOVE_DURATION_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
      animation.onfinish = animation.oncancel = () => {
        element.style.zIndex = '';
      };
    }
  }

  override render() {
    const variant = cardVariant(this);
    const columns =
      this.layout === 'kiosk'
        ? `--lb-columns: ${kioskColumns(this.cards.length, this.size.width, this.size.height)}`
        : '';
    return html`<div class="grid" part="grid" style=${columns}>
      ${repeat(
        sortCards(this.cards, this.order),
        cardKey,
        (card) =>
          html`<lb-card
            data-key=${cardKey(card)}
            .card=${card}
            .now=${this.now}
            variant=${variant}
            intensity=${this.colour}
            effect=${this.effect}
            alert-minutes=${this.alertMinutes}
            ?fit=${this.layout === 'kiosk'}
            ?openable=${this.openable && routable(card)}
            .service=${this.services.get(cardKey(card)) ?? null}
          ></lb-card>`,
      )}
    </div>`;
  }
}

if (!customElements.get('lb-card-grid')) customElements.define('lb-card-grid', LbCardGrid);

declare global {
  interface HTMLElementTagNameMap {
    'lb-card-grid': LbCardGrid;
  }
}

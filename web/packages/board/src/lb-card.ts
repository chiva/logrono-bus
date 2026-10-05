/**
 * `<lb-card>`: one line, one direction, one stop, painted in the line's colour.
 *
 * Colours come from CSS custom properties inherited from the page (see the PWA's themes.css);
 * the board picks the `variant` a theme asks for through `--lb-card-style`. Sizes follow the
 * card's own width (container queries) — and its height too in `fit` mode — with a fixed
 * fallback declared first for browsers without container queries (older Silk on Echo Show).
 */
import {
  type Arrival,
  type Card,
  type Colour,
  type Effect,
  type ServiceStatus,
  minutesUntil,
} from '@logrono-bus/core';
import {
  LitElement,
  type PropertyDeclarations,
  type TemplateResult,
  css,
  html,
  nothing,
} from 'lit';
import { styleMap } from 'lit/directives/style-map.js';

import { serviceSentence, timeLabel } from './format.ts';

const UNKNOWN_DIRECTION = 'sentido desconocido';
const SOON_LABEL = '¡Ya llega!';

export type CardVariant = 'fill' | 'strip';

export class LbCard extends LitElement {
  static override properties: PropertyDeclarations = {
    card: { attribute: false },
    now: { type: Number },
    variant: { type: String, reflect: true },
    fit: { type: Boolean, reflect: true },
    intensity: { type: String, reflect: true },
    effect: { type: String, reflect: true },
    still: { type: Boolean, reflect: true },
    alertMinutes: { type: Number, attribute: 'alert-minutes' },
    openable: { type: Boolean, reflect: true },
    service: { attribute: false },
  };

  declare card: Card | undefined;
  /** Milliseconds since the epoch; the board ticks it so countdowns stay current. */
  declare now: number;
  /** `fill`: painted in the line colour. `strip`: neutral card, line colour as stripe and badge. */
  declare variant: CardVariant;
  /** Size text to the card's height too (kiosk), so nothing overflows a fixed-size screen. */
  declare fit: boolean;
  declare intensity: Colour;
  declare effect: Effect;
  /** No animation (the theme asks for none, e.g. tinta): alerts show their resting state. */
  declare still: boolean;
  /** Highlight when the next bus is this close (minutes); 0 disables. */
  declare alertMinutes: number;
  /** Tapping opens the route view (`card-open` event). */
  declare openable: boolean;
  /** Where the line stands in its day, to explain an empty card ("Primera salida a las 07:15"). */
  declare service: ServiceStatus | null;

  constructor() {
    super();
    this.card = undefined;
    this.now = Date.now();
    this.variant = 'fill';
    this.fit = false;
    this.intensity = 'normal';
    this.effect = 'pulso';
    this.still = false;
    this.alertMinutes = 0;
    this.openable = false;
    this.service = null;
  }

  #open(): void {
    if (!this.openable || !this.card) return;
    this.dispatchEvent(
      new CustomEvent('card-open', { detail: this.card, bubbles: true, composed: true }),
    );
  }

  #onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.#open();
    }
  }

  /** The next (not cancelled) arrival, when it is within the alert window. */
  #dueArrival(): Arrival | undefined {
    const next = this.card?.arrivals.find((arrival) => !arrival.cancelled);
    return this.alertMinutes > 0 &&
      this.effect !== 'ninguno' &&
      next !== undefined &&
      minutesUntil(next.expected, this.now) <= this.alertMinutes
      ? next
      : undefined;
  }

  /** Whether the next (not cancelled) bus is within the alert window. */
  get alerting(): boolean {
    return this.#dueArrival() !== undefined;
  }

  /** The «¡Ya llega!» pill, beside the arrival that raised the alert (not a cancelled one). */
  #soon(arrival: Arrival): TemplateResult | typeof nothing {
    return this.effect === 'etiqueta' && arrival === this.#dueArrival()
      ? html`<span class="soon" aria-hidden="true">${SOON_LABEL}</span>`
      : nothing;
  }

  protected override willUpdate(): void {
    this.toggleAttribute('alert', this.alerting);
  }

  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
      min-width: 0;
      font-size: calc(1rem * var(--lb-text-scale, 1));
      /* Alerts contrast in lightness, not hue: any fixed hue matches some line (red 4, pink, yellow). */
      --lb-alert-ring: #000;
      --lb-alert-ring-inner: #fff;
      --lb-alert-stripe: #facc15;
    }
    article {
      box-sizing: border-box;
      height: 100%;
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: calc(var(--lb-gap, 12px) * 0.5);
      padding: var(--lb-card-padding, 14px 16px);
      border-radius: var(--lb-radius, 18px);
      background: var(--line-colour);
      color: var(--line-text);
      box-shadow: var(--lb-shadow, none);
      overflow: hidden;
      position: relative;
      /* Declared here, where --line-colour is set: the flash and the "¡Ya llega!" pill swap them. */
      --lb-inverse-bg: var(--line-text);
      --lb-inverse-fg: var(--line-colour);
    }
    :host([variant='strip']) article,
    :host([intensity='suave']) article {
      --lb-inverse-bg: var(--lb-fg, #000);
      --lb-inverse-fg: var(--lb-surface, #fff);
    }
    :host([variant='strip']) article {
      background: var(--lb-surface, #fff);
      color: var(--lb-fg, #000);
      border: var(--lb-card-border-width, 2px) solid var(--lb-border, currentColor);
      border-inline-start: var(--lb-card-strip, 14px) solid var(--line-colour);
    }
    :host([variant='strip']) .badge {
      background: var(--line-colour);
      color: var(--line-text);
      outline: 2px solid var(--lb-fg, #000);
    }
    :host([intensity='suave']) article {
      background: color-mix(in srgb, var(--line-colour) 38%, var(--lb-surface, #fff));
      color: var(--lb-fg, #000);
    }
    :host([intensity='suave']) .badge {
      background: var(--line-colour);
      color: var(--line-text);
    }
    :host([intensity='intensa']) article {
      filter: saturate(1.35) contrast(1.06);
    }
    /* Own layer: appending it to var(--lb-shadow) breaks when that is none or unset (HA card). */
    :host([intensity='intensa']:not([variant='strip'])) article::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: inset 0 0 0 3px rgba(0, 0, 0, 0.12);
      pointer-events: none;
    }
    /* Ring anchored to the card edge: Firefox floors outline widths but not outline-offset, which left an inset gap. */
    :host([alert][effect='borde']) article::after,
    :host([alert][effect='pulso']) article::after {
      content: '';
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      border: 0.3em solid var(--lb-alert-ring);
      box-shadow: inset 0 0 0 0.15em var(--lb-alert-ring-inner);
      border-radius: inherit;
      pointer-events: none;
    }
    :host([alert][effect='pulso']) article::after {
      animation: lb-pulse 1.6s ease-in-out infinite;
    }
    :host([alert][effect='pulso']) .next .value {
      animation: lb-beat 1.6s ease-in-out infinite;
    }
    :host([alert][effect='destello']) article {
      animation: lb-flash 1.6s steps(1, end) infinite;
    }
    /* Frame cut out of a striped layer with a mask: border-image would drop the rounded corners. */
    :host([alert][effect='rayas']) article::after {
      content: '';
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      padding: 0.35em;
      border-radius: inherit;
      background: repeating-linear-gradient(
        -45deg,
        var(--lb-alert-stripe) 0 0.5em,
        var(--lb-alert-ring) 0.5em 1em
      );
      -webkit-mask:
        linear-gradient(#000, #000) content-box,
        linear-gradient(#000, #000);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
    }
    .soon {
      align-self: center;
      padding: 0.15em 0.55em;
      border-radius: 999px;
      font-size: 1.1em;
      font-size: clamp(0.85em, calc(4.5cqi * var(--lb-text-scale, 1)), 1.4em);
      font-weight: 800;
      line-height: 1.2;
      white-space: nowrap;
      background: var(--lb-inverse-bg);
      color: var(--lb-inverse-fg);
    }
    ul .soon {
      margin-inline-start: 0.4em;
      font-size: 0.8em;
    }
    @keyframes lb-flash {
      50%,
      100% {
        background: var(--lb-inverse-bg);
        color: var(--lb-inverse-fg);
      }
    }
    @keyframes lb-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0;
      }
    }
    @keyframes lb-beat {
      0%,
      100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.06);
      }
    }
    .next .value {
      display: inline-block;
      transform-origin: left bottom;
    }
    /* Still: the flash holds its inverted half, the pulse its solid ring. */
    :host([alert][still]) article,
    :host([alert][still]) article::after,
    :host([alert][still]) .next .value {
      animation: none;
    }
    :host([alert][still][effect='destello']) article {
      background: var(--lb-inverse-bg);
      color: var(--lb-inverse-fg);
    }
    @media (prefers-reduced-motion: reduce) {
      :host([alert]) article,
      :host([alert]) article::after,
      :host([alert]) .next .value {
        animation: none;
      }
      :host([alert][effect='destello']) article {
        background: var(--lb-inverse-bg);
        color: var(--lb-inverse-fg);
      }
    }
    :host([openable]) article {
      cursor: pointer;
    }
    :host([openable]) article:focus-visible {
      outline: 3px solid var(--lb-focus, #2563eb);
      outline-offset: 2px;
    }
    :host([fit]) {
      container-type: size;
      height: 100%;
    }
    header {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .badge {
      flex: none;
      min-width: 2.1em;
      padding: 0.1em 0.35em;
      border-radius: calc(var(--lb-radius, 18px) * 0.5);
      font-size: 2em;
      font-size: clamp(1.4em, calc(7cqi * var(--lb-text-scale, 1)), 2.6em);
      font-weight: 800;
      line-height: 1.15;
      text-align: center;
      background: rgba(127, 127, 127, 0.18);
      background: color-mix(in srgb, var(--line-text) 14%, transparent);
    }
    .route {
      display: grid;
      min-width: 0;
    }
    .towards {
      font-size: 1.38em;
      font-size: clamp(1.05em, calc(5.5cqi * var(--lb-text-scale, 1)), 1.7em);
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stop {
      font-size: 0.93em;
      font-size: clamp(0.8em, calc(3.6cqi * var(--lb-text-scale, 1)), 1.05em);
      opacity: 0.8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .next {
      align-self: center;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.25em;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
    .next .value {
      font-size: 4.2em;
      font-size: clamp(2.4em, calc(22cqi * var(--lb-text-scale, 1)), 6em);
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .next .value.word {
      font-size: 2.7em;
      font-size: clamp(1.8em, calc(13cqi * var(--lb-text-scale, 1)), 3.6em);
    }
    .next .unit {
      font-size: 1.5em;
      font-size: clamp(1em, calc(7cqi * var(--lb-text-scale, 1)), 2em);
      font-weight: 600;
    }
    .next .headsign {
      font-size: 0.98em;
      font-size: clamp(0.85em, calc(4cqi * var(--lb-text-scale, 1)), 1.1em);
      opacity: 0.85;
    }
    .empty {
      align-self: center;
      font-size: 1.3em;
      font-size: clamp(1em, calc(6cqi * var(--lb-text-scale, 1)), 1.6em);
      opacity: 0.8;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.35em 1em;
      font-size: 1.23em;
      font-size: clamp(0.95em, calc(5cqi * var(--lb-text-scale, 1)), 1.5em);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .scheduled {
      font-style: italic;
      opacity: 0.85;
    }
    .cancelled {
      text-decoration: line-through;
      opacity: 0.7;
    }
    :host([fit]) .badge {
      font-size: clamp(1em, calc(min(7cqi, 14cqh) * var(--lb-text-scale, 1)), 4em);
    }
    :host([fit]) .towards {
      font-size: clamp(0.9em, calc(min(5.5cqi, 11cqh) * var(--lb-text-scale, 1)), 2.8em);
    }
    :host([fit]) .stop {
      font-size: clamp(0.7em, calc(min(3.6cqi, 7cqh) * var(--lb-text-scale, 1)), 1.6em);
    }
    :host([fit]) .next .value {
      font-size: clamp(1.6em, calc(min(30cqi, 34cqh) * var(--lb-text-scale, 1)), 12em);
    }
    :host([fit]) .next .value.word {
      font-size: clamp(1.3em, calc(min(17cqi, 22cqh) * var(--lb-text-scale, 1)), 7em);
    }
    :host([fit]) .next .unit {
      font-size: clamp(0.9em, calc(min(7cqi, 12cqh) * var(--lb-text-scale, 1)), 3.6em);
    }
    :host([fit]) .soon {
      font-size: clamp(0.8em, calc(min(4.5cqi, 9cqh) * var(--lb-text-scale, 1)), 2.4em);
    }
    :host([fit]) ul {
      font-size: clamp(0.8em, calc(min(5cqi, 10cqh) * var(--lb-text-scale, 1)), 2.6em);
    }
    .mark {
      font-size: 0.7em;
      font-weight: 500;
      opacity: 0.85;
    }
  `;

  #time(arrival: Arrival, big: boolean): TemplateResult {
    const label = timeLabel(arrival, this.now);
    const classes = [
      big ? 'value' : '',
      big && !label.unit ? 'word' : '',
      arrival.is_realtime ? '' : 'scheduled',
      arrival.cancelled ? 'cancelled' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return html`<span class=${classes}>${label.value}</span>${
        label.unit
          ? html`<span class=${big ? 'unit' : ''}>${big ? label.unit : ` ${label.unit}`}</span>`
          : nothing
      }${
        arrival.is_realtime
          ? nothing
          : html`<span class="mark" title="Horario programado, sin seguimiento en tiempo real">
              · prog.</span
            >`
      }`;
  }

  #spoken(card: Card, arrivals: readonly Arrival[]): string {
    const towards = card.headsign ? `hacia ${card.headsign}` : '';
    const times = arrivals.map((arrival) => timeLabel(arrival, this.now).spoken).join(', ');
    const soon = this.alerting ? '. ¡Llega pronto!' : '';
    return `Línea ${card.line_label} ${towards}, parada ${card.stop_name}: ${
      times || serviceSentence(this.service).toLowerCase()
    }${soon}`;
  }

  override render(): TemplateResult | typeof nothing {
    const card = this.card;
    if (!card) return nothing;
    const [next, ...following] = card.arrivals;
    const nextHeadsign = card.headsign ? null : (next?.headsign ?? UNKNOWN_DIRECTION);
    return html`
      <article
        style=${styleMap({ '--line-colour': card.colour, '--line-text': card.text_colour })}
        aria-label=${this.#spoken(card, card.arrivals)}
        role=${this.openable ? 'button' : nothing}
        tabindex=${this.openable ? 0 : nothing}
        @click=${this.#open}
        @keydown=${this.#onKey}
      >
        <header>
          <span class="badge" aria-hidden="true">${card.line_label}</span>
          <div class="route">
            <span class="towards">${card.headsign ? `→ ${card.headsign}` : card.line_name}</span>
            <span class="stop">${card.stop_name}</span>
          </div>
        </header>
        ${
          next
            ? html`<div class="next">
                ${this.#time(next, true)}
                ${nextHeadsign ? html`<span class="headsign">→ ${nextHeadsign}</span>` : nothing}
                ${this.#soon(next)}
              </div>`
            : html`<div class="empty">${serviceSentence(this.service)}</div>`
        }
        <ul aria-hidden="true">
          ${following.map(
            (arrival) => html`<li>${this.#time(arrival, false)}${this.#soon(arrival)}</li>`,
          )}
        </ul>
      </article>
    `;
  }
}

if (!customElements.get('lb-card')) customElements.define('lb-card', LbCard);

declare global {
  interface HTMLElementTagNameMap {
    'lb-card': LbCard;
  }
}

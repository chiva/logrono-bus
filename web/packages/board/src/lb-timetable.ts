/**
 * `<lb-timetable>`: today's timetable of one direction of a line — its periods ("07:15–15:15 ·
 * cada 30 min") and every departure, the ones already gone dimmed and the next one marked.
 *
 * The times are departures from the line's first stop, as the Ayuntamiento publishes them; the
 * view says so, because at the rider's stop the bus passes some minutes later.
 */
import { type DirectionTimetable, describeInterval, serviceStatus } from '@logrono-bus/core';
import { LitElement, type PropertyDeclarations, css, html, nothing } from 'lit';

import { serviceSentence } from './format.ts';

export class LbTimetable extends LitElement {
  static override properties: PropertyDeclarations = {
    timetable: { attribute: false },
    now: { type: Number },
    stopName: { type: String, attribute: 'stop-name' },
  };

  declare timetable: DirectionTimetable | null;
  /** Milliseconds since the epoch, to tell past departures from the next one. */
  declare now: number;
  /** The rider's stop, to explain that the times are at the line's origin instead. */
  declare stopName: string;

  #scrolledTo: string | null = null;

  constructor() {
    super();
    this.timetable = null;
    this.now = Date.now();
    this.stopName = '';
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.6em;
      min-height: 0;
    }
    p {
      margin: 0;
    }
    .note {
      color: var(--lb-muted, inherit);
      font-size: 0.85em;
    }
    .status {
      font-weight: 700;
    }
    .periods {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3em 1.2em;
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: 0.9em;
    }
    .departures {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(4.2em, 1fr));
      gap: 0.35em;
      margin: 0;
      padding: 0.2em;
      list-style: none;
      overflow-y: auto;
      min-height: 0;
    }
    .departures li {
      padding: 0.25em 0;
      border-radius: 0.5em;
      text-align: center;
      font-variant-numeric: tabular-nums;
      background: var(--lb-surface, transparent);
      border: 1px solid var(--lb-border, currentColor);
    }
    .departures li.past {
      opacity: 0.4;
    }
    .departures li.next {
      font-weight: 800;
      background: var(--line-colour);
      color: var(--line-text);
      border-color: var(--line-colour);
    }
  `;

  protected override updated(): void {
    // Bring the next departure into view once per timetable, not on every clock tick.
    const next = this.renderRoot.querySelector<HTMLElement>('li.next');
    const key = this.timetable ? `${this.timetable.pattern_id}|${next?.textContent ?? ''}` : null;
    if (next && key !== this.#scrolledTo) {
      this.#scrolledTo = key;
      next.scrollIntoView({ block: 'nearest' });
    }
  }

  override render() {
    const timetable = this.timetable;
    if (!timetable || timetable.departures.length === 0) {
      return html`<p class="status">Hoy no hay servicio en este sentido.</p>`;
    }
    const status = serviceStatus(timetable, this.now);
    const next = status.next_departure;
    let seenNext = false;
    return html`
      <p class="status">
        ${
          status.state === 'en_servicio' && status.next_departure
            ? `Próxima salida ${status.next_departure}${
                status.interval_min === null
                  ? ''
                  : ` · ${describeInterval(status.interval_min, status.interval_max_min)}`
              }`
            : serviceSentence(status)
        }
      </p>
      <p class="note">
        Salidas de ${timetable.origin} hacia ${timetable.headsign}.
        ${this.stopName ? `A ${this.stopName} el autobús pasa unos minutos después.` : nothing}
      </p>
      <ul class="periods" aria-label="Frecuencia por franjas">
        ${timetable.periods.map(
          (period) =>
            html`<li>
              ${period.first}–${period.last} ·
              ${describeInterval(period.interval_min, period.interval_max_min)}
            </li>`,
        )}
      </ul>
      <ul class="departures" aria-label="Salidas de hoy">
        ${timetable.departures.map((departure) => {
          const isNext = !seenNext && departure === next;
          if (isNext) seenNext = true;
          const past = status.state === 'terminado' || (!seenNext && next !== null);
          return html`<li
            class=${isNext ? 'next' : past ? 'past' : ''}
            aria-current=${isNext ? 'time' : nothing}
          >
            ${departure}
          </li>`;
        })}
      </ul>
    `;
  }
}

if (!customElements.get('lb-timetable')) customElements.define('lb-timetable', LbTimetable);

declare global {
  interface HTMLElementTagNameMap {
    'lb-timetable': LbTimetable;
  }
}

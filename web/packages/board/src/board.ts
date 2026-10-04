/**
 * `<logrono-bus-board>`: a whole board, self-refreshing.
 *
 * Give it a `config` (a parsed board URL) and, optionally, a `source`; it fetches each selected
 * stop once per refresh (every line of the stop in one request), groups arrivals into cards and
 * keeps the countdowns ticking between refreshes. It is page-agnostic so it can later be wrapped
 * as a Home Assistant Lovelace card.
 */
import {
  type BoardConfig,
  type Card,
  type CatalogIndex,
  DEFAULT_PREVIOUS_STOPS,
  type DataSource,
  type LineTimetable,
  LogronoBusError,
  type ServiceStatus,
  type StopArrivals,
  UpstreamSchemaError,
  UpstreamUnavailable,
  type Font,
  buildCards,
  formatSelection,
  localDate,
  selectSource,
  serviceStatus,
  timetableFor,
} from '@logrono-bus/core';
import {
  LitElement,
  type PropertyDeclarations,
  type PropertyValues,
  css,
  html,
  nothing,
} from 'lit';

import { formatAge } from './format.ts';
import { cardKey, cardPatternId } from './lb-card-grid.ts';
import './lb-card-grid.ts';
import './lb-route.ts';
import { Poller } from './poller.ts';

/** Countdowns are recomputed locally this often; the data itself refreshes every 30 s. */
export const TICK_MS = 5_000;
/** Data older than this is flagged on screen. */
export const STALE_AFTER_MS = 90_000;

export type BoardStatus = 'loading' | 'ready' | 'error';
export type BoardLayout = 'auto' | 'kiosk';

export class LogronoBusBoard extends LitElement {
  static override properties: PropertyDeclarations = {
    config: { attribute: false },
    source: { attribute: false },
    status: { type: String, reflect: true },
    layout: { type: String, reflect: true },
    cards: { state: true },
    now: { state: true },
    updatedAt: { state: true },
    error: { state: true },
    opened: { state: true },
    timetables: { state: true },
  };

  declare config: BoardConfig | undefined;
  declare source: DataSource | undefined;
  declare status: BoardStatus;
  /** `kiosk`: fill the host's height, no scrolling, columns chosen by card count. */
  declare layout: BoardLayout;
  declare cards: readonly Card[];
  declare now: number;
  declare updatedAt: number | undefined;
  declare error: string | undefined;
  /** Key of the card whose route view is open. */
  declare opened: string | undefined;
  /** Today's timetables of the lines whose cards have no bus due, by line id. */
  declare timetables: ReadonlyMap<string, LineTimetable>;

  readonly #poller = new Poller((signal) => this.refresh(signal));
  /** Local day each line's timetable was last asked for, whether or not the request worked. */
  readonly #timetableAskedOn = new Map<string, string>();
  #tick: ReturnType<typeof setInterval> | undefined;
  #catalog: CatalogIndex | undefined;
  readonly #onVisibility = (): void => this.#poller.setPaused(document.hidden);

  constructor() {
    super();
    this.config = undefined;
    this.source = undefined;
    this.status = 'loading';
    this.layout = 'auto';
    this.cards = [];
    this.now = Date.now();
    this.updatedAt = undefined;
    this.error = undefined;
    this.opened = undefined;
    this.timetables = new Map();
  }

  /** Latest arrivals per stop, for the route view's minute labels. */
  #arrivals = new Map<string, StopArrivals>();

  static override styles = css`
    :host {
      display: block;
      color: var(--lb-fg, inherit);
    }
    :host([layout='kiosk']) {
      height: 100%;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
    }
    :host([layout='kiosk']) .status {
      margin-top: calc(var(--lb-gap, 12px) * 0.5);
      font-size: 0.8rem;
    }
    .status {
      margin-top: var(--lb-gap, 12px);
      font-size: 0.9rem;
      color: var(--lb-muted, inherit);
      display: flex;
      gap: 0.75em;
      flex-wrap: wrap;
      align-items: center;
    }
    .stale,
    .problem {
      padding: 0.15em 0.6em;
      border-radius: 999px;
      background: var(--lb-warning-bg, #fff3cd);
      color: var(--lb-warning-fg, #5c4400);
      font-weight: 600;
    }
    .message {
      padding: 1.5rem;
      border-radius: var(--lb-radius, 18px);
      background: var(--lb-surface, transparent);
      border: 1px solid var(--lb-border, currentColor);
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('visibilitychange', this.#onVisibility);
    this.#tick = setInterval(() => {
      this.now = Date.now();
    }, TICK_MS);
    if (this.config) this.#poller.start();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('visibilitychange', this.#onVisibility);
    clearInterval(this.#tick);
    this.#poller.stop();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (this.config) {
      this.style.setProperty('--lb-text-scale', String(this.config.textScale / 100));
      this.style.setProperty('font-family', FONT_STACKS[this.config.font]);
    }
    // Only a different selection needs new data; display settings just re-render.
    const previous: BoardConfig | undefined = changed.get('config');
    const reselected = changed.has('config') && dataKey(previous) !== dataKey(this.config);
    const reconfigured = reselected || changed.has('source');
    if (reconfigured && this.hasUpdated && this.isConnected && this.config) {
      this.#catalog = undefined;
      this.#poller.stop();
      this.#poller.start();
    }
  }

  /** Fetch every selected stop and rebuild the cards. Exposed for "refresh now" buttons. */
  async refresh(signal?: AbortSignal): Promise<void> {
    const config = this.config;
    if (!config) return;
    try {
      this.source ??= await selectSource(config, { pageProtocol: location.protocol });
      const source = this.source;
      this.#catalog ??= await source.catalog();
      const catalog = this.#catalog;
      const stopIds = [...new Set(config.stops.map((stop) => stop.stop_id))];
      const results = await Promise.all(stopIds.map((id) => source.arrivals(id, signal)));
      const byStop = new Map<string, StopArrivals>(results.map((r) => [r.stop_id, r]));
      this.#arrivals = byStop;
      this.cards = config.stops.flatMap((selection) => {
        const arrivals = byStop.get(selection.stop_id);
        return arrivals ? buildCards(catalog, selection, arrivals, config.perCard) : [];
      });
      this.updatedAt = Math.min(...results.map((r) => Date.parse(r.generated_at)));
      this.now = Date.now();
      this.error = undefined;
      this.status = 'ready';
      void this.#loadTimetables(source, this.cards);
    } catch (error) {
      if (signal?.aborted) throw error;
      this.error = describeError(error);
      if (this.cards.length === 0) this.status = 'error';
      throw error;
    } finally {
      this.dispatchEvent(new CustomEvent('board-refresh', { bubbles: true, composed: true }));
    }
  }

  /**
   * Fetch today's timetable for lines with a card that has no bus due, so the card can say
   * whether service has not started or is over. One request per line and day, at most, even when
   * it fails: a failure only leaves the card with its plain "Sin llegadas próximas" until tomorrow.
   */
  async #loadTimetables(source: DataSource, cards: readonly Card[]): Promise<void> {
    const today = localDate(Date.now());
    const missing = new Set(
      cards
        .filter((card) => !card.arrivals.some((arrival) => !arrival.cancelled))
        .map((card) => card.line_id)
        .filter((lineId) => this.#timetableAskedOn.get(lineId) !== today),
    );
    if (missing.size === 0) return;
    for (const lineId of missing) this.#timetableAskedOn.set(lineId, today);
    // `async` so even a source that throws before returning a promise only loses its line.
    const loaded = await Promise.allSettled(
      [...missing].map(async (lineId) => source.timetable(lineId)),
    );
    const next = new Map(this.timetables);
    for (const result of loaded) {
      if (result.status === 'fulfilled') next.set(result.value.line_id, result.value);
    }
    this.timetables = next;
  }

  /** Where each empty card's line stands in its day, keyed like the cards. */
  #services(): Map<string, ServiceStatus> {
    const services = new Map<string, ServiceStatus>();
    for (const card of this.cards) {
      const timetable = this.timetables.get(card.line_id);
      if (!timetable) continue;
      services.set(
        cardKey(card),
        serviceStatus(timetableFor(timetable, cardPatternId(card)), this.now),
      );
    }
    return services;
  }

  #renderRoute() {
    const card = this.cards.find((candidate) => cardKey(candidate) === this.opened);
    if (!card || !this.source) return nothing;
    return html`<lb-route
      .card=${card}
      .source=${this.source}
      .arrivals=${this.#arrivals.get(card.stop_id) ?? null}
      .previousStops=${this.config?.previousStops ?? DEFAULT_PREVIOUS_STOPS}
      @route-close=${() => (this.opened = undefined)}
    ></lb-route>`;
  }

  override render() {
    const config = this.config;
    if (!config) return nothing;
    if (this.status === 'loading') {
      return html`<p class="message" role="status">Cargando llegadas…</p>`;
    }
    if (this.status === 'error') {
      return html`<p class="message" role="alert">${this.error}</p>`;
    }
    const age = this.updatedAt === undefined ? 0 : this.now - this.updatedAt;
    return html`
      ${this.#renderRoute()}
      <lb-card-grid
        .cards=${this.cards}
        .now=${this.now}
        order=${config.order}
        colour=${config.colour}
        effect=${config.effect}
        alert-minutes=${config.alertMinutes}
        layout=${this.layout}
        .services=${this.#services()}
        @card-open=${(event: CustomEvent<Card>) => (this.opened = cardKey(event.detail))}
      ></lb-card-grid>
      <div class="status" part="status" role="status">
        <span>Actualizado ${formatAge(age)}</span>
        ${
          age > STALE_AFTER_MS
            ? html`<span class="stale">Datos sin actualizar: comprobando de nuevo</span>`
            : nothing
        }
        ${this.error ? html`<span class="problem">${this.error}</span>` : nothing}
      </div>
    `;
  }
}

/** Font stacks for the `letra` setting; `legible` needs the Atkinson Hyperlegible web font, which
 * the app bundles (other pages fall back to the system font). */
export const FONT_STACKS: Readonly<Record<Font, string>> = {
  sistema: "var(--lb-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif)",
  legible: "'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', system-ui, sans-serif",
  redondeada: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', 'DejaVu Sans Mono', Menlo, Consolas, monospace",
};

function dataKey(config: BoardConfig | undefined): string {
  return config ? `${formatSelection(config.stops)}|${config.perCard}` : '';
}

/** One Spanish sentence a non-technical person can act on. */
export function describeError(error: unknown): string {
  if (error instanceof UpstreamSchemaError) {
    return 'El servicio de autobuses del Ayuntamiento ha cambiado. Hace falta actualizar esta aplicación.';
  }
  if (error instanceof UpstreamUnavailable) {
    return 'No se puede contactar con el servicio de autobuses. Se reintentará automáticamente.';
  }
  if (error instanceof LogronoBusError) return error.message;
  return 'Error inesperado al cargar las llegadas.';
}

if (!customElements.get('logrono-bus-board')) {
  customElements.define('logrono-bus-board', LogronoBusBoard);
}

declare global {
  interface HTMLElementTagNameMap {
    'logrono-bus-board': LogronoBusBoard;
  }
}

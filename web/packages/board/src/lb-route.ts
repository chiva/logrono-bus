/**
 * `<lb-route>`: tap a card, see the road. Your stop first, then the stops before it running down
 * (portrait) or to the left (landscape), and the buses of that line on their way, drawn where
 * they are and gliding forward as positions update. A dotted "…" stands for the rest of the line
 * before the first stop shown (with the nearest bus further back parked on it) and after yours.
 *
 * It polls the line's positions every 15 s only while the route is on screen (not while the
 * timetable is, nor while the page is hidden), and closes itself after 15 minutes untouched so a
 * wall screen always returns to the board. A failed refresh keeps the last positions on screen,
 * with a warning, until they are too old to trust. "Horario" swaps the diagram for today's
 * timetable of that direction.
 */
import {
  type Card,
  type CatalogIndex,
  DEFAULT_PREVIOUS_STOPS,
  type DataSource,
  type LineTimetable,
  type LineVehicles,
  MAX_PREVIOUS_STOPS,
  MIN_PREVIOUS_STOPS,
  type RouteBus,
  type RouteView,
  STALE_POSITION_MS,
  type StopArrivals,
  buildRoute,
  timetableFor,
} from '@logrono-bus/core';
import { LitElement, type PropertyDeclarations, css, html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';

import { formatAge, timeLabel } from './format.ts';
import { cardPatternId } from './lb-card-grid.ts';
import './lb-timetable.ts';
import { Poller } from './poller.ts';

export const ROUTE_REFRESH_MS = 15_000;
/** Long enough to watch a bus come from several stops away. */
export const ROUTE_IDLE_CLOSE_MS = 15 * 60_000;
/** Wider than tall by this factor → horizontal layout. */
export const LANDSCAPE_RATIO = 1.1;
/** Room each stop needs along the track, in ems of the track's text. */
export const STOP_SPACING_EM = { vertical: 2.4, horizontal: 4.6 } as const;
/** Track length taken by the "…" ends and the names hanging over them, in ems. */
export const TRACK_ENDS_EM = { vertical: 7, horizontal: 9 } as const;
/** A bus closer than this (in stops) to a stop would cover its name on a horizontal track. */
export const LABEL_CLEARANCE_STOPS = 0.8;

export type RouteOrientation = 'vertical' | 'horizontal';
export type RouteScreen = 'recorrido' | 'horario';

/** How many stops before yours fit on a track this long (px) with text this big (px per em). */
export function previousStopsThatFit(
  lengthPx: number,
  orientation: RouteOrientation,
  emPx: number,
): number {
  if (lengthPx <= 0 || emPx <= 0) return MAX_PREVIOUS_STOPS;
  const usable = lengthPx - TRACK_ENDS_EM[orientation] * emPx;
  const fit = Math.floor(usable / (STOP_SPACING_EM[orientation] * emPx));
  return Math.min(MAX_PREVIOUS_STOPS, Math.max(MIN_PREVIOUS_STOPS, fit));
}

/** Indexes of the stops shown with a bus right over them, whose names must step aside. */
export function stopsUnderBuses(
  route: RouteView,
  clearance: number = LABEL_CLEARANCE_STOPS,
): ReadonlySet<number> {
  const covered = new Set<number>();
  route.stops.forEach((_, index) => {
    if (route.buses.some((bus) => Math.abs(bus.at - index) < clearance)) covered.add(index);
  });
  return covered;
}

/** The stops of the line behind the first one shown: "2 paradas antes, desde Artesanos". */
export function hiddenStopsLabel(route: RouteView): string {
  const stops = route.hiddenStops === 1 ? '1 parada' : `${route.hiddenStops} paradas`;
  return `${stops} antes, desde ${route.origin}`;
}

/** A bus's minutes as the cards word them: "llegando" at 0, nothing when unknown. */
export function minutesLabel(bus: RouteBus): string {
  if (bus.minutes === null) return '';
  return bus.minutes === 0 ? 'llegando' : `${bus.minutes} min`;
}

/**
 * The header's "next bus" line, worded like the cards ("en 4 minutos", "llegando", "a las
 * 18:45") and flagged when it is the timetable rather than a located bus.
 */
export function nextBusLine(card: Card, nowMs: number): string {
  const next = card.arrivals.find((arrival) => !arrival.cancelled);
  if (!next) return card.stop_name;
  const scheduled = next.is_realtime ? '' : ' (horario programado)';
  return `${card.stop_name} · próximo ${timeLabel(next, nowMs).spoken}${scheduled}`;
}

/**
 * The positions still recent enough to show, `elapsedMs` after they were fetched. A position's age
 * is how old it already was when fetched plus the time since, so neither clock has to match.
 */
export function trustedAfter(vehicles: LineVehicles, elapsedMs: number): LineVehicles {
  const fetchedAt = Date.parse(vehicles.generated_at);
  return {
    ...vehicles,
    vehicles: vehicles.vehicles.filter(
      // A position stamped after the fetch (clocks apart) counts as brand new, not as younger.
      (vehicle) =>
        Math.max(0, fetchedAt - Date.parse(vehicle.recorded_at)) + elapsedMs <= STALE_POSITION_MS,
    ),
  };
}

export class LbRoute extends LitElement {
  static override properties: PropertyDeclarations = {
    card: { attribute: false },
    source: { attribute: false },
    arrivals: { attribute: false },
    previousStops: { type: Number, attribute: 'previous-stops' },
    route: { state: true },
    vehicles: { state: true },
    problem: { state: true },
    now: { state: true },
    orientation: { type: String, reflect: true },
    room: { state: true },
    screen: { type: String, reflect: true },
    timetable: { state: true },
  };

  declare card: Card | undefined;
  declare source: DataSource | undefined;
  /** Latest arrivals at the card's stop (from the board), to label buses with minutes. */
  declare arrivals: StopArrivals | null;
  /** Stops to show before yours, as the user set it; fewer when the screen has no room. */
  declare previousStops: number;
  declare route: RouteView | null;
  declare vehicles: LineVehicles | undefined;
  declare problem: string | undefined;
  declare now: number;
  declare orientation: RouteOrientation;
  /** Most stops before yours this screen has room for. */
  declare room: number;
  /** What the body shows: the road with the buses, or today's timetable. */
  declare screen: RouteScreen;
  declare timetable: LineTimetable | undefined;
  #catalog: CatalogIndex | undefined;
  /** When the positions shown arrived, by this device's clock. */
  #fetchedAt = 0;
  /** Whether a bus of this direction was left out only because its position aged out. */
  #agedOut = false;

  readonly #poller = new Poller((signal) => this.#load(signal), {
    intervalMs: ROUTE_REFRESH_MS,
  });
  #idle: ReturnType<typeof setTimeout> | undefined;
  #clock: ReturnType<typeof setInterval> | undefined;
  readonly #resize =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(([entry]) => {
          if (!entry) return;
          const { width, height } = entry.contentRect;
          this.orientation = width > height * LANDSCAPE_RATIO ? 'horizontal' : 'vertical';
          const body = this.renderRoot.querySelector('.body') ?? this;
          const emPx = Number.parseFloat(getComputedStyle(body).fontSize);
          this.room = previousStopsThatFit(
            this.orientation === 'horizontal' ? width : height * 0.7,
            this.orientation,
            emPx,
          );
        });
  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.close();
  };
  readonly #onVisibility = (): void => this.#syncPause();

  constructor() {
    super();
    this.card = undefined;
    this.source = undefined;
    this.arrivals = null;
    this.previousStops = DEFAULT_PREVIOUS_STOPS;
    this.route = null;
    this.vehicles = undefined;
    this.problem = undefined;
    this.now = Date.now();
    this.orientation = 'vertical';
    this.room = MAX_PREVIOUS_STOPS;
    this.screen = 'recorrido';
    this.timetable = undefined;
  }

  /**
   * The route is rebuilt from the latest data every second: minutes count down, and a bus drops
   * out once its own position is too old to trust (after failed refreshes, or a hidden page).
   */
  protected override willUpdate(): void {
    const patternId = this.patternId;
    if (!this.#catalog || !this.vehicles || !this.card || !patternId) return;
    const trusted = trustedAfter(this.vehicles, this.now - this.#fetchedAt);
    const onPattern = (vehicles: LineVehicles) =>
      vehicles.vehicles.filter((vehicle) => vehicle.pattern_id === patternId).length;
    this.#agedOut = onPattern(trusted) < onPattern(this.vehicles);
    this.route = buildRoute(this.#catalog, patternId, this.card.stop_id, trusted, this.arrivals, {
      previousStops: Math.min(this.previousStops, this.room),
      now: new Date(this.now).toISOString(),
    });
  }

  static override styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 10;
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: 12px;
      padding: 16px clamp(14px, 3vw, 28px);
      background: var(--lb-bg, #fff);
      color: var(--lb-fg, #000);
      font-size: calc(clamp(1rem, 0.6rem + 1vmin, 1.5rem) * var(--lb-text-scale, 1));
      box-sizing: border-box;
    }
    /* On a narrow phone the buttons drop below the title rather than squeeze it. */
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 14px;
      min-width: 0;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-left: auto;
    }
    .badge {
      flex: none;
      min-width: 2.2em;
      padding: 0.1em 0.4em;
      border-radius: 10px;
      font-size: 1.8em;
      font-weight: 800;
      text-align: center;
      background: var(--line-colour);
      color: var(--line-text);
      outline: var(--lb-badge-outline, none);
    }
    .title {
      display: grid;
      min-width: 0;
      flex: 1 1 11em;
    }
    .title strong {
      font-size: 1.35em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .title span {
      color: var(--lb-muted, inherit);
    }
    button {
      font: inherit;
      font-weight: 700;
      min-height: 44px;
      padding: 0.4em clamp(0.6em, 2vw, 1.1em);
      border-radius: 999px;
      border: 1px solid var(--lb-border, currentColor);
      background: var(--lb-surface, transparent);
      color: inherit;
      cursor: pointer;
      flex: none;
    }
    footer[hidden] {
      display: none;
    }
    .body > lb-timetable {
      flex: 1;
      min-height: 0;
      font-size: 0.8em;
    }

    /* The diagram scales with the screen's short side: big on an Echo Show, capped on a desktop. */
    .body {
      --rail: 0.42em;
      --dot: 0.95em;
      --target: 1.5em;
      min-height: 0;
      display: flex;
      flex-direction: column;
      font-size: calc(clamp(1.05rem, 0.5rem + 3.2vmin, 1.7rem) * var(--lb-text-scale, 1));
    }
    .track {
      position: relative;
      flex: 1;
      min-height: 0;
    }
    .line {
      position: absolute;
      background: var(--line-colour);
      border-radius: 999px;
    }
    .more {
      position: absolute;
      border: 0 dotted var(--line-colour);
    }
    .stop,
    .bus {
      position: absolute;
      display: flex;
      align-items: center;
      gap: 0.45em;
    }
    .dot {
      flex: none;
      width: var(--dot);
      height: var(--dot);
      border-radius: 50%;
      background: var(--lb-surface, #fff);
      border: 0.24em solid var(--line-colour);
      box-sizing: border-box;
    }
    .stop.target .dot {
      width: var(--target);
      height: var(--target);
      border-width: 0.36em;
    }
    /*
     * Where the line starts or ends, as on a metro map: as big as your stop, but filled. Your stop
     * as the last of the line takes it too: its place and big name already say it is yours.
     */
    .stop.terminus .dot {
      width: var(--target);
      height: var(--target);
      border-width: 0.36em;
      background: var(--line-colour);
      box-shadow: inset 0 0 0 0.16em var(--lb-surface, #fff);
    }
    .stop .name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .stop.terminus .name {
      font-weight: 700;
    }
    .stop.target .name {
      font-size: 1.2em;
      font-weight: 800;
    }
    .bus {
      z-index: 1;
      transition:
        top 1.2s ease-in-out,
        left 1.2s ease-in-out;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 0.3em;
      padding: 0.15em 0.55em;
      border-radius: 999px;
      font-size: 0.95em;
      font-weight: 800;
      white-space: nowrap;
      background: var(--line-colour);
      color: var(--line-text);
      box-shadow: 0 2px 10px rgb(0 0 0 / 0.3);
      outline: 2px solid var(--lb-bg, #fff);
    }
    .first .pill {
      font-size: 1.1em;
    }
    .note,
    footer {
      color: var(--lb-muted, inherit);
      font-size: 0.9em;
    }
    footer {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75em 1.5em;
      justify-content: space-between;
    }
    .problem {
      padding: 0.15em 0.6em;
      border-radius: 999px;
      background: var(--lb-warning-bg, #fff3cd);
      color: var(--lb-warning-fg, #5c4400);
      font-weight: 600;
    }

    /* Vertical: your stop on top, the road running down; buses to the left of the road. */
    :host([orientation='vertical']) .body {
      --x: 6.6em;
    }
    :host([orientation='vertical']) .track {
      margin: 2.6em 0 3.4em;
    }
    :host([orientation='vertical']) .line {
      left: calc(var(--x) - var(--rail) / 2);
      top: 0;
      bottom: 0;
      width: var(--rail);
    }
    :host([orientation='vertical']) .more {
      left: calc(var(--x) - var(--rail) / 2);
      border-left-width: var(--rail);
    }
    :host([orientation='vertical']) .more.before {
      top: calc(100% + 0.5em);
      height: 2.4em;
    }
    :host([orientation='vertical']) .more.after {
      bottom: calc(100% + var(--target) / 2 + 0.3em);
      height: 1.6em;
    }
    :host([orientation='vertical']) .stop {
      left: calc(var(--x) - var(--dot) / 2);
      right: 0;
      transform: translateY(-50%);
    }
    :host([orientation='vertical']) .stop.target,
    :host([orientation='vertical']) .stop.terminus {
      left: calc(var(--x) - var(--target) / 2);
    }
    :host([orientation='vertical']) .bus {
      left: 0;
      width: calc(var(--x) - 0.9em);
      justify-content: flex-end;
      transform: translateY(-50%);
    }
    :host([orientation='vertical']) .bus.earlier {
      top: calc(100% + 1.7em);
    }

    /* Horizontal: your stop on the right, the road coming from the left; buses ride on it. */
    :host([orientation='horizontal']) .track {
      margin: 0 4.5em;
    }
    :host([orientation='horizontal']) .line {
      top: 50%;
      left: 0;
      right: 0;
      height: var(--rail);
      transform: translateY(-50%);
    }
    :host([orientation='horizontal']) .more {
      top: 50%;
      border-top-width: var(--rail);
      transform: translateY(-50%);
    }
    :host([orientation='horizontal']) .more.before {
      right: calc(100% + 0.5em);
      width: 3.6em;
    }
    :host([orientation='horizontal']) .more.after {
      left: calc(100% + var(--target) / 2 + 0.3em);
      width: 2.6em;
    }
    :host([orientation='horizontal']) .stop {
      top: 50%;
      width: 0;
      justify-content: center;
      transform: translateY(-50%);
    }
    :host([orientation='horizontal']) .stop .name {
      position: absolute;
      top: calc(100% + 0.45em);
      left: -4.2em;
      width: 8.4em;
      text-align: center;
      white-space: normal;
      line-height: 1.15;
      transition:
        top 0.4s ease-in-out,
        bottom 0.4s ease-in-out;
    }
    :host([orientation='horizontal']) .stop.above .name {
      top: auto;
      bottom: calc(100% + 0.45em);
    }
    :host([orientation='horizontal']) .stop.target .name {
      left: -3.5em;
      width: 7em;
    }
    /* A bus pill rides the track over this stop: move the name clear of it, away from the road. */
    :host([orientation='horizontal']) .stop.covered .name {
      top: calc(100% + 1.2em);
    }
    :host([orientation='horizontal']) .stop.covered.above .name {
      top: auto;
      bottom: calc(100% + 1.2em);
    }
    :host([orientation='horizontal']) .bus {
      top: 50%;
      transform: translate(-50%, -50%);
    }
    /* Floats over the dotted "…" (on the side away from the first stop's name) so both show. */
    :host([orientation='horizontal']) .bus.earlier {
      left: -2.3em;
      top: calc(50% - 1.35em);
    }
    :host([orientation='horizontal']) .bus.earlier.low {
      top: calc(50% + 1.35em);
    }

    @media (prefers-reduced-motion: reduce) {
      .bus,
      .stop .name {
        transition: none;
      }
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    // With no bus due, the timetable says more than an empty road.
    if (this.card && !this.card.arrivals.some((arrival) => !arrival.cancelled)) {
      this.show('horario');
    }
    this.#syncPause();
    this.#poller.start();
    this.#resize?.observe(this);
    this.#clock = setInterval(() => (this.now = Date.now()), 1_000);
    document.addEventListener('keydown', this.#onKey);
    document.addEventListener('visibilitychange', this.#onVisibility);
    this.#touch();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#poller.stop();
    this.#resize?.disconnect();
    clearInterval(this.#clock);
    clearTimeout(this.#idle);
    document.removeEventListener('keydown', this.#onKey);
    document.removeEventListener('visibilitychange', this.#onVisibility);
  }

  /** Switch between the road and the timetable; positions are only polled for the road. */
  show(screen: RouteScreen): void {
    this.screen = screen;
    this.#syncPause();
    if (screen === 'horario' && !this.timetable) void this.#loadTimetable();
    this.#touch();
  }

  #syncPause(): void {
    this.#poller.setPaused(this.screen === 'horario' || document.hidden);
  }

  async #loadTimetable(): Promise<void> {
    const card = this.card;
    const source = this.source;
    if (!card || !source) return;
    try {
      this.timetable = await source.timetable(card.line_id);
    } catch {
      this.problem = 'No se puede obtener ahora el horario de la línea.';
    }
  }

  close(): void {
    this.dispatchEvent(new CustomEvent('route-close', { bubbles: true, composed: true }));
  }

  /** Any interaction keeps it open; a minute untouched closes it. */
  #touch(): void {
    clearTimeout(this.#idle);
    this.#idle = setTimeout(() => this.close(), ROUTE_IDLE_CLOSE_MS);
  }

  get patternId(): string | null {
    return this.card ? cardPatternId(this.card) : null;
  }

  async #load(signal: AbortSignal): Promise<void> {
    const card = this.card;
    const source = this.source;
    const patternId = this.patternId;
    if (!card || !source || !patternId) return;
    try {
      const [catalog, vehicles] = await Promise.all([
        source.catalog(),
        source.vehicles(card.line_id, signal),
      ]);
      this.#catalog = catalog;
      this.#fetchedAt = Date.now();
      this.vehicles = vehicles;
      this.problem = undefined;
    } catch (error) {
      if (signal.aborted) throw error;
      this.problem = 'No se pueden obtener ahora las posiciones de los autobuses.';
      throw error;
    }
  }

  /** Percentage along the track for a position in stop units (0 = first stop shown). */
  #place(at: number, last: number): Record<string, string> {
    const fraction = last > 0 ? at / last : 1;
    return this.orientation === 'horizontal'
      ? { left: `${fraction * 100}%` }
      : { top: `${(1 - fraction) * 100}%` };
  }

  #renderTrack(route: RouteView) {
    const last = route.stops.length - 1;
    const covered = stopsUnderBuses(route);
    const [nextEarlier, ...restEarlier] = route.earlierBuses;
    const firstNameAbove = last % 2 === 1;
    return html`<div class="track" role="img" aria-label=${this.#describe(route)}>
      <div class="line"></div>
      ${route.hiddenStops > 0 ? html`<div class="more before"></div>` : nothing}
      ${route.stopsAfter > 0 ? html`<div class="more after"></div>` : nothing}
      ${route.stops.map(
        (stop, index) =>
          html`<div
            class=${[
              'stop',
              index === last ? 'target' : '',
              stop.terminus ? 'terminus' : '',
              (last - index) % 2 === 1 ? 'above' : '',
              covered.has(index) ? 'covered' : '',
            ].join(' ')}
            style=${styleMap(this.#place(index, last))}
          >
            <span class="dot"></span><span class="name">${stop.name}</span>
          </div>`,
      )}
      ${route.buses.map(
        (bus, index) =>
          html`<div
            class=${index === 0 ? 'bus first' : 'bus'}
            style=${styleMap(this.#place(bus.at, last))}
          >
            <span class="pill">🚌 ${minutesLabel(bus)}</span>
          </div>`,
      )}
      ${
        nextEarlier
          ? html`<div
              class=${[
                'bus earlier',
                route.buses.length === 0 ? 'first' : '',
                firstNameAbove ? 'low' : '',
              ].join(' ')}
            >
              <span class="pill"
                >🚌
                ${minutesLabel(nextEarlier)}${
                  restEarlier.length > 0 ? ` +${restEarlier.length}` : ''
                }</span
              >
            </div>`
          : nothing
      }
    </div>`;
  }

  #renderTimetable(card: Card) {
    if (!this.timetable) return html`<p class="note" role="status">Buscando el horario…</p>`;
    return html`<lb-timetable
      .timetable=${timetableFor(this.timetable, this.patternId) ?? null}
      .now=${this.now}
      stop-name=${card.stop_name}
    ></lb-timetable>`;
  }

  #describe(route: RouteView): string {
    const buses = [...route.buses, ...route.earlierBuses];
    if (buses.length === 0) return 'Ningún autobús de esta línea en camino ahora mismo.';
    return buses
      .map((bus) => {
        const where =
          bus.stopsAway === 0 ? 'llegando a tu parada' : `a ${bus.stopsAway + 1} paradas`;
        return bus.minutes === null
          ? `Un autobús ${where}`
          : `Un autobús ${where}, ${bus.minutes} minutos`;
      })
      .join('. ');
  }

  override render() {
    const card = this.card;
    if (!card) return nothing;
    const route = this.route;
    // By this device's clock alone, so a server or device clock off by minutes does not matter.
    const age = this.vehicles ? this.now - this.#fetchedAt : 0;
    const empty = route && route.buses.length === 0 && route.earlierBuses.length === 0;
    // Empty because positions aged out is not "no bus coming": that waits for fresh data.
    const noBuses = empty && !this.#agedOut && !this.problem && age <= STALE_POSITION_MS;
    // A failed refresh leaves the last positions up, flagged, while they can still be trusted;
    // a road emptied by positions aging out says nothing, so the failure is explained instead.
    const lastRoute = route && age <= STALE_POSITION_MS && !(empty && this.#agedOut) ? route : null;
    return html`
      <header
        style=${styleMap({ '--line-colour': card.colour, '--line-text': card.text_colour })}
        @click=${() => this.#touch()}
      >
        <span class="badge">${card.line_label}</span>
        <div class="title">
          <strong>→ ${route?.headsign ?? card.headsign ?? card.line_name}</strong>
          <span>${nextBusLine(card, this.now)}</span>
        </div>
        <div class="actions">
          <button @click=${() => this.show(this.screen === 'horario' ? 'recorrido' : 'horario')}>
            ${this.screen === 'horario' ? 'Recorrido' : 'Horario'}
          </button>
          <button @click=${() => this.close()}>Volver</button>
        </div>
      </header>
      <div
        class="body"
        style=${styleMap({ '--line-colour': card.colour, '--line-text': card.text_colour })}
        @click=${() => this.#touch()}
      >
        ${
          this.screen === 'recorrido' && this.problem && lastRoute
            ? this.#renderTrack(lastRoute)
            : this.problem
              ? html`<p class="note" role="alert">${this.problem}</p>`
              : this.screen === 'horario'
                ? this.#renderTimetable(card)
                : route
                  ? this.#renderTrack(route)
                  : html`<p class="note" role="status">Buscando los autobuses…</p>`
        }
      </div>
      <footer ?hidden=${this.screen === 'horario'}>
        <span>
          ${[
            route && route.hiddenStops > 0
              ? `${this.orientation === 'horizontal' ? '←' : '↓'} ${hiddenStopsLabel(route)}`
              : '',
            noBuses ? 'Ningún autobús en camino ahora mismo.' : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span>${this.vehicles ? `Posiciones ${formatAge(age)}` : ''}</span>
        ${
          this.problem && lastRoute
            ? html`<span class="problem" role="alert">${this.problem}</span>`
            : nothing
        }
      </footer>
    `;
  }
}

if (!customElements.get('lb-route')) customElements.define('lb-route', LbRoute);

declare global {
  interface HTMLElementTagNameMap {
    'lb-route': LbRoute;
  }
}

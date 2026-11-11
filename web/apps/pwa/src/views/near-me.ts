/**
 * `<lb-near-me>` (`#cerca`): arrivals at the stop the person is standing at, and its pair across
 * the street, without making a board first.
 *
 * It finds the person every time it opens (and on «Volver a ubicar»), so a bookmark or the app's
 * home-screen shortcut works at whichever stop they are. The position is used once and dropped:
 * it is not stored nor put in the URL. Arrivals refresh like on any board with those stops.
 */
import { type LogronoBusBoard, describeError } from '@logrono-bus/board';
import '@logrono-bus/board';
import {
  type BoardConfig,
  type CatalogIndex,
  DEFAULTS,
  type DataSource,
  type NearbyStop,
  formatBoardConfig,
  formatSelection,
} from '@logrono-bus/core';
import { LitElement, type PropertyDeclarations, css, html, nothing } from 'lit';
import { keyed } from 'lit/directives/keyed.js';

import { navigate, sourceFor, wizardHref } from '../context.ts';
import { LocationUnavailable, NO_STOPS_NEARBY, locate } from '../geolocation.ts';
import { NEAR_POOR_ACCURACY_M, nearMeConfig, nearMeStops } from '../near-me.ts';
import { browserStore, loadDisplayPreferences } from '../preferences.ts';
import { uiStyles } from '../ui.ts';
import { boardPageStyles } from './panel.ts';
import type { Here } from './stop-map.ts';

/** Where the person is changes; the data source does not: the app-wide default. */
const NEAR_SOURCE = { source: DEFAULTS.source, api: null } as const;
/** You just walked to the stop: a cached position from elsewhere would pick the wrong one. */
const FRESH_POSITION_MAX_AGE_MS = 0;

/** "Ayuntamiento · nº 101 · a 12 m": the stops shown, so the person can check it is theirs. */
export function nearStopsSummary(stops: readonly NearbyStop[]): string {
  return stops
    .map(({ stop, distance_m }) => `${stop.name} · nº ${stop.id} · a ${Math.round(distance_m)} m`)
    .join(' — ');
}

export class LbNearMe extends LitElement {
  static override properties: PropertyDeclarations = {
    source: { state: true },
    here: { state: true },
    stops: { state: true },
    config: { state: true },
    locating: { state: true },
    problem: { state: true },
  };

  declare source: DataSource | undefined;
  declare here: Here | undefined;
  declare stops: readonly NearbyStop[];
  declare config: BoardConfig | null;
  declare locating: boolean;
  declare problem: string | undefined;
  #catalog: Promise<CatalogIndex> | undefined;

  constructor() {
    super();
    this.source = undefined;
    this.here = undefined;
    this.stops = [];
    this.config = null;
    this.locating = false;
    this.problem = undefined;
  }

  static override styles = [
    uiStyles,
    boardPageStyles,
    css`
      .where {
        margin: 0 0 16px;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#relocate();
  }

  /** Loaded once per view; a failed load is retried on the next «Volver a ubicar». */
  #loadCatalog(): Promise<CatalogIndex> {
    this.#catalog ??= sourceFor(NEAR_SOURCE).then((source) => {
      this.source = source;
      return source.catalog();
    });
    return this.#catalog;
  }

  async #relocate(): Promise<void> {
    this.locating = true;
    this.problem = undefined;
    try {
      const [catalog, here] = await Promise.all([
        this.#loadCatalog(),
        locate(FRESH_POSITION_MAX_AGE_MS),
      ]);
      this.here = here;
      this.stops = nearMeStops(catalog, here);
      this.config = nearMeConfig(this.stops, loadDisplayPreferences(browserStore()));
      if (!this.config) this.problem = NO_STOPS_NEARBY;
    } catch (error) {
      if (error instanceof LocationUnavailable) {
        this.problem = error.message;
      } else {
        this.#catalog = undefined;
        this.problem = describeError(error);
      }
    } finally {
      this.locating = false;
    }
  }

  #refresh(): void {
    void this.renderRoot
      .querySelector<LogronoBusBoard>('logrono-bus-board')
      ?.refresh()
      .catch(() => undefined);
  }

  #saveAsBoard(config: BoardConfig): void {
    navigate(wizardHref(formatBoardConfig(config)));
  }

  #renderWhere() {
    if (this.stops.length === 0) return nothing;
    const accuracyM = this.here?.accuracyM ?? 0;
    return html`<p class="where muted">
      ${nearStopsSummary(this.stops)}
      ${
        accuracyM > NEAR_POOR_ACCURACY_M
          ? html`<br />Tu ubicación es aproximada (± ${Math.round(accuracyM)} m): comprueba que es
              tu parada.`
          : nothing
      }
    </p>`;
  }

  #renderProblem() {
    if (!this.problem) return nothing;
    return html`<div class="surface stack" role="alert">
      <p class="error">${this.problem}</p>
      <p>
        <a
          href=${wizardHref()}
          @click=${(e: Event) => {
            e.preventDefault();
            navigate(wizardHref());
          }}
          >Buscar la parada por nombre o en el mapa</a
        >
      </p>
    </div>`;
  }

  #renderBoard() {
    const { config, source } = this;
    if (config && source) {
      // A fresh board per set of stops: one kept from the previous stop would show its cards
      // (and an open route) under the new stop's name until, or if, the new stop answers.
      return keyed(
        formatSelection(config.stops),
        html`<logrono-bus-board .config=${config} .source=${source}></logrono-bus-board>`,
      );
    }
    if (this.locating) return html`<p class="muted" role="status">Buscando tu ubicación…</p>`;
    return nothing;
  }

  override render() {
    const config = this.config;
    return html`
      <div class="toolbar">
        <h1>Cerca de ti</h1>
        <div class="row">
          <button @click=${() => void this.#relocate()} ?disabled=${this.locating}>
            📍 ${this.locating ? 'Buscando…' : 'Volver a ubicar'}
          </button>
          ${
            config
              ? html`<button @click=${this.#refresh} aria-label="Actualizar ahora">
                    ↻ Actualizar
                  </button>
                  <button @click=${() => this.#saveAsBoard(config)}>✎ Guardar como panel</button>`
              : nothing
          }
        </div>
      </div>
      ${this.#renderWhere()} ${this.#renderProblem()} ${this.#renderBoard()}
    `;
  }
}

if (!customElements.get('lb-near-me')) customElements.define('lb-near-me', LbNearMe);

declare global {
  interface HTMLElementTagNameMap {
    'lb-near-me': LbNearMe;
  }
}

/**
 * `<lb-stop-picker>`: find a stop by location, by name/number, or on a map.
 *
 * Two stops often share a name (both sides of the street are "Ayuntamiento"), so every result
 * also says where its buses go ("hacia Manresa, Dinamarca…"): that is how people actually tell
 * them apart.
 */
import { type CatalogIndex, type NearbyStop, type Stop, isTerminus } from '@logrono-bus/core';
import {
  LitElement,
  type PropertyDeclarations,
  type PropertyValues,
  css,
  html,
  nothing,
} from 'lit';
import { styleMap } from 'lit/directives/style-map.js';

import { uiStyles } from '../ui.ts';

export const NEARBY_RADIUS_M = 600;
export const NEARBY_LIMIT = 12;
export const SEARCH_LIMIT = 15;
const GEOLOCATION_TIMEOUT_MS = 15_000;
/** Plaza del Ayuntamiento, Logroño: where the examples start. */
export const AYUNTAMIENTO = { lat: 42.4655, lon: -2.439 } as const;

export type StopSelectedEvent = CustomEvent<{ stopId: string }>;

interface Result {
  readonly stop: Stop;
  readonly distanceM?: number;
}

/** "hacia Manresa, Dinamarca y Manuel de Falla": destinations served from this stop. */
export function destinationsSummary(catalog: CatalogIndex, stopId: string): string {
  const headsigns = [
    ...new Set(
      catalog
        .patternsAt(stopId)
        .filter((pattern) => !isTerminus(pattern, stopId))
        .map((pattern) => pattern.headsign),
    ),
  ];
  if (headsigns.length === 0) return 'final de trayecto';
  if (headsigns.length === 1) return `hacia ${headsigns[0]}`;
  return `hacia ${headsigns.slice(0, -1).join(', ')} y ${headsigns[headsigns.length - 1] ?? ''}`;
}

export function geolocationError(error: GeolocationPositionError | Error): string {
  if (!window.isSecureContext) {
    return 'El navegador solo permite usar la ubicación en páginas https. Busca la parada por nombre o en el mapa.';
  }
  if ('code' in error && error.code === error.PERMISSION_DENIED) {
    return 'No has dado permiso para usar tu ubicación. Puedes buscar la parada por nombre o en el mapa.';
  }
  return 'No se ha podido obtener tu ubicación. Prueba a buscar la parada por nombre.';
}

export class LbStopPicker extends LitElement {
  static override properties: PropertyDeclarations = {
    catalog: { attribute: false },
    query: { state: true },
    results: { state: true },
    heading: { state: true },
    locating: { state: true },
    problem: { state: true },
    showMap: { state: true },
  };

  declare catalog: CatalogIndex | undefined;
  declare query: string;
  declare results: readonly Result[];
  declare heading: string;
  declare locating: boolean;
  declare problem: string | undefined;
  declare showMap: boolean;

  constructor() {
    super();
    this.catalog = undefined;
    this.query = '';
    this.results = [];
    this.heading = '';
    this.locating = false;
    this.problem = undefined;
    this.showMap = false;
  }

  static override styles = [
    uiStyles,
    css`
      .tools {
        display: grid;
        gap: 10px;
        grid-template-columns: 1fr;
      }
      @media (min-width: 640px) {
        .tools {
          grid-template-columns: 1fr auto auto;
        }
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 8px;
      }
      li button {
        width: 100%;
        justify-content: space-between;
        text-align: start;
        border-radius: 14px;
        padding: 12px 14px;
      }
      .stop {
        display: grid;
        gap: 4px;
      }
      .name {
        font-weight: 700;
      }
      .lines {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .lines .badge {
        font-size: 0.8rem;
      }
      .distance {
        white-space: nowrap;
        color: var(--lb-muted);
        font-weight: 500;
      }
      .map {
        height: 360px;
        border-radius: var(--lb-radius);
        overflow: hidden;
      }
    `,
  ];

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('catalog') && !this.query.trim()) this.#showExamples();
  }

  #showExamples(): void {
    if (!this.catalog) return;
    this.heading = 'Paradas junto al Ayuntamiento';
    this.results = this.catalog
      .nearby(AYUNTAMIENTO.lat, AYUNTAMIENTO.lon, { radiusM: 250, limit: 6 })
      .map((n: NearbyStop) => ({ stop: n.stop, distanceM: n.distance_m }));
  }

  #search(event: Event): void {
    this.query = (event.target as HTMLInputElement).value;
    if (!this.catalog) return;
    if (!this.query.trim()) {
      this.#showExamples();
      return;
    }
    this.heading = `Resultados para «${this.query.trim()}»`;
    this.results = this.catalog
      .search(this.query, { limit: SEARCH_LIMIT })
      .map((stop) => ({ stop }));
  }

  #locate(): void {
    this.problem = undefined;
    if (!('geolocation' in navigator) || !window.isSecureContext) {
      this.problem = geolocationError(new Error('unavailable'));
      return;
    }
    this.locating = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.locating = false;
        if (!this.catalog) return;
        const nearby = this.catalog.nearby(position.coords.latitude, position.coords.longitude, {
          radiusM: NEARBY_RADIUS_M,
          limit: NEARBY_LIMIT,
        });
        this.heading = 'Paradas cerca de ti';
        this.results = nearby.map((n) => ({ stop: n.stop, distanceM: n.distance_m }));
        if (nearby.length === 0) {
          this.problem = `No hay paradas a menos de ${NEARBY_RADIUS_M} m. ¿Estás en Logroño?`;
        }
      },
      (error) => {
        this.locating = false;
        this.problem = geolocationError(error);
      },
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 60_000 },
    );
  }

  async #toggleMap(): Promise<void> {
    this.showMap = !this.showMap;
    if (this.showMap) await import('./stop-map.ts');
  }

  #select(stopId: string): void {
    this.dispatchEvent(
      new CustomEvent('stop-selected', { detail: { stopId }, bubbles: true, composed: true }),
    );
  }

  #renderResult(result: Result) {
    const catalog = this.catalog;
    if (!catalog) return nothing;
    const { stop } = result;
    return html`<li>
      <button @click=${() => this.#select(stop.id)}>
        <span class="stop">
          <span class="name">${stop.name} <span class="muted">· nº ${stop.id}</span></span>
          <span class="muted">${destinationsSummary(catalog, stop.id)}</span>
          <span class="lines">
            ${stop.line_ids.map((lineId) => {
              const line = catalog.line(lineId);
              return html`<span
                class="badge"
                style=${styleMap({ '--line-colour': line.colour, '--line-text': line.text_colour })}
                >${line.label}</span
              >`;
            })}
          </span>
        </span>
        ${
          result.distanceM === undefined
            ? nothing
            : html`<span class="distance">${Math.round(result.distanceM)} m</span>`
        }
      </button>
    </li>`;
  }

  override render() {
    return html`
      <div class="stack">
        <div class="tools">
          <label>
            <span class="visually-hidden">Buscar parada</span>
            <input
              type="search"
              placeholder="Nombre o número de parada (p. ej. Ayuntamiento)"
              .value=${this.query}
              @input=${this.#search}
              autocomplete="off"
              enterkeyhint="search"
            />
          </label>
          <button @click=${this.#locate} ?disabled=${this.locating}>
            ${this.locating ? 'Buscando…' : '📍 Cerca de mí'}
          </button>
          <button @click=${this.#toggleMap} aria-pressed=${this.showMap}>
            🗺️ ${this.showMap ? 'Ocultar mapa' : 'Ver mapa'}
          </button>
        </div>
        ${this.problem ? html`<p class="error" role="alert">${this.problem}</p>` : nothing}
        ${
          this.showMap && this.catalog
            ? html`<lb-stop-map
                class="map"
                .stops=${this.catalog.stops}
                @stop-selected=${(e: StopSelectedEvent) => {
                  e.stopPropagation();
                  this.#select(e.detail.stopId);
                }}
              ></lb-stop-map>`
            : nothing
        }
        <h3>${this.heading}</h3>
        ${
          this.results.length === 0 && this.query
            ? html`<p class="muted">Ninguna parada coincide.</p>`
            : nothing
        }
        <ul>
          ${this.results.map((result) => this.#renderResult(result))}
        </ul>
      </div>
    `;
  }
}

if (!customElements.get('lb-stop-picker')) customElements.define('lb-stop-picker', LbStopPicker);

declare global {
  interface HTMLElementTagNameMap {
    'lb-stop-picker': LbStopPicker;
  }
}

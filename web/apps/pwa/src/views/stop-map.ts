/**
 * `<lb-stop-map>`: every stop on an OpenStreetMap map. Loaded on demand (Leaflet is the largest
 * dependency), and rendered in light DOM because Leaflet's stylesheet is global.
 */
import type { Stop } from '@logrono-bus/core';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LitElement, type PropertyDeclarations, type PropertyValues } from 'lit';

import { AYUNTAMIENTO } from './stop-picker.ts';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>';
const INITIAL_ZOOM = 15;
const MAX_ZOOM = 19;
const STOP_RADIUS_PX = 7;

export class LbStopMap extends LitElement {
  static override properties: PropertyDeclarations = {
    stops: { attribute: false },
  };

  declare stops: readonly Stop[];
  #map: L.Map | undefined;
  #layer: L.LayerGroup | undefined;

  constructor() {
    super();
    this.stops = [];
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override firstUpdated(): void {
    this.style.display = 'block';
    this.#map = L.map(this, { zoomControl: true }).setView(
      [AYUNTAMIENTO.lat, AYUNTAMIENTO.lon],
      INITIAL_ZOOM,
    );
    L.tileLayer(TILE_URL, { maxZoom: MAX_ZOOM, attribution: ATTRIBUTION }).addTo(this.#map);
    this.#layer = L.layerGroup().addTo(this.#map);
    this.#drawStops();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('stops') && this.#map) this.#drawStops();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#map?.remove();
    this.#map = undefined;
  }

  #drawStops(): void {
    const layer = this.#layer;
    if (!layer) return;
    layer.clearLayers();
    for (const stop of this.stops) {
      L.circleMarker([stop.lat, stop.lon], {
        radius: STOP_RADIUS_PX,
        color: '#8c1c2c',
        weight: 2,
        fillColor: '#ffffff',
        fillOpacity: 1,
      })
        .bindTooltip(`${stop.name} · nº ${stop.id}`)
        .on('click', () =>
          this.dispatchEvent(
            new CustomEvent('stop-selected', { detail: { stopId: stop.id }, bubbles: true }),
          ),
        )
        .addTo(layer);
    }
  }
}

if (!customElements.get('lb-stop-map')) customElements.define('lb-stop-map', LbStopMap);

declare global {
  interface HTMLElementTagNameMap {
    'lb-stop-map': LbStopMap;
  }
}

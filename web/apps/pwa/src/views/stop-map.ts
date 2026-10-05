/**
 * `<lb-stop-map>`: every stop on an OpenStreetMap map. Loaded on demand (Leaflet is the largest
 * dependency). It lives inside the stop picker's shadow root, where a global stylesheet never
 * reaches, so Leaflet's CSS is adopted by the map's own shadow root.
 *
 * Given the person's position it marks it and centres the map there. The position never leaves
 * the browser: it only places the marker.
 */
import type { CatalogIndex, Stop } from '@logrono-bus/core';
import L from 'leaflet';
import leafletCss from 'leaflet/dist/leaflet.css?inline';
import {
  css,
  html,
  LitElement,
  type PropertyDeclarations,
  type PropertyValues,
  unsafeCSS,
} from 'lit';

import { badgeStyles } from '../ui.ts';
import { AYUNTAMIENTO } from './stop-picker.ts';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>';
const INITIAL_ZOOM = 15;
const MAX_ZOOM = 19;
const STOP_RADIUS_PX = 7;
const STOP_COLOUR = '#8c1c2c';
/** Zoom the map comes to when centring on the person, unless it is already closer. */
const HERE_ZOOM = 17;
const HERE_RADIUS_PX = 8;
const HERE_COLOUR = '#1a73e8';

/** Where the person is, as reported by the browser. */
export interface Here {
  readonly lat: number;
  readonly lon: number;
  readonly accuracyM: number;
}

export class LbStopMap extends LitElement {
  static override properties: PropertyDeclarations = {
    catalog: { attribute: false },
    here: { attribute: false },
  };

  declare catalog: CatalogIndex | undefined;
  declare here: Here | undefined;
  #map: L.Map | undefined;
  #stopsLayer: L.LayerGroup | undefined;
  #hereLayer: L.LayerGroup | undefined;

  constructor() {
    super();
    this.catalog = undefined;
    this.here = undefined;
  }

  static override styles = [
    unsafeCSS(leafletCss),
    badgeStyles,
    css`
      :host {
        display: block;
      }
      .canvas {
        height: 100%;
      }
      /* Under the pointer the arrow cursor covers a tooltip that starts at the stop's centre:
         the tooltip sits clear of the stop on a longer arrow. */
      .leaflet-tooltip {
        font-family: var(--lb-font);
        font-size: 0.85rem;
        padding: 6px 8px;
        border-radius: 8px;
      }
      .leaflet-tooltip-right {
        margin-left: 20px;
      }
      .leaflet-tooltip-left {
        margin-left: -20px;
      }
      .leaflet-tooltip-right::before,
      .leaflet-tooltip-left::before {
        border-width: 6px 10px;
      }
      .leaflet-tooltip-right::before {
        margin-left: -20px;
      }
      .leaflet-tooltip-left::before {
        margin-right: -20px;
      }
      .tooltip {
        display: grid;
        gap: 4px;
      }
      .tooltip .name {
        font-weight: 700;
      }
      .tooltip .lines {
        display: flex;
        gap: 4px;
      }
      .tooltip .badge {
        font-size: 0.8rem;
      }
    `,
  ];

  override render() {
    return html`<div class="canvas"></div>`;
  }

  override firstUpdated(): void {
    const canvas = this.renderRoot.querySelector<HTMLElement>('.canvas');
    if (!canvas) return;
    this.#map = L.map(canvas, { zoomControl: true }).setView(
      [AYUNTAMIENTO.lat, AYUNTAMIENTO.lon],
      INITIAL_ZOOM,
    );
    L.tileLayer(TILE_URL, { maxZoom: MAX_ZOOM, attribution: ATTRIBUTION }).addTo(this.#map);
    this.#stopsLayer = L.layerGroup().addTo(this.#map);
    this.#hereLayer = L.layerGroup().addTo(this.#map);
  }

  /** Runs right after `firstUpdated` too, so the first draw happens here. */
  protected override updated(changed: PropertyValues<this>): void {
    if (!this.#map) return;
    if (changed.has('catalog')) this.#drawStops();
    if (changed.has('here')) {
      this.#drawHere();
      this.#centreOnHere();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#map?.remove();
    this.#map = undefined;
  }

  #drawStops(): void {
    const layer = this.#stopsLayer;
    const catalog = this.catalog;
    if (!layer) return;
    layer.clearLayers();
    if (!catalog) return;
    for (const stop of catalog.stops) {
      L.circleMarker([stop.lat, stop.lon], {
        className: 'stop',
        radius: STOP_RADIUS_PX,
        color: STOP_COLOUR,
        weight: 2,
        fillColor: '#ffffff',
        fillOpacity: 1,
      })
        .bindTooltip(() => tooltipFor(stop, catalog))
        .on('click', () =>
          this.dispatchEvent(
            new CustomEvent('stop-selected', { detail: { stopId: stop.id }, bubbles: true }),
          ),
        )
        .addTo(layer);
    }
  }

  /** The person's dot over the circle of how far off it may be; clicks pass through to stops. */
  #drawHere(): void {
    const layer = this.#hereLayer;
    if (!layer) return;
    layer.clearLayers();
    const here = this.here;
    if (!here) return;
    const centre: L.LatLngExpression = [here.lat, here.lon];
    L.circle(centre, {
      className: 'here-accuracy',
      radius: here.accuracyM,
      color: HERE_COLOUR,
      weight: 1,
      fillColor: HERE_COLOUR,
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(layer);
    L.circleMarker(centre, {
      className: 'here',
      radius: HERE_RADIUS_PX,
      color: '#ffffff',
      weight: 3,
      fillColor: HERE_COLOUR,
      fillOpacity: 1,
      interactive: false,
    }).addTo(layer);
  }

  #centreOnHere(): void {
    const map = this.#map;
    const here = this.here;
    if (!map || !here) return;
    map.setView([here.lat, here.lon], Math.max(map.getZoom(), HERE_ZOOM));
  }
}

/**
 * "Ayuntamiento · nº 101" over the stop's lines in their colours. Leaflet renders string tooltips
 * as HTML, so it gets a node: upstream names go in as text.
 */
export function tooltipFor(stop: Stop, catalog: CatalogIndex): HTMLElement {
  const tooltip = document.createElement('span');
  tooltip.className = 'tooltip';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = `${stop.name} · nº ${stop.id}`;
  const lines = document.createElement('span');
  lines.className = 'lines';
  for (const lineId of stop.line_ids) {
    const line = catalog.line(lineId);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.style.setProperty('--line-colour', line.colour);
    badge.style.setProperty('--line-text', line.text_colour);
    badge.textContent = line.label;
    lines.append(badge);
  }
  tooltip.append(name, lines);
  return tooltip;
}

if (!customElements.get('lb-stop-map')) customElements.define('lb-stop-map', LbStopMap);

declare global {
  interface HTMLElementTagNameMap {
    'lb-stop-map': LbStopMap;
  }
}

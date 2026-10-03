/**
 * `custom:logrono-bus-card`: the web's cards in a Home Assistant dashboard, fed by the Logroño
 * Bus integration's sensors. Tapping a card opens the route view; bus positions are not sensors,
 * so that view asks the Ayuntamiento's public service directly from the browser.
 */
import { FONT_STACKS, type GridLayout } from '@logrono-bus/board';
import '@logrono-bus/board';
import {
  type Card,
  type DataSource,
  DirectSource,
  type ServiceStatus,
  SafeStorage,
  UPSTREAM_BASE_URL,
} from '@logrono-bus/core';
import {
  LitElement,
  type PropertyDeclarations,
  type PropertyValues,
  css,
  html,
  nothing,
} from 'lit';

import { CARD_TYPE, type CardConfig, normalizeConfig } from './config.ts';
import { busMinuteSensors, cardsFromHass, servicesFromHass } from './entities.ts';
import type { HomeAssistant } from './ha.ts';

export const TICK_MS = 5_000;
/** Rows of the Lovelace sections grid per card, roughly. */
const ROWS_PER_CARD = 3;

export class LogronoBusCard extends LitElement {
  static override properties: PropertyDeclarations = {
    hass: { attribute: false },
    config: { state: true },
    now: { state: true },
    opened: { state: true },
  };

  declare hass: HomeAssistant | undefined;
  declare config: CardConfig | undefined;
  declare now: number;
  declare opened: Card | undefined;

  #tick: ReturnType<typeof setInterval> | undefined;
  #source: DataSource | undefined;
  #cards: Card[] = [];
  #services = new Map<string, ServiceStatus>();

  constructor() {
    super();
    this.hass = undefined;
    this.config = undefined;
    this.now = Date.now();
    this.opened = undefined;
  }

  /** Lovelace: called with the YAML/editor configuration; throwing shows the error on the card. */
  setConfig(config: unknown): void {
    this.config = normalizeConfig(config);
  }

  getCardSize(): number {
    return Math.max(2, (this.config?.entities.length ?? 1) * ROWS_PER_CARD);
  }

  getGridOptions(): { columns: number | string; rows?: number | string; min_columns: number } {
    return { columns: 12, min_columns: 6 };
  }

  static async getConfigElement(): Promise<HTMLElement> {
    await import('./editor.ts');
    return document.createElement(`${CARD_TYPE}-editor`);
  }

  static getStubConfig(hass: HomeAssistant): Record<string, unknown> {
    return { entities: busMinuteSensors(hass).slice(0, 4), orden: 'llegada' };
  }

  static override styles = css`
    :host {
      display: block;
      /* Home Assistant theme → card tokens. */
      --lb-bg: var(--card-background-color, var(--ha-card-background, #fff));
      --lb-fg: var(--primary-text-color, #111);
      --lb-muted: var(--secondary-text-color, #555);
      --lb-surface: var(--card-background-color, #fff);
      --lb-border: var(--divider-color, #ddd);
      --lb-radius: var(--ha-card-border-radius, 12px);
      --lb-focus: var(--primary-color, #03a9f4);
      --lb-card-min: 200px;
    }
    ha-card {
      color: var(--primary-text-color, inherit);
      padding: 12px;
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    h1 {
      margin: 0 4px;
      font-size: 1.2em;
      font-weight: 600;
    }
    :host([modo='pantalla']) ha-card {
      height: calc(100vh - var(--header-height, 56px) - 16px);
    }
    lb-card-grid {
      flex: 1;
      min-height: 0;
    }
    .empty {
      margin: 8px 4px;
      color: var(--lb-muted);
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#tick = setInterval(() => (this.now = Date.now()), TICK_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.#tick);
  }

  /** Re-render only when one of this card's sensors changed (hass updates very often). */
  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    if (!changed.has('hass') || changed.size > 1) return true;
    const previous: HomeAssistant | undefined = changed.get('hass');
    const config = this.config;
    if (!previous || !config || !this.hass) return true;
    return config.entities.some((id) => previous.states[id] !== this.hass?.states[id]);
  }

  protected override willUpdate(): void {
    const config = this.config;
    if (!config) return;
    this.setAttribute('modo', config.modo);
    this.style.setProperty('--lb-text-scale', String(config.tam / 100));
    this.style.fontFamily = config.letra === 'sistema' ? '' : FONT_STACKS[config.letra];
    if (this.hass) {
      this.#cards = cardsFromHass(this.hass, config.entities);
      this.#services = servicesFromHass(this.hass, config.entities);
    }
  }

  get #routeSource(): DataSource {
    this.#source ??= new DirectSource(UPSTREAM_BASE_URL, {
      store: new SafeStorage(() => globalThis.localStorage),
    });
    return this.#source;
  }

  #renderRoute() {
    const card = this.opened;
    const config = this.config;
    if (!card || !config) return nothing;
    return html`<lb-route
      .card=${card}
      .source=${this.#routeSource}
      .previousStops=${config.previas}
      .arrivals=${{ stop_id: card.stop_id, generated_at: new Date().toISOString(), arrivals: card.arrivals }}
      @route-close=${() => (this.opened = undefined)}
    ></lb-route>`;
  }

  override render() {
    const config = this.config;
    if (!config) return nothing;
    const layout: GridLayout = config.modo === 'pantalla' ? 'kiosk' : 'auto';
    return html`<ha-card>
      ${config.titulo ? html`<h1>${config.titulo}</h1>` : nothing}
      ${
        this.#cards.length === 0
          ? html`<p class="empty">
              No hay datos de los sensores elegidos. Comprueba que pertenecen a la integración
              Logroño Bus.
            </p>`
          : html`<lb-card-grid
              .cards=${this.#cards}
              .services=${this.#services}
              .now=${this.now}
              order=${config.orden}
              colour=${config.color}
              effect=${config.efecto}
              alert-minutes=${config.aviso}
              layout=${layout}
              .openable=${config.recorrido}
              @card-open=${(event: CustomEvent<Card>) => (this.opened = event.detail)}
            ></lb-card-grid>`
      }
      ${this.#renderRoute()}
    </ha-card>`;
  }
}

if (!customElements.get(CARD_TYPE)) customElements.define(CARD_TYPE, LogronoBusCard);

declare global {
  interface HTMLElementTagNameMap {
    'logrono-bus-card': LogronoBusCard;
  }
}

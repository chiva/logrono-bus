/** `<lb-panel>`: a board with a toolbar to share it, edit it or switch to screen mode. */
import { type LogronoBusBoard, describeError } from '@logrono-bus/board';
import '@logrono-bus/board';
import {
  type BoardConfig,
  type CatalogIndex,
  type DataSource,
  displayPreferencesOf,
  formatBoardConfig,
} from '@logrono-bus/core';
import { LitElement, type PropertyDeclarations, css, html, nothing } from 'lit';

import { boardUrl, navigate, sourceFor, wizardHref } from '../context.ts';
import { applyTheme } from '../preferences.ts';
import { uiStyles } from '../ui.ts';
import { type DisplayChangeEvent } from './display-settings.ts';
import './display-settings.ts';
import './share.ts';

/** Board title: the configured one, or the stop names. */
export function boardTitle(config: BoardConfig, catalog: CatalogIndex | undefined): string {
  if (config.title) return config.title;
  const names = config.stops.map(
    (s) => catalog?.findStop(s.stop_id)?.name ?? `Parada ${s.stop_id}`,
  );
  return [...new Set(names)].join(' · ');
}

export class LbPanel extends LitElement {
  static override properties: PropertyDeclarations = {
    config: { attribute: false },
    catalog: { state: true },
    source: { state: true },
    problem: { state: true },
    sharing: { state: true },
    styling: { state: true },
  };

  declare config: BoardConfig;
  declare catalog: CatalogIndex | undefined;
  /** Shared with the rest of the app (see context.ts), so the server probe and the catalogue
   * load happen once. */
  declare source: DataSource | undefined;
  declare problem: string | undefined;
  declare sharing: boolean;
  declare styling: boolean;

  constructor() {
    super();
    this.catalog = undefined;
    this.source = undefined;
    this.problem = undefined;
    this.sharing = false;
    this.styling = false;
  }

  static override styles = [
    uiStyles,
    css`
      :host {
        display: block;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }
      h1 {
        margin: 0;
        font-size: clamp(1.4rem, 4vw, 2rem);
      }
      logrono-bus-board {
        --lb-card-min: 250px;
      }
      @media (max-width: 600px) {
        logrono-bus-board {
          --lb-card-min: 150px;
          --lb-card-padding: 10px 12px;
        }
        .toolbar .row button {
          padding: 0.4em 0.8em;
        }
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    void sourceFor(this.config)
      .then((source) => {
        this.source = source;
        return source.catalog();
      })
      .then((catalog) => (this.catalog = catalog))
      .catch((error: unknown) => {
        if (!this.source) this.problem = describeError(error);
      });
  }

  get #query(): string {
    return formatBoardConfig(this.config);
  }

  /** Live display change: re-render, and keep it in the URL so the link carries it. */
  #restyle(event: DisplayChangeEvent): void {
    this.config = { ...this.config, ...event.detail };
    applyTheme(this.config.theme);
    history.replaceState(null, '', `?${formatBoardConfig(this.config)}`);
  }

  #refresh(): void {
    void this.renderRoot
      .querySelector<LogronoBusBoard>('logrono-bus-board')
      ?.refresh()
      .catch(() => undefined);
  }

  override render() {
    return html`
      <div class="toolbar">
        <h1>${boardTitle(this.config, this.catalog)}</h1>
        <div class="row">
          <button @click=${this.#refresh} aria-label="Actualizar ahora">↻ Actualizar</button>
          <button @click=${() => (this.styling = !this.styling)} aria-expanded=${this.styling}>
            🎨 Aspecto
          </button>
          <button @click=${() => (this.sharing = !this.sharing)} aria-expanded=${this.sharing}>
            🔗 Compartir
          </button>
          <button @click=${() => navigate(wizardHref(this.#query))}>✎ Editar</button>
          <button
            class="primary"
            @click=${() => navigate(`./?${formatBoardConfig({ ...this.config, mode: 'kiosko' })}`)}
          >
            📺 Modo pantalla
          </button>
        </div>
      </div>
      ${
        this.styling
          ? html`<div class="surface" style="margin-bottom:16px">
              <lb-display-settings
                .value=${displayPreferencesOf(this.config)}
                @display-change=${this.#restyle}
              ></lb-display-settings>
            </div>`
          : nothing
      }
      ${
        this.sharing
          ? html`<div class="surface" style="margin-bottom:16px">
              <lb-share .url=${boardUrl(this.#query)}></lb-share>
            </div>`
          : nothing
      }
      ${
        this.source
          ? html`<logrono-bus-board
              .config=${this.config}
              .source=${this.source}
            ></logrono-bus-board>`
          : html`<p
              class=${this.problem ? 'error' : 'muted'}
              role=${this.problem ? 'alert' : 'status'}
            >
              ${this.problem ?? 'Cargando llegadas…'}
            </p>`
      }
    `;
  }
}

if (!customElements.get('lb-panel')) customElements.define('lb-panel', LbPanel);

declare global {
  interface HTMLElementTagNameMap {
    'lb-panel': LbPanel;
  }
}

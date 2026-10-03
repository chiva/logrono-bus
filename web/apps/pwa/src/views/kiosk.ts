/**
 * `<lb-kiosk>`: full-screen board for a wall screen (Echo Show 5: 960×480).
 *
 * No navigation chrome: a slim header with title and clock, cards filling the rest. A tap toggles
 * full screen (where allowed) and reveals an exit link. See docs/guia/05-echo-show.md.
 */
import type { LogronoBusBoard } from '@logrono-bus/board';
import { FONT_STACKS, describeError, formatClock } from '@logrono-bus/board';
import '@logrono-bus/board';
import {
  type BoardConfig,
  type CatalogIndex,
  type DataSource,
  displayPreferencesOf,
  formatBoardConfig,
} from '@logrono-bus/core';
import { LitElement, type PropertyDeclarations, css, html, nothing } from 'lit';

import { sourceFor } from '../context.ts';
import { KioskGuard, keepScreenOn } from '../kiosk-guard.ts';
import { applyTheme } from '../preferences.ts';
import { type DisplayChangeEvent } from './display-settings.ts';
import './display-settings.ts';
import { boardTitle } from './panel.ts';

const CLOCK_TICK_MS = 1_000;
const CONTROLS_VISIBLE_MS = 6_000;

export class LbKiosk extends LitElement {
  static override properties: PropertyDeclarations = {
    config: { attribute: false },
    catalog: { state: true },
    source: { state: true },
    problem: { state: true },
    now: { state: true },
    resumed: { state: true },
    controls: { state: true },
    styling: { state: true },
  };

  declare config: BoardConfig;
  declare catalog: CatalogIndex | undefined;
  /** Shared with the rest of the app (see context.ts), so the server probe and the catalogue
   * load happen once. */
  declare source: DataSource | undefined;
  declare problem: string | undefined;
  declare now: number;
  declare resumed: boolean;
  declare controls: boolean;
  declare styling: boolean;

  #clock: ReturnType<typeof setInterval> | undefined;
  #hideControls: ReturnType<typeof setTimeout> | undefined;
  #releaseWakeLock: () => void = () => undefined;
  readonly #guard = new KioskGuard({
    onFrozen: () => {
      this.resumed = true;
      void this.#board?.refresh().catch(() => undefined);
    },
    reload: () => location.reload(),
  });

  constructor() {
    super();
    this.catalog = undefined;
    this.source = undefined;
    this.problem = undefined;
    this.now = Date.now();
    this.resumed = false;
    this.controls = false;
    this.styling = false;
  }

  static override styles = css`
    :host {
      position: fixed;
      inset: 0;
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 8px;
      padding: 10px 12px 8px;
      background: var(--lb-bg);
      color: var(--lb-fg);
      font-family: var(--lb-font);
      --lb-gap: 10px;
      --lb-card-padding: 10px 14px;
      overflow: hidden;
      cursor: default;
    }
    header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }
    h1 {
      margin: 0;
      font-size: calc(clamp(1rem, 3.2vh + 0.6vw, 2.8rem) * var(--lb-text-scale, 1));
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    time {
      font-size: calc(clamp(1.2rem, 5vh, 3.6rem) * var(--lb-text-scale, 1));
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
    logrono-bus-board {
      min-height: 0;
    }
    .banner,
    .controls {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: 16px;
      padding: 10px 18px;
      border-radius: 999px;
      font-weight: 700;
      box-shadow: 0 6px 20px rgb(0 0 0 / 0.3);
    }
    .banner {
      background: var(--lb-warning-bg);
      color: var(--lb-warning-fg);
      border: 0;
      font: inherit;
      font-weight: 700;
    }
    .controls {
      display: flex;
      gap: 12px;
      background: var(--lb-surface);
      color: var(--lb-fg);
    }
    .message {
      align-self: center;
      justify-self: center;
      font-size: clamp(1.1rem, 4vh, 2rem);
      text-align: center;
      max-width: 40ch;
    }
    .sheet {
      position: fixed;
      inset: auto 12px 12px 12px;
      max-height: calc(100% - 24px);
      overflow: auto;
      padding: 16px;
      border-radius: var(--lb-radius, 18px);
      background: var(--lb-surface);
      color: var(--lb-fg);
      box-shadow: 0 10px 40px rgb(0 0 0 / 0.4);
      font-size: 16px;
    }
    .close {
      font: inherit;
      font-weight: 700;
      margin-top: 12px;
      min-height: 44px;
      padding: 0.5em 1.2em;
      border-radius: 999px;
      border: 1px solid var(--lb-border);
      background: var(--lb-accent);
      color: var(--lb-accent-fg);
    }
    .controls a {
      color: inherit;
    }
  `;

  protected override willUpdate(): void {
    this.style.fontFamily = FONT_STACKS[this.config.font];
    this.style.setProperty('--lb-text-scale', String(this.config.textScale / 100));
  }

  get #board(): LogronoBusBoard | null {
    return this.renderRoot.querySelector('logrono-bus-board');
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#clock = setInterval(() => (this.now = Date.now()), CLOCK_TICK_MS);
    this.#guard.start();
    void keepScreenOn().then((release) => (this.#releaseWakeLock = release));
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

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.#clock);
    clearTimeout(this.#hideControls);
    this.#guard.stop();
    this.#releaseWakeLock();
  }

  /** A tap on a card opens its route view (board); anywhere else shows the controls. */
  #onBoardTap(event: Event): void {
    const onCard = event
      .composedPath()
      .some(
        (node) =>
          node instanceof HTMLElement &&
          node.tagName === 'LB-CARD' &&
          node.hasAttribute('openable'),
      );
    if (!onCard) this.#onTap();
  }

  #onTap(): void {
    this.resumed = false;
    this.controls = true;
    clearTimeout(this.#hideControls);
    this.#hideControls = setTimeout(() => (this.controls = false), CONTROLS_VISIBLE_MS);
  }

  #restyle(event: DisplayChangeEvent): void {
    this.config = { ...this.config, ...event.detail };
    applyTheme(this.config.theme);
    history.replaceState(null, '', `?${formatBoardConfig(this.config)}`);
  }

  #openSettings(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.styling = true;
    this.controls = false;
  }

  async #fullScreen(event: Event): Promise<void> {
    event.stopPropagation();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Not allowed on this device (Silk on Echo Show ignores it): the kiosk works regardless.
    }
  }

  override render() {
    const panelQuery = formatBoardConfig({ ...this.config, mode: 'panel' });
    return html`
      <header @click=${this.#onTap}>
        <h1>${boardTitle(this.config, this.catalog)}</h1>
        <time datetime=${new Date(this.now).toISOString()}>${formatClock(this.now)}</time>
      </header>
      ${
        this.source
          ? html`<logrono-bus-board
              layout="kiosk"
              .config=${this.config}
              .source=${this.source}
              @click=${this.#onBoardTap}
            ></logrono-bus-board>`
          : html`<p class="message" role=${this.problem ? 'alert' : 'status'}>
              ${this.problem ?? 'Cargando llegadas…'}
            </p>`
      }
      ${
        this.resumed
          ? html`<button class="banner" @click=${this.#onTap}>
              La pantalla estaba en pausa: datos actualizados. Toca para continuar.
            </button>`
          : nothing
      }
      ${
        this.styling
          ? html`<div class="sheet" role="dialog" aria-label="Ajustes de pantalla">
              <lb-display-settings
                .value=${displayPreferencesOf(this.config)}
                @display-change=${this.#restyle}
              ></lb-display-settings>
              <button class="close" @click=${() => (this.styling = false)}>Cerrar</button>
            </div>`
          : nothing
      }
      ${
        this.controls
          ? html`<nav class="controls" aria-label="Controles de pantalla">
              <a href="#" @click=${this.#openSettings}>Ajustes</a>
              <a href="#" @click=${this.#fullScreen}>Pantalla completa</a>
              <a href=${`./?${panelQuery}`}>Salir del modo pantalla</a>
            </nav>`
          : nothing
      }
    `;
  }
}

if (!customElements.get('lb-kiosk')) customElements.define('lb-kiosk', LbKiosk);

declare global {
  interface HTMLElementTagNameMap {
    'lb-kiosk': LbKiosk;
  }
}

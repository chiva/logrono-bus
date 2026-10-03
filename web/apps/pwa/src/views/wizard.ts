/**
 * `<lb-wizard>`: build a board in three steps: stop → lines and direction → summary.
 *
 * The result is only ever a URL (see core/config.ts): nothing is uploaded, and the same link
 * works on a phone, an Echo Show or inside Home Assistant.
 */
import {
  type BoardConfig,
  type CatalogIndex,
  DEFAULTS,
  type DataSource,
  type DisplayPreferences,
  type LineSelection,
  MAX_PER_CARD,
  MIN_PER_CARD,
  type Pattern,
  type StopSelection,
  directionCode,
  displayPreferencesOf,
  formatBoardConfig,
  formatSelection,
  isTerminus,
} from '@logrono-bus/core';
import '@logrono-bus/board';
import { LitElement, type PropertyDeclarations, css, html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';

import { boardUrl, navigate, sourceFor } from '../context.ts';
import { applyTheme, browserStore, loadDisplayPreferences, saveBoard } from '../preferences.ts';
import { uiStyles } from '../ui.ts';
import { BUILT_IN_DISPLAY, type DisplayChangeEvent } from './display-settings.ts';
import './display-settings.ts';
import './share.ts';
import { type StopSelectedEvent, destinationsSummary } from './stop-picker.ts';
import './stop-picker.ts';

export type WizardStep = 'parada' | 'lineas' | 'resumen';

/** Directions a rider can board at this stop (buses that end their trip here are left out). */
export function boardablePatterns(catalog: CatalogIndex, stopId: string): Pattern[] {
  return catalog.patternsAt(stopId).filter((pattern) => !isTerminus(pattern, stopId));
}

const patternKey = (lineId: string, direction: string | null): string =>
  `${lineId}${directionCode(direction === 'asc' || direction === 'desc' ? direction : null)}`;

/** Selecting every boardable direction collapses to the bare stop, which also adapts if lines change. */
export function selectionFor(
  catalog: CatalogIndex,
  stopId: string,
  chosen: ReadonlySet<string>,
): StopSelection {
  const patterns = boardablePatterns(catalog, stopId);
  if (patterns.every((p) => chosen.has(patternKey(p.line_id, p.direction)))) {
    return { stop_id: stopId, lines: [] };
  }
  const lines: LineSelection[] = patterns
    .filter((p) => chosen.has(patternKey(p.line_id, p.direction)))
    .map((p) => ({ line_id: p.line_id, direction: p.direction }));
  return { stop_id: stopId, lines };
}

export class LbWizard extends LitElement {
  static override properties: PropertyDeclarations = {
    initial: { attribute: false },
    catalog: { state: true },
    source: { state: true },
    step: { state: true },
    stops: { state: true },
    pendingStop: { state: true },
    chosen: { state: true },
    boardTitle: { state: true },
    display: { state: true },
    perCard: { state: true },
    sharing: { state: true },
    saved: { state: true },
    problem: { state: true },
  };

  declare initial: BoardConfig | null;
  declare catalog: CatalogIndex | undefined;
  declare source: DataSource | undefined;
  declare step: WizardStep;
  declare stops: readonly StopSelection[];
  declare pendingStop: string | undefined;
  declare chosen: ReadonlySet<string>;
  /** Not `title`: that name belongs to HTMLElement (the tooltip attribute). */
  declare boardTitle: string;
  declare display: DisplayPreferences;
  declare perCard: number;
  declare sharing: boolean;
  declare saved: boolean;
  declare problem: string | undefined;

  constructor() {
    super();
    this.initial = null;
    this.catalog = undefined;
    this.source = undefined;
    this.step = 'parada';
    this.stops = [];
    this.pendingStop = undefined;
    this.chosen = new Set();
    this.boardTitle = '';
    this.display = { ...BUILT_IN_DISPLAY, ...loadDisplayPreferences(browserStore()) };
    this.perCard = DEFAULTS.perCard;
    this.sharing = false;
    this.saved = false;
    this.problem = undefined;
  }

  static override styles = [
    uiStyles,
    css`
      :host {
        display: block;
      }
      ol.steps {
        list-style: none;
        padding: 0;
        margin: 0 0 16px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        color: var(--lb-muted);
        font-weight: 600;
      }
      ol.steps li[aria-current='step'] {
        color: var(--lb-fg);
      }
      .chips {
        display: grid;
        gap: 8px;
      }
      .chip {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-radius: 14px;
        border: 2px solid var(--lb-border);
        background: var(--lb-surface);
        cursor: pointer;
        font-weight: 600;
      }
      .chip.checked {
        border-color: var(--lb-accent);
        background: var(--lb-surface-2);
      }
      .chip input {
        width: 22px;
        height: 22px;
        min-height: 0;
        accent-color: var(--lb-accent);
      }
      .chosen {
        display: grid;
        gap: 10px;
      }
      .chosen li {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
      }
      .chosen ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 10px;
      }
      .options {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      }
      .preview {
        margin-top: 8px;
      }
    `,
  ];

  #preview: { key: string; config: BoardConfig } | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.initial) {
      this.stops = [...this.initial.stops];
      this.boardTitle = this.initial.title ?? '';
      this.display = displayPreferencesOf(this.initial);
      this.perCard = this.initial.perCard;
      this.step = 'resumen';
    }
    void this.#loadCatalog();
  }

  async #loadCatalog(): Promise<void> {
    try {
      this.source = await sourceFor(this.initial ?? DEFAULTS);
      this.catalog = await this.source.catalog();
    } catch (error) {
      this.problem = `No se ha podido cargar la lista de paradas: ${(error as Error).message}`;
    }
  }

  /** Same object while stops and arrivals-per-card are unchanged, so typing a title does not
   * make the preview board refetch. */
  get previewConfig(): BoardConfig | null {
    const draft = this.draft;
    if (!draft) return null;
    const key = `${formatSelection(draft.stops)}|${draft.perCard}`;
    if (this.#preview?.key !== key) this.#preview = { key, config: draft };
    return this.#preview.config;
  }

  /** The board as configured so far (null until it has at least one stop). */
  get draft(): BoardConfig | null {
    if (this.stops.length === 0) return null;
    return {
      ...(this.initial ?? DEFAULTS),
      stops: this.stops,
      ...this.display,
      title: this.boardTitle.trim() || null,
      perCard: this.perCard,
      mode: 'panel',
    };
  }

  #pickStop(event: StopSelectedEvent): void {
    const catalog = this.catalog;
    if (!catalog) return;
    this.pendingStop = event.detail.stopId;
    this.chosen = new Set(
      boardablePatterns(catalog, event.detail.stopId).map((p) =>
        patternKey(p.line_id, p.direction),
      ),
    );
    this.step = 'lineas';
  }

  #toggle(key: string, checked: boolean): void {
    const next = new Set(this.chosen);
    if (checked) next.add(key);
    else next.delete(key);
    this.chosen = next;
  }

  #confirmLines(): void {
    if (!this.catalog || !this.pendingStop) return;
    const selection = selectionFor(this.catalog, this.pendingStop, this.chosen);
    this.stops = [...this.stops.filter((s) => s.stop_id !== this.pendingStop), selection];
    this.pendingStop = undefined;
    this.step = 'resumen';
    this.saved = false;
  }

  #remove(stopId: string): void {
    this.stops = this.stops.filter((s) => s.stop_id !== stopId);
    if (this.stops.length === 0) this.step = 'parada';
  }

  #open(mode: 'panel' | 'kiosko'): void {
    const draft = this.draft;
    if (draft) navigate(`./?${formatBoardConfig({ ...draft, mode })}`);
  }

  #save(): void {
    const draft = this.draft;
    const catalog = this.catalog;
    if (!draft || !catalog) return;
    const name = draft.title ?? this.stops.map((s) => catalog.stop(s.stop_id).name).join(' · ');
    saveBoard(browserStore(), name, formatBoardConfig(draft));
    this.saved = true;
  }

  #renderSteps() {
    const labels: [WizardStep, string][] = [
      ['parada', '1. Parada'],
      ['lineas', '2. Líneas'],
      ['resumen', '3. Tu panel'],
    ];
    return html`<ol class="steps">
      ${labels.map(
        ([step, label]) =>
          html`<li aria-current=${this.step === step ? 'step' : 'false'}>${label}</li>`,
      )}
    </ol>`;
  }

  #renderLines(catalog: CatalogIndex, stopId: string) {
    const stop = catalog.stop(stopId);
    const patterns = boardablePatterns(catalog, stopId);
    return html`
      <h2>${stop.name} <span class="muted">· nº ${stop.id}</span></h2>
      <p class="muted">Elige qué líneas y en qué sentido quieres ver.</p>
      <div class="chips" role="group" aria-label="Líneas y sentidos">
        ${patterns.map((pattern) => {
          const line = catalog.line(pattern.line_id);
          const key = patternKey(pattern.line_id, pattern.direction);
          return html`<label class=${this.chosen.has(key) ? 'chip checked' : 'chip'}>
            <input
              type="checkbox"
              .checked=${this.chosen.has(key)}
              @change=${(e: Event) => this.#toggle(key, (e.target as HTMLInputElement).checked)}
            />
            <span
              class="badge"
              style=${styleMap({ '--line-colour': line.colour, '--line-text': line.text_colour })}
              >${line.label}</span
            >
            <span>→ ${pattern.headsign}</span>
          </label>`;
        })}
      </div>
      ${
        patterns.length === 0
          ? html`<p class="error">En esta parada solo terminan trayectos; elige otra.</p>`
          : nothing
      }
      <div class="row" style="margin-top:16px">
        <button class="primary" ?disabled=${this.chosen.size === 0} @click=${this.#confirmLines}>
          Añadir al panel
        </button>
        <button
          class="ghost"
          @click=${() => (this.step = this.stops.length ? 'resumen' : 'parada')}
        >
          Volver
        </button>
      </div>
    `;
  }

  #renderSummary(catalog: CatalogIndex) {
    const draft = this.draft;
    return html`
      <h2>Tu panel</h2>
      <div class="chosen">
        <ul>
          ${this.stops.map((selection) => {
            const stop = catalog.findStop(selection.stop_id);
            const lines = selection.lines.length
              ? selection.lines
                  .map((l) => {
                    const pattern = catalog.pattern(`${l.line_id}:${l.direction}`);
                    const label = catalog.hasLine(l.line_id)
                      ? catalog.line(l.line_id).label
                      : l.line_id;
                    return pattern ? `${label} → ${pattern.headsign}` : `${label} (ambos sentidos)`;
                  })
                  .join(' · ')
              : `Todas las líneas (${destinationsSummary(catalog, selection.stop_id)})`;
            return html`<li class="surface">
              <span>
                <strong>${stop?.name ?? selection.stop_id}</strong>
                <span class="muted">· nº ${selection.stop_id}</span><br />
                <span class="muted">${lines}</span>
              </span>
              <button
                class="ghost"
                @click=${() => this.#remove(selection.stop_id)}
                aria-label=${`Quitar ${stop?.name ?? selection.stop_id}`}
              >
                ✕
              </button>
            </li>`;
          })}
        </ul>
        <div class="row">
          <button @click=${() => (this.step = 'parada')}>＋ Añadir otra parada</button>
        </div>
      </div>

      <h3 style="margin-top:24px">Aspecto</h3>
      <div class="options">
        <label>
          Título (opcional)
          <input
            .value=${this.boardTitle}
            maxlength="40"
            placeholder="Casa, Trabajo…"
            @input=${(e: Event) => (this.boardTitle = (e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Llegadas por tarjeta
          <select
            @change=${(e: Event) => (this.perCard = Number((e.target as HTMLSelectElement).value))}
          >
            ${Array.from(
              { length: MAX_PER_CARD - MIN_PER_CARD + 1 },
              (_, i) => i + MIN_PER_CARD,
            ).map((n) => html`<option value=${n} ?selected=${n === this.perCard}>${n}</option>`)}
          </select>
        </label>
      </div>

      <div class="surface" style="margin-top:16px">
        <lb-display-settings
          .value=${this.display}
          @display-change=${(e: DisplayChangeEvent) => {
            this.display = e.detail;
            applyTheme(e.detail.theme);
          }}
        ></lb-display-settings>
      </div>

      <div class="row" style="margin-top:20px">
        <button class="primary" @click=${() => this.#open('panel')}>Abrir panel</button>
        <button @click=${() => this.#open('kiosko')}>📺 Modo pantalla (Echo Show)</button>
        <button @click=${() => (this.sharing = !this.sharing)}>🔗 Compartir / QR</button>
        <button @click=${this.#save}>
          ${this.saved ? 'Guardado ✓' : '⭐ Guardar en este dispositivo'}
        </button>
      </div>
      ${
        this.sharing && draft
          ? html`<div class="surface" style="margin-top:16px">
              <lb-share .url=${boardUrl(formatBoardConfig(draft))}></lb-share>
            </div>`
          : nothing
      }

      <h3 style="margin-top:24px">Vista previa</h3>
      ${
        this.previewConfig
          ? html`<logrono-bus-board
              class="preview"
              .config=${this.previewConfig}
              .source=${this.source}
            ></logrono-bus-board>`
          : nothing
      }
    `;
  }

  override render() {
    const catalog = this.catalog;
    if (this.problem) return html`<p class="error" role="alert">${this.problem}</p>`;
    if (!catalog) return html`<p role="status">Cargando paradas…</p>`;
    return html`
      ${this.#renderSteps()}
      ${
        this.step === 'parada'
          ? html`<h2>¿Qué parada te interesa?</h2>
              <lb-stop-picker .catalog=${catalog} @stop-selected=${this.#pickStop}></lb-stop-picker>
              ${
                this.stops.length
                  ? html`<div class="row" style="margin-top:16px">
                      <button class="ghost" @click=${() => (this.step = 'resumen')}>
                        Volver a tu panel
                      </button>
                    </div>`
                  : nothing
              }`
          : nothing
      }
      ${
        this.step === 'lineas' && this.pendingStop
          ? this.#renderLines(catalog, this.pendingStop)
          : nothing
      }
      ${this.step === 'resumen' ? this.#renderSummary(catalog) : nothing}
    `;
  }
}

if (!customElements.get('lb-wizard')) customElements.define('lb-wizard', LbWizard);

declare global {
  interface HTMLElementTagNameMap {
    'lb-wizard': LbWizard;
  }
}

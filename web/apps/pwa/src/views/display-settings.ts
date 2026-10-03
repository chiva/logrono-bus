/**
 * `<lb-display-settings>`: how a board looks — theme, text size, colour intensity, font, the
 * "bus is close" highlight, card order and how much of the route a tapped card shows.
 *
 * Changes apply live (`display-change`) and are kept in the board's link, so they travel with it
 * to an Echo Show or Portal. "Guardar en este dispositivo" also makes them this device's defaults
 * for links that do not set them.
 */
import {
  COLOURS,
  DEFAULTS,
  type DisplayPreferences,
  EFFECTS,
  FONTS,
  MAX_ALERT_MINUTES,
  MAX_PREVIOUS_STOPS,
  MAX_TEXT_SCALE,
  MIN_PREVIOUS_STOPS,
  MIN_TEXT_SCALE,
  ORDERS,
  TEXT_SCALE_STEP,
  THEMES,
} from '@logrono-bus/core';
import { LitElement, type PropertyDeclarations, css, html } from 'lit';

import {
  COLOUR_NAMES,
  EFFECT_NAMES,
  FONT_NAMES,
  ORDER_NAMES,
  THEME_NAMES,
  browserStore,
  saveDisplayPreferences,
} from '../preferences.ts';
import { uiStyles } from '../ui.ts';

export type DisplayChangeEvent = CustomEvent<DisplayPreferences>;

export const BUILT_IN_DISPLAY: DisplayPreferences = {
  theme: DEFAULTS.theme,
  textScale: DEFAULTS.textScale,
  colour: DEFAULTS.colour,
  font: DEFAULTS.font,
  alertMinutes: DEFAULTS.alertMinutes,
  effect: DEFAULTS.effect,
  order: DEFAULTS.order,
  previousStops: DEFAULTS.previousStops,
};

export class LbDisplaySettings extends LitElement {
  static override properties: PropertyDeclarations = {
    value: { attribute: false },
    saved: { state: true },
  };

  declare value: DisplayPreferences;
  declare saved: boolean;

  constructor() {
    super();
    this.value = BUILT_IN_DISPLAY;
    this.saved = false;
  }

  static override styles = [
    uiStyles,
    css`
      :host {
        display: block;
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      }
      input[type='range'] {
        padding: 0;
        accent-color: var(--lb-accent);
      }
      .value {
        font-weight: 500;
        color: var(--lb-muted);
      }
      fieldset {
        border: 0;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 6px;
      }
      legend {
        font-weight: 600;
        margin-bottom: 6px;
      }
      .segmented {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .segmented label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0.4em 0.9em;
        border-radius: 999px;
        border: 1px solid var(--lb-border);
        font-weight: 600;
        cursor: pointer;
      }
      .segmented input {
        width: auto;
        min-height: 0;
        accent-color: var(--lb-accent);
      }
    `,
  ];

  #change(patch: Partial<DisplayPreferences>): void {
    this.value = { ...this.value, ...patch };
    this.saved = false;
    this.dispatchEvent(
      new CustomEvent('display-change', { detail: this.value, bubbles: true, composed: true }),
    );
  }

  #saveAsDefault(): void {
    saveDisplayPreferences(browserStore(), this.value);
    this.saved = true;
  }

  override render() {
    const v = this.value;
    const select = <T extends string>(
      label: string,
      options: readonly T[],
      names: Readonly<Record<T, string>>,
      current: T,
      apply: (value: T) => void,
    ) =>
      html`<label>
        ${label}
        <select @change=${(e: Event) => apply((e.target as HTMLSelectElement).value as T)}>
          ${options.map(
            (option) =>
              html`<option value=${option} ?selected=${option === current}>
                ${names[option]}
              </option>`,
          )}
        </select>
      </label>`;
    return html`
      <div class="grid">
        ${select('Tema', THEMES, THEME_NAMES, v.theme, (theme) => this.#change({ theme }))}
        <label>
          <span>Tamaño del texto <span class="value">${v.textScale} %</span></span>
          <input
            type="range"
            min=${MIN_TEXT_SCALE}
            max=${MAX_TEXT_SCALE}
            step=${TEXT_SCALE_STEP}
            .value=${String(v.textScale)}
            aria-valuetext=${`${v.textScale} por ciento`}
            @input=${(e: Event) =>
              this.#change({ textScale: Number((e.target as HTMLInputElement).value) })}
          />
        </label>
        <fieldset>
          <legend>Intensidad del color</legend>
          <div class="segmented">
            ${COLOURS.map(
              (colour) =>
                html`<label
                  ><input
                    type="radio"
                    name="colour"
                    .checked=${colour === v.colour}
                    @change=${() => this.#change({ colour })}
                  />${COLOUR_NAMES[colour]}</label
                >`,
            )}
          </div>
        </fieldset>
        ${select('Tipo de letra', FONTS, FONT_NAMES, v.font, (font) => this.#change({ font }))}
        <label>
          Avisar cuando falten
          <select
            @change=${(e: Event) =>
              this.#change({ alertMinutes: Number((e.target as HTMLSelectElement).value) })}
          >
            <option value="0" ?selected=${v.alertMinutes === 0}>No avisar</option>
            ${Array.from({ length: MAX_ALERT_MINUTES }, (_, i) => i + 1).map(
              (minutes) =>
                html`<option value=${minutes} ?selected=${minutes === v.alertMinutes}>
                  ${minutes} min o menos
                </option>`,
            )}
          </select>
        </label>
        ${select('Orden de las tarjetas', ORDERS, ORDER_NAMES, v.order, (order) =>
          this.#change({ order }),
        )}
        ${select('Efecto del aviso', EFFECTS, EFFECT_NAMES, v.effect, (effect) =>
          this.#change({ effect }),
        )}
        <label>
          Paradas previas en el recorrido
          <select
            @change=${(e: Event) =>
              this.#change({ previousStops: Number((e.target as HTMLSelectElement).value) })}
          >
            ${Array.from(
              { length: MAX_PREVIOUS_STOPS - MIN_PREVIOUS_STOPS + 1 },
              (_, i) => MIN_PREVIOUS_STOPS + i,
            ).map(
              (stops) =>
                html`<option value=${stops} ?selected=${stops === v.previousStops}>
                  ${stops} ${stops === 1 ? 'parada' : 'paradas'}
                </option>`,
            )}
          </select>
        </label>
      </div>
      <div class="row" style="margin-top:16px">
        <button @click=${this.#saveAsDefault}>
          ${this.saved ? 'Guardado en este dispositivo ✓' : '💾 Guardar en este dispositivo'}
        </button>
        <button class="ghost" @click=${() => this.#change(BUILT_IN_DISPLAY)}>Restablecer</button>
      </div>
      <p class="muted" style="margin-top:8px">
        Los ajustes se guardan en el enlace del panel. «Guardar en este dispositivo» además los usa
        por defecto aquí en los paneles que no digan otra cosa.
      </p>
    `;
  }
}

if (!customElements.get('lb-display-settings')) {
  customElements.define('lb-display-settings', LbDisplaySettings);
}

declare global {
  interface HTMLElementTagNameMap {
    'lb-display-settings': LbDisplaySettings;
  }
}

/**
 * Visual editor for `custom:logrono-bus-card`, built on Home Assistant's own `ha-form` so it looks
 * and behaves like every other card editor (entity pickers, selects, sliders).
 */
import { DEFAULTS, MAX_PREVIOUS_STOPS, MIN_PREVIOUS_STOPS } from '@logrono-bus/core';
import { LitElement, type PropertyDeclarations, html, nothing } from 'lit';

import { CARD_TYPE, type CardConfig, normalizeConfig } from './config.ts';
import { type HomeAssistant, fireConfigChanged } from './ha.ts';

const option = (value: string, label: string) => ({ value, label });

/** ha-form schema: selectors understood by Home Assistant's frontend. */
export const EDITOR_SCHEMA = [
  {
    name: 'entities',
    required: true,
    selector: {
      entity: {
        multiple: true,
        filter: { integration: 'logrono_bus', domain: 'sensor', device_class: 'duration' },
      },
    },
  },
  { name: 'titulo', selector: { text: {} } },
  {
    type: 'grid',
    name: '',
    schema: [
      {
        name: 'orden',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              option('seleccion', 'Como las elegí'),
              option('linea', 'Por número de línea'),
              option('llegada', 'El que llega antes, primero'),
            ],
          },
        },
      },
      {
        name: 'modo',
        selector: {
          select: {
            mode: 'dropdown',
            options: [option('normal', 'Normal'), option('pantalla', 'Pantalla (llena la vista)')],
          },
        },
      },
      {
        name: 'aviso',
        selector: { number: { min: 0, max: 15, mode: 'box', unit_of_measurement: 'min' } },
      },
      {
        name: 'efecto',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              option('pulso', 'Parpadeo suave'),
              option('borde', 'Borde fijo'),
              option('ninguno', 'Sin efecto'),
            ],
          },
        },
      },
      {
        name: 'color',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              option('suave', 'Suave'),
              option('normal', 'Normal'),
              option('intensa', 'Intensa'),
            ],
          },
        },
      },
      {
        name: 'letra',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              option('sistema', 'La del sistema'),
              option('legible', 'Muy legible'),
              option('redondeada', 'Redondeada'),
              option('mono', 'Tipo panel'),
            ],
          },
        },
      },
      {
        name: 'tam',
        selector: {
          number: { min: 80, max: 150, step: 10, mode: 'slider', unit_of_measurement: '%' },
        },
      },
      { name: 'recorrido', selector: { boolean: {} } },
      {
        name: 'previas',
        selector: {
          number: { min: MIN_PREVIOUS_STOPS, max: MAX_PREVIOUS_STOPS, mode: 'box' },
        },
      },
    ],
  },
] as const;

export const EDITOR_LABELS: Readonly<Record<string, string>> = {
  entities: 'Líneas (sensores «… minutos» de Logroño Bus)',
  titulo: 'Título',
  orden: 'Orden de las tarjetas',
  modo: 'Modo',
  aviso: 'Avisar cuando falten (0 = no avisar)',
  efecto: 'Efecto del aviso',
  color: 'Intensidad del color',
  letra: 'Tipo de letra',
  tam: 'Tamaño del texto',
  recorrido: 'Al tocar, ver el recorrido y dónde está el autobús',
  previas: 'Paradas previas en el recorrido',
};

export class LogronoBusCardEditor extends LitElement {
  static override properties: PropertyDeclarations = {
    hass: { attribute: false },
    config: { state: true },
  };

  declare hass: HomeAssistant | undefined;
  declare config: Record<string, unknown> | undefined;

  constructor() {
    super();
    this.hass = undefined;
    this.config = undefined;
  }

  setConfig(config: Record<string, unknown>): void {
    this.config = config;
  }

  /** What the form shows: the user's values over the defaults. */
  get formData(): Record<string, unknown> {
    const defaults: Partial<CardConfig> = {
      orden: DEFAULTS.order,
      aviso: DEFAULTS.alertMinutes,
      efecto: DEFAULTS.effect,
      color: DEFAULTS.colour,
      letra: DEFAULTS.font,
      tam: DEFAULTS.textScale,
      modo: 'normal',
      recorrido: true,
      previas: DEFAULTS.previousStops,
    };
    return { ...defaults, ...this.config };
  }

  #changed(event: CustomEvent<{ value: Record<string, unknown> }>): void {
    event.stopPropagation();
    const value = { ...event.detail.value, type: `custom:${CARD_TYPE}` };
    try {
      normalizeConfig(value);
    } catch {
      // Incomplete while editing (no entity yet): still propagate so the preview explains it.
    }
    this.config = value;
    fireConfigChanged(this, value);
  }

  override render() {
    if (!this.hass || !this.config) return nothing;
    return html`<ha-form
      .hass=${this.hass}
      .data=${this.formData}
      .schema=${EDITOR_SCHEMA}
      .computeLabel=${(item: { name: string }) => EDITOR_LABELS[item.name] ?? item.name}
      @value-changed=${this.#changed}
    ></ha-form>`;
  }
}

const EDITOR_TAG = `${CARD_TYPE}-editor`;
if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, LogronoBusCardEditor);

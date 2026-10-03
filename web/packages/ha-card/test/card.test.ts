import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardConfigError, normalizeConfig } from '../src/config.ts';
import { EDITOR_LABELS, EDITOR_SCHEMA } from '../src/editor.ts';
import {
  busMinuteSensors,
  cardFromEntity,
  cardsFromHass,
  isBusEntity,
  serviceFromEntity,
  servicesFromHass,
} from '../src/entities.ts';
import type { HassEntity, HomeAssistant } from '../src/ha.ts';
import { LogronoBusCard } from '../src/index.ts';

const NOW = Date.parse('2026-10-03T16:00:45Z');

function sensor(id: string, attributes: Record<string, unknown>, state = '1'): HassEntity {
  return { entity_id: id, state, attributes, last_updated: '2026-10-03T16:00:45Z' };
}

const line2 = (unit: string | undefined) =>
  sensor(`sensor.ayuntamiento_101_2_manresa_${unit ? 'minutos' : 'proxima_llegada'}`, {
    ...(unit ? { unit_of_measurement: unit } : {}),
    linea: '2',
    linea_id: '2',
    nombre_linea: 'Yagüe – Varea',
    parada: 'Ayuntamiento',
    parada_id: '101',
    sentido: 'desc',
    destino: 'Manresa',
    color: '#FFFF00',
    color_texto: '#000000',
    llegadas: [
      { hora: '2026-10-03T18:02:28+02:00', tiempo_real: true },
      { hora: '2026-10-03T18:08:02+02:00', tiempo_real: false },
      { hora: 'roto' },
    ],
  });

const line10 = sensor('sensor.ayuntamiento_101_10_manuel_de_falla_minutos', {
  unit_of_measurement: 'min',
  linea: '10',
  linea_id: '10',
  parada: 'Ayuntamiento',
  parada_id: '101',
  sentido: 'desc',
  destino: 'Manuel de Falla',
  color: '#0FDCFC',
  color_texto: '#000000',
  llegadas: [{ hora: '2026-10-03T18:01:30+02:00', tiempo_real: true }],
});

const hass = (...entities: HassEntity[]): HomeAssistant => ({
  states: Object.fromEntries(entities.map((e) => [e.entity_id, e])),
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sensors → cards', () => {
  it('builds a card from the integration attributes', () => {
    const card = cardFromEntity(line2('min'))!;
    expect(card).toMatchObject({
      stop_id: '101',
      stop_name: 'Ayuntamiento',
      line_label: '2',
      line_name: 'Yagüe – Varea',
      colour: '#FFFF00',
      direction: 'desc',
      headsign: 'Manresa',
    });
    expect(card.arrivals.map((a) => [a.expected, a.is_realtime, a.pattern_id])).toEqual([
      ['2026-10-03T18:02:28+02:00', true, '2:desc'],
      ['2026-10-03T18:08:02+02:00', false, '2:desc'],
    ]);
  });

  it('ignores foreign entities and collapses the two sensors of one line', () => {
    const other = sensor('sensor.salon_temperatura', { unit_of_measurement: '°C' });
    expect(isBusEntity(other)).toBe(false);
    expect(cardFromEntity(undefined)).toBeNull();
    const h = hass(line2('min'), line2(undefined), line10, other);
    const cards = cardsFromHass(h, [
      'sensor.ayuntamiento_101_2_manresa_minutos',
      'sensor.ayuntamiento_101_2_manresa_proxima_llegada',
      'sensor.ayuntamiento_101_10_manuel_de_falla_minutos',
      'sensor.salon_temperatura',
      'sensor.no_existe',
    ]);
    expect(cards.map((c) => c.line_label)).toEqual(['2', '10']);
    expect(busMinuteSensors(h)).toEqual([
      'sensor.ayuntamiento_101_10_manuel_de_falla_minutos',
      'sensor.ayuntamiento_101_2_manresa_minutos',
    ]);
  });

  it('reads where the line stands in its day from the timetable attributes', () => {
    const finished = sensor(line10.entity_id, {
      ...line10.attributes,
      llegadas: [],
      servicio: 'terminado',
      primera_salida: '08:00',
      ultima_salida: '23:00',
      proxima_salida: null,
      frecuencia_min: null,
      frecuencia_max_min: null,
    });
    expect(serviceFromEntity(finished)).toEqual({
      state: 'terminado',
      first: '08:00',
      last: '23:00',
      next_departure: null,
      interval_min: null,
      interval_max_min: null,
    });
    // An integration too old to know timetables, or one that could not fetch it.
    expect(serviceFromEntity(line2('min'))).toBeNull();
    expect(serviceFromEntity(sensor('sensor.x', { linea_id: '7', servicio: 'quizá' }))).toBeNull();
    const services = servicesFromHass(hass(finished, line2('min')), [
      finished.entity_id,
      'sensor.ayuntamiento_101_2_manresa_minutos',
    ]);
    expect([...services.keys()]).toEqual(['101|10|desc']);
  });

  it('tolerates missing attributes', () => {
    const card = cardFromEntity(sensor('sensor.x', { linea_id: '7', sentido: 'sideways' }))!;
    expect(card).toMatchObject({ line_label: '7', direction: null, headsign: null, arrivals: [] });
  });
});

describe('configuration', () => {
  it('requires entities and fills defaults', () => {
    expect(() => normalizeConfig(null)).toThrow(CardConfigError);
    expect(() => normalizeConfig({ entities: [] })).toThrow('_minutos');
    expect(normalizeConfig({ entities: ['sensor.a', 3] })).toEqual({
      type: 'custom:logrono-bus-card',
      entities: ['sensor.a'],
      orden: 'seleccion',
      aviso: 3,
      efecto: 'pulso',
      color: 'normal',
      letra: 'sistema',
      tam: 100,
      modo: 'normal',
      recorrido: true,
      previas: 4,
    });
  });

  it('clamps and validates every option', () => {
    const config = normalizeConfig({
      entities: ['sensor.a'],
      titulo: '  Casa ',
      orden: 'llegada',
      aviso: 99,
      efecto: 'borde',
      color: 'neon',
      letra: 'legible',
      tam: 133,
      modo: 'pantalla',
      recorrido: false,
      previas: 30,
    });
    expect(config).toMatchObject({
      titulo: 'Casa',
      orden: 'llegada',
      aviso: 15,
      efecto: 'borde',
      color: 'normal',
      letra: 'legible',
      tam: 130,
      modo: 'pantalla',
      recorrido: false,
      previas: 12,
    });
    expect(normalizeConfig({ entities: ['a'], aviso: 'x', tam: 'y', previas: 'z' })).toMatchObject({
      aviso: 3,
      tam: 100,
      previas: 4,
    });
  });

  it('labels every editor field in Spanish', () => {
    const names = EDITOR_SCHEMA.flatMap((field) =>
      'schema' in field ? field.schema.map((f) => f.name) : [field.name],
    );
    expect(names.every((name) => EDITOR_LABELS[name])).toBe(true);
  });
});

describe('<logrono-bus-card>', () => {
  async function mount(config: Record<string, unknown>, h: HomeAssistant) {
    const card = document.createElement('logrono-bus-card');
    card.setConfig({ type: 'custom:logrono-bus-card', ...config });
    card.hass = h;
    document.body.append(card);
    await card.updateComplete;
    return card;
  }

  const cardsIn = (card: LogronoBusCard) => [
    ...(card.shadowRoot?.querySelector('lb-card-grid')?.shadowRoot?.querySelectorAll('lb-card') ??
      []),
  ];

  it('draws the sensors as web cards, in the chosen order, with the HA theme', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const card = await mount(
      {
        entities: [line2('min').entity_id, line10.entity_id],
        orden: 'llegada',
        titulo: 'Casa',
        tam: 120,
      },
      hass(line2('min'), line10),
    );
    expect(card.shadowRoot!.querySelector('h1')?.textContent).toBe('Casa');
    const grid = card.shadowRoot!.querySelector('lb-card-grid')!;
    await grid.updateComplete;
    expect(
      cardsIn(card).map((c) => (c as unknown as { card: { line_label: string } }).card.line_label),
    ).toEqual(['10', '2']);
    expect(card.style.getPropertyValue('--lb-text-scale')).toBe('1.2');
    expect(card.getAttribute('modo')).toBe('normal');
    expect(card.getCardSize()).toBe(6);
    expect(card.getGridOptions()).toMatchObject({ columns: 12 });
  });

  it('explains when the sensors are not from the integration', async () => {
    const card = await mount({ entities: ['sensor.salon'] }, hass());
    expect(card.shadowRoot!.querySelector('.empty')?.textContent).toContain('Logroño Bus');
  });

  it('only re-renders when its own sensors change', async () => {
    const h = hass(line2('min'));
    const card = await mount({ entities: [line2('min').entity_id] }, h);
    const spy = vi.spyOn(card, 'render');
    card.hass = { states: { ...h.states, 'sensor.otro': sensor('sensor.otro', {}) } };
    await card.updateComplete;
    expect(spy).not.toHaveBeenCalled();
    card.hass = hass({ ...line2('min'), state: '0' });
    await card.updateComplete;
    expect(spy).toHaveBeenCalledOnce();
  });

  it('explains a line with no bus due using the sensor timetable', async () => {
    const finished = sensor(line10.entity_id, {
      ...line10.attributes,
      llegadas: [],
      servicio: 'terminado',
      primera_salida: '08:00',
      ultima_salida: '23:00',
    });
    const card = await mount({ entities: [finished.entity_id] }, hass(finished));
    await card.shadowRoot!.querySelector('lb-card-grid')!.updateComplete;
    const [inner] = cardsIn(card);
    await (inner as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect((inner as HTMLElement).shadowRoot!.querySelector('.empty')?.textContent?.trim()).toBe(
      'Servicio terminado · última salida 23:00',
    );
  });

  it('opens the route view on tap, unless disabled', async () => {
    // The route view asks the Ayuntamiento for bus positions: keep tests off the network.
    vi.stubGlobal('fetch', () => new Promise(() => undefined));
    const card = await mount({ entities: [line2('min').entity_id] }, hass(line2('min')));
    await card.shadowRoot!.querySelector('lb-card-grid')!.updateComplete;
    const [inner] = cardsIn(card);
    (inner as HTMLElement).shadowRoot!.querySelector('article')!.click();
    await card.updateComplete;
    const route = card.shadowRoot!.querySelector('lb-route');
    expect(route).not.toBeNull();
    expect(route!.previousStops).toBe(4);
    route!.dispatchEvent(new CustomEvent('route-close', { bubbles: true, composed: true }));
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('lb-route')).toBeNull();

    const off = await mount(
      { entities: [line2('min').entity_id], recorrido: false },
      hass(line2('min')),
    );
    await off.shadowRoot!.querySelector('lb-card-grid')!.updateComplete;
    expect((cardsIn(off)[0] as HTMLElement).hasAttribute('openable')).toBe(false);
  });

  it('offers a starting configuration and a visual editor', async () => {
    expect(LogronoBusCard.getStubConfig(hass(line2('min'), line10))).toEqual({
      entities: [
        'sensor.ayuntamiento_101_10_manuel_de_falla_minutos',
        'sensor.ayuntamiento_101_2_manresa_minutos',
      ],
      orden: 'llegada',
    });
    const editor = (await LogronoBusCard.getConfigElement()) as HTMLElement & {
      hass: HomeAssistant;
      setConfig(c: unknown): void;
      formData: Record<string, unknown>;
      updateComplete: Promise<boolean>;
    };
    editor.hass = hass(line2('min'));
    editor.setConfig({ type: 'custom:logrono-bus-card', entities: [] });
    document.body.append(editor);
    await editor.updateComplete;
    expect(editor.formData).toMatchObject({
      orden: 'seleccion',
      recorrido: true,
      previas: 4,
      entities: [],
    });
    const changed = vi.fn();
    editor.addEventListener('config-changed', changed);
    editor.shadowRoot!.querySelector('ha-form')!.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { entities: ['sensor.a'], orden: 'linea' } },
      }),
    );
    expect(changed.mock.calls[0]?.[0].detail.config).toEqual({
      entities: ['sensor.a'],
      orden: 'linea',
      type: 'custom:logrono-bus-card',
    });
  });

  it('registers itself in the card picker', () => {
    expect(window.customCards?.some((c) => c.type === 'logrono-bus-card')).toBe(true);
  });
});

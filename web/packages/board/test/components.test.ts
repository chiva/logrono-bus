import {
  type BoardConfig,
  type CatalogIndex,
  type DataSource,
  DirectionResolver,
  StopNotFound,
  UpstreamSchemaError,
  UpstreamUnavailable,
  type LineTimetable,
  type LineVehicles,
  STALE_POSITION_MS,
  type ServiceStatus,
  normalizeArrivals,
  normalizeTimetable,
  normalizeVehicles,
  parseArrivals,
  parseVehicles,
  parseBoardConfig,
  parseTimetable,
} from '@logrono-bus/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type LbCard,
  type LogronoBusBoard,
  describeError,
  minutesLabel,
  nextBusLine,
  ROUTE_IDLE_CLOSE_MS,
  serviceSentence,
  routable,
  stopsUnderBuses,
} from '../src/index.ts';
import { fixtureCatalog, loadFixture } from '../../core/test/fixtures.ts';

const RECORDED_AT = Date.parse('2026-10-03T16:00:45Z');
const catalog = fixtureCatalog();

function arrivalsFor(stopId: string, fixture: string) {
  return normalizeArrivals(
    parseArrivals(loadFixture(fixture)),
    stopId,
    catalog,
    new DirectionResolver(catalog),
    new Date(RECORDED_AT).toISOString(),
  );
}

class FakeSource implements DataSource {
  readonly kind = 'directa' as const;
  calls: string[] = [];
  failWith: Error | undefined;

  catalog(): Promise<CatalogIndex> {
    return Promise.resolve(catalog);
  }

  vehicleCalls: string[] = [];

  vehicles(lineId: string): Promise<LineVehicles> {
    this.vehicleCalls.push(lineId);
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve(
      normalizeVehicles(
        parseVehicles(loadFixture(`upstream/vehicles-${lineId}.json`)),
        lineId,
        catalog,
        new Date(RECORDED_AT).toISOString(),
      ),
    );
  }

  /** Recording to answer arrivals with (`{stop}` is replaced by the stop id). */
  arrivalsFixture = 'upstream/arrivals-{stop}.json';

  arrivals(stopId: string): Promise<ReturnType<typeof arrivalsFor>> {
    this.calls.push(stopId);
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve(arrivalsFor(stopId, this.arrivalsFixture.replace('{stop}', stopId)));
  }

  timetableCalls: string[] = [];

  /** Lines with a recorded timetable (2 and 10); the rest fail like an unreachable upstream. */
  timetable(lineId: string): Promise<LineTimetable> {
    this.timetableCalls.push(lineId);
    if (lineId !== '2' && lineId !== '10') {
      return Promise.reject(new UpstreamUnavailable(`sin horario grabado para la línea ${lineId}`));
    }
    return Promise.resolve(
      normalizeTimetable(
        parseTimetable(loadFixture(`upstream/timetable-${lineId}.json`)),
        lineId,
        catalog,
        new Date(RECORDED_AT).toISOString(),
      ),
    );
  }
}

async function mountBoard(query: string, source: DataSource): Promise<LogronoBusBoard> {
  const board = document.createElement('logrono-bus-board');
  board.config = parseBoardConfig(query) as BoardConfig;
  board.source = source;
  document.body.append(board);
  await vi.waitFor(() => expect(board.status).not.toBe('loading'));
  await board.updateComplete;
  return board;
}

const cardsOf = (board: LogronoBusBoard): LbCard[] => [
  ...(board.shadowRoot?.querySelector('lb-card-grid')?.shadowRoot?.querySelectorAll('lb-card') ??
    []),
];

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('<logrono-bus-board>', () => {
  it('renders one card per selected line, coloured by line, one request per stop', async () => {
    vi.useFakeTimers({ now: RECORDED_AT, toFake: ['Date'] });
    const source = new FakeSource();
    const board = await mountBoard('p=101-2d.7d~100-2a&n=2', source);
    const cards = cardsOf(board);
    expect(cards.map((card) => `${card.card?.line_label}${card.card?.headsign}`)).toEqual([
      '2Manresa',
      '7Enrique Granados',
      '2Artesanos',
    ]);
    expect(source.calls.sort()).toEqual(['100', '101']);
    await cards[0]!.updateComplete;
    const article = cards[0]!.shadowRoot!.querySelector('article')!;
    expect(article.style.getPropertyValue('--line-colour')).toBe('#FFFF00');
    expect(article.style.getPropertyValue('--line-text')).toBe('#000000');
    expect(article.getAttribute('aria-label')).toBe(
      'Línea 2 hacia Manresa, parada Ayuntamiento: en 1 minuto, en 7 minutos. ¡Llega pronto!',
    );
    await cards[1]!.updateComplete;
    expect(cards[1]!.shadowRoot!.textContent).toContain('Sin llegadas próximas');
    expect(board.shadowRoot!.querySelector('.status')?.textContent).toContain(
      'Actualizado hace 0 s',
    );
  });

  it('marks timetable-only arrivals and any-direction cards', async () => {
    vi.useFakeTimers({ now: RECORDED_AT, toFake: ['Date'] });
    const board = await mountBoard('p=5', new FakeSource());
    const texts = await Promise.all(
      cardsOf(board).map(async (card) => {
        await card.updateComplete;
        return card.shadowRoot!.textContent ?? '';
      }),
    );
    expect(texts.some((text) => text.includes('prog.'))).toBe(true);
  });

  it('shows an actionable error when nothing could be loaded', async () => {
    const source = new FakeSource();
    source.failWith = new UpstreamUnavailable('offline');
    const board = await mountBoard('p=101', source);
    expect(board.status).toBe('error');
    expect(board.shadowRoot!.querySelector('[role=alert]')?.textContent).toContain(
      'No se puede contactar',
    );
  });

  it('keeps the last cards and flags the problem when a refresh fails', async () => {
    const source = new FakeSource();
    const board = await mountBoard('p=101', source);
    source.failWith = new UpstreamUnavailable('offline');
    await expect(board.refresh()).rejects.toThrow('offline');
    await board.updateComplete;
    expect(board.status).toBe('ready');
    expect(cardsOf(board).length).toBeGreaterThan(0);
    expect(board.shadowRoot!.querySelector('.problem')?.textContent).toContain('Se reintentará');
  });

  it('flags data older than 90 seconds', async () => {
    const source = new FakeSource();
    const board = await mountBoard('p=101', source);
    board.now = (board.updatedAt ?? 0) + 120_000;
    await board.updateComplete;
    expect(board.shadowRoot!.querySelector('.stale')).not.toBeNull();
  });

  it('reloads when given a new configuration and stops when removed', async () => {
    const source = new FakeSource();
    const board = await mountBoard('p=101', source);
    board.config = parseBoardConfig('p=100') as BoardConfig;
    await vi.waitFor(() => expect(source.calls).toContain('100'));
    board.remove();
    const before = source.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(source.calls.length).toBe(before);
  });

  it('renders nothing without a configuration', async () => {
    const board = document.createElement('logrono-bus-board');
    document.body.append(board);
    await board.updateComplete;
    expect(board.shadowRoot!.childElementCount).toBe(0);
    await board.refresh();
  });
});

describe('display settings', () => {
  it('highlight a card whose next bus is within the alert window', async () => {
    vi.useFakeTimers({ now: RECORDED_AT, toFake: ['Date'] });
    const board = await mountBoard(
      'p=101-2d.10d.7d&aviso=2&efecto=borde&color=suave',
      new FakeSource(),
    );
    const [line2, line10, line7] = cardsOf(board);
    await Promise.all([line2!.updateComplete, line10!.updateComplete, line7!.updateComplete]);
    expect(line2!.hasAttribute('alert')).toBe(true);
    expect(line2!.getAttribute('effect')).toBe('borde');
    expect(line2!.getAttribute('intensity')).toBe('suave');
    expect(line2!.shadowRoot!.querySelector('article')?.getAttribute('aria-label')).toContain(
      '¡Llega pronto!',
    );
    expect(line10!.card?.line_label).toBe('10');
    expect(line10!.hasAttribute('alert')).toBe(false);
    expect(line7!.hasAttribute('alert')).toBe(false);
  });

  it('can be switched off', async () => {
    vi.useFakeTimers({ now: RECORDED_AT, toFake: ['Date'] });
    const off = await mountBoard('p=101-2d&aviso=0', new FakeSource());
    await cardsOf(off)[0]!.updateComplete;
    expect(cardsOf(off)[0]!.hasAttribute('alert')).toBe(false);
    document.body.replaceChildren();
    const none = await mountBoard('p=101-2d&efecto=ninguno', new FakeSource());
    await cardsOf(none)[0]!.updateComplete;
    expect(cardsOf(none)[0]!.hasAttribute('alert')).toBe(false);
  });

  it('scale the text and set the font without refetching', async () => {
    const source = new FakeSource();
    const board = await mountBoard('p=101-2d', source);
    const calls = source.calls.length;
    board.config = parseBoardConfig('p=101-2d&tam=130&letra=legible') as BoardConfig;
    await board.updateComplete;
    expect(board.style.getPropertyValue('--lb-text-scale')).toBe('1.3');
    expect(board.style.fontFamily).toContain('Atkinson Hyperlegible');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(source.calls.length).toBe(calls);
  });
});

describe('card order', () => {
  /** Lay cards out in a column, 100 px apart, in DOM order (happy-dom has no layout). */
  function stubLayout(): () => void {
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const index = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
      return new DOMRect(0, index * 100, 300, 90);
    };
    return () => {
      HTMLElement.prototype.getBoundingClientRect = original;
    };
  }

  const labels = (board: LogronoBusBoard) =>
    cardsOf(board).map((card) => `${card.card?.line_label}${card.card?.direction ?? ''}`);

  it('sorts by line number or by soonest bus', async () => {
    vi.useFakeTimers({ now: RECORDED_AT, toFake: ['Date'] });
    const board = await mountBoard('p=101-7d.10d.5a.2d', new FakeSource());
    expect(labels(board)).toEqual(['7desc', '10desc', '5asc', '2desc']);
    board.config = parseBoardConfig('p=101-7d.10d.5a.2d&orden=linea') as BoardConfig;
    await board.updateComplete;
    expect(labels(board)).toEqual(['2desc', '5asc', '7desc', '10desc']);
    board.config = parseBoardConfig('p=101-7d.10d.5a.2d&orden=llegada') as BoardConfig;
    await board.updateComplete;
    // 2 in 1 min, 10 in 3, 5 in 6; 7 has nothing due and goes last.
    expect(labels(board)).toEqual(['2desc', '10desc', '5asc', '7desc']);
  });

  it('slides moved cards to their new place and makes overtakers swell', async () => {
    const restore = stubLayout();
    const animate = vi.fn(() => ({ onfinish: null, oncancel: null }));
    const originalAnimate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    try {
      vi.useFakeTimers({ now: RECORDED_AT, toFake: ['Date'] });
      const board = await mountBoard('p=101-7d.2d', new FakeSource());
      board.config = parseBoardConfig('p=101-7d.2d&orden=llegada') as BoardConfig;
      await board.updateComplete;
      expect(animate).toHaveBeenCalledTimes(2);
      const calls = animate.mock.calls as unknown as [Keyframe[]][];
      const upFrames = calls[0]?.[0];
      const downFrames = calls[1]?.[0];
      // Line 2 (now first) came from 100 px lower and swells mid-way; line 7 slides down plainly.
      expect(upFrames?.[0]?.transform).toBe('translate(0px, 100px)');
      expect(upFrames?.[1]?.transform).toContain('scale(1.05)');
      expect(downFrames?.[0]?.transform).toBe('translate(0px, -100px)');
      expect(downFrames?.[1]?.transform).toContain('scale(1)');
    } finally {
      HTMLElement.prototype.animate = originalAnimate;
      restore();
    }
  });

  it('does not animate when the user asks for reduced motion', async () => {
    const restore = stubLayout();
    const animate = vi.fn();
    const originalAnimate = HTMLElement.prototype.animate;
    const originalMatch = window.matchMedia;
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduce'),
    })) as typeof matchMedia;
    try {
      const board = await mountBoard('p=101-7d.2d', new FakeSource());
      board.config = parseBoardConfig('p=101-7d.2d&orden=llegada') as BoardConfig;
      await board.updateComplete;
      expect(animate).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.animate = originalAnimate;
      window.matchMedia = originalMatch;
      restore();
    }
  });
});

describe('route view', () => {
  it('opens when a card is tapped, polls that line, and closes with "Volver"', async () => {
    const source = new FakeSource();
    const board = await mountBoard('p=101-10d', source);
    const [card] = cardsOf(board);
    await card!.updateComplete;
    expect(card!.openable).toBe(true);
    card!.shadowRoot!.querySelector('article')!.click();
    await board.updateComplete;
    const route = board.shadowRoot!.querySelector('lb-route')!;
    expect(route).not.toBeNull();
    await vi.waitFor(() => expect(route.route).not.toBeNull());
    expect(source.vehicleCalls).toEqual(['10']);
    await route.updateComplete;
    const names = [...route.shadowRoot!.querySelectorAll('.stop .name')].map((n) => n.textContent);
    expect(names.at(-1)).toBe('Ayuntamiento');
    // Bus 946 on the stops shown; 2315, waiting at the start of the line, on the "…" before them.
    expect(route.shadowRoot!.querySelectorAll('.bus:not(.earlier)')).toHaveLength(1);
    expect(route.shadowRoot!.querySelectorAll('.bus.earlier')).toHaveLength(1);
    expect(route.shadowRoot!.querySelector('.track')?.getAttribute('aria-label')).toContain(
      'a 3 paradas',
    );
    [...route.shadowRoot!.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Volver')!
      .click();
    await board.updateComplete;
    expect(board.shadowRoot!.querySelector('lb-route')).toBeNull();
  });

  it('lays out horizontally on wide screens and explains a failure', async () => {
    const route = document.createElement('lb-route');
    const source = new FakeSource();
    source.failWith = new UpstreamUnavailable('offline');
    route.source = source;
    route.card = (await mountBoard('p=101-10d', new FakeSource())).cards[0];
    route.orientation = 'horizontal';
    document.body.append(route);
    await vi.waitFor(() => expect(route.problem).toBeDefined());
    await route.updateComplete;
    expect(route.getAttribute('orientation')).toBe('horizontal');
    expect(route.shadowRoot!.querySelector('[role=alert]')?.textContent).toContain('posiciones');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  describe('while it stays open', () => {
    const setHidden = (hidden: boolean): void => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };

    afterEach(() => {
      delete (document as { hidden?: boolean }).hidden;
    });

    async function openRoute(source: FakeSource) {
      const card = (await mountBoard('p=101-10d', new FakeSource())).cards[0];
      const route = document.createElement('lb-route');
      route.source = source;
      route.card = card;
      document.body.append(route);
      await vi.waitFor(() => expect(route.route).not.toBeNull());
      await route.updateComplete;
      return route;
    }

    it('stops polling while the page is hidden and refreshes when it is shown again', async () => {
      const source = new FakeSource();
      await openRoute(source);
      expect(source.vehicleCalls).toEqual(['10']);
      setHidden(true);
      setHidden(true);
      expect(source.vehicleCalls).toEqual(['10']);
      setHidden(false);
      await vi.waitFor(() => expect(source.vehicleCalls).toEqual(['10', '10']));
    });

    it('keeps the last positions up, with a warning, when a refresh fails', async () => {
      vi.useFakeTimers({ now: RECORDED_AT, toFake: ['Date'] });
      const source = new FakeSource();
      const route = await openRoute(source);
      source.failWith = new UpstreamUnavailable('offline');
      // Hiding and showing the page refreshes at once, like the next poll would.
      setHidden(true);
      setHidden(false);
      await vi.waitFor(() => expect(route.problem).toBeDefined());
      await route.updateComplete;
      const root = route.shadowRoot!;
      const warning = root.querySelector('footer [role=alert]')?.textContent;
      console.info('after a failed refresh:', warning);
      expect(root.querySelectorAll('.bus')).toHaveLength(2);
      expect(warning).toContain('posiciones');
      expect(root.querySelector('.body [role=alert]')).toBeNull();

      // Positions too old to trust give way to the explanation alone.
      vi.setSystemTime(RECORDED_AT + STALE_POSITION_MS + 1_000);
      route.now = Date.now();
      await route.updateComplete;
      expect(root.querySelector('.track')).toBeNull();
      expect(root.querySelector('.body [role=alert]')?.textContent).toContain('posiciones');
      expect(root.querySelector('footer [role=alert]')).toBeNull();
    });

    it(`closes itself only after ${ROUTE_IDLE_CLOSE_MS / 60_000} minutes untouched`, async () => {
      const route = await openRoute(new FakeSource());
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const closed = vi.fn();
      route.addEventListener('route-close', closed);
      // The idle timer started before the fake clock: touch the header to restart it on it.
      route.shadowRoot!.querySelector('header')!.click();
      vi.advanceTimersByTime(ROUTE_IDLE_CLOSE_MS - 1);
      expect(closed).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(closed).toHaveBeenCalledOnce();
    });
  });

  it('moves a stop name out of the way when a bus sits over that stop', async () => {
    const route = document.createElement('lb-route');
    route.source = new FakeSource();
    route.card = (await mountBoard('p=101-10d', new FakeSource())).cards[0];
    route.orientation = 'horizontal';
    document.body.append(route);
    await vi.waitFor(() => expect(route.route).not.toBeNull());
    await route.updateComplete;
    const view = route.route!;
    const stops = [...route.shadowRoot!.querySelectorAll('.stop')];
    const covered = stops.flatMap((stop, index) =>
      stop.classList.contains('covered') ? [index] : [],
    );
    console.info(
      'bus positions',
      view.buses.map((bus) => bus.at),
      'covered stops',
      covered,
    );
    expect(covered).toEqual([...stopsUnderBuses(view)]);
    expect(covered.length).toBeGreaterThan(0);
    for (const index of covered) {
      expect(view.buses.some((bus) => Math.abs(bus.at - index) < 0.8)).toBe(true);
    }
  });

  it('flags only the stops a bus is close to', () => {
    const stop = { id: 's', name: 'Parada' };
    const view = {
      stops: [stop, stop, stop, stop],
      buses: [{ at: 1.5 }, { at: 3 }],
    } as unknown as Parameters<typeof stopsUnderBuses>[0];
    expect([...stopsUnderBuses(view)]).toEqual([1, 2, 3]);
    expect([...stopsUnderBuses(view, 0.4)]).toEqual([3]);
  });

  it('shows the stops asked for, with "…" around them and the bus further back on it', async () => {
    const route = document.createElement('lb-route');
    route.source = new FakeSource();
    route.card = (await mountBoard('p=101-10d', new FakeSource())).cards[0];
    route.previousStops = 1;
    route.orientation = 'horizontal';
    document.body.append(route);
    await vi.waitFor(() => expect(route.route).not.toBeNull());
    await route.updateComplete;
    const root = route.shadowRoot!;
    const names = [...root.querySelectorAll('.stop .name')].map((n) => n.textContent);
    console.info('stops shown', names, 'earlier buses', route.route!.earlierBuses);
    expect(names).toHaveLength(2);
    expect(names.at(-1)).toBe('Ayuntamiento');
    expect(root.querySelector('.more.before')).not.toBeNull();
    expect(root.querySelector('.more.after')).not.toBeNull();
    // Every bus is further back than the one stop shown: the nearest waits on the "…".
    expect(root.querySelectorAll('.bus:not(.earlier)')).toHaveLength(0);
    const earlier = root.querySelector('.bus.earlier .pill')?.textContent?.replace(/\s+/g, ' ');
    // No arrivals given: no minutes to show, just the bus and how many more wait behind it.
    expect(earlier).toBe('🚌 +1');
    expect(root.querySelector('.track')?.getAttribute('aria-label')).toContain(
      'Un autobús a 3 paradas',
    );
  });

  it('words the next bus like the cards, and says when it is only the timetable', async () => {
    // Line 2 at Ayuntamiento has arrivals in the recording; reuse one with chosen times.
    const card = (await mountBoard('p=101-2d', new FakeSource())).cards[0]!;
    const [first] = card.arrivals;
    const next = (minutes: number, isRealtime: boolean) => ({
      ...card,
      arrivals: [
        {
          ...first!,
          expected: new Date(RECORDED_AT + minutes * 60_000 + 10_000).toISOString(),
          is_realtime: isRealtime,
          cancelled: false,
        },
      ],
    });
    expect(nextBusLine(next(4, true), RECORDED_AT)).toBe('Ayuntamiento · próximo en 4 minutos');
    expect(nextBusLine(next(0, true), RECORDED_AT)).toBe('Ayuntamiento · próximo llegando');
    expect(nextBusLine(next(3, false), RECORDED_AT)).toBe(
      'Ayuntamiento · próximo en 3 minutos (horario programado)',
    );
    expect(nextBusLine({ ...card, arrivals: [] }, RECORDED_AT)).toBe('Ayuntamiento');
    const bus = { vehicleId: '1', at: 1, stopsAway: 1 };
    expect(minutesLabel({ ...bus, minutes: 0 })).toBe('llegando');
    expect(minutesLabel({ ...bus, minutes: 7 })).toBe('7 min');
    expect(minutesLabel({ ...bus, minutes: null })).toBe('');
  });

  it('does not offer routes for cards without a known direction', async () => {
    const board = await mountBoard('p=101-7d', new FakeSource());
    const [card] = cardsOf(board);
    // Line 7 has no bus due and a known direction: still openable.
    expect(card!.openable).toBe(true);
    expect(routable({ ...card!.card!, direction: null, arrivals: [] })).toBe(false);
  });
});

describe('<lb-card>', () => {
  it('renders nothing without a card', async () => {
    const card = document.createElement('lb-card');
    document.body.append(card);
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector('article')).toBeNull();
  });
});

describe('describeError', () => {
  it.each([
    [new UpstreamSchemaError('x', '$'), 'ha cambiado'],
    [new UpstreamUnavailable('x'), 'Se reintentará'],
    [new StopNotFound('424242'), "La parada '424242' no existe"],
    [new Error('boom'), 'Error inesperado'],
  ])('explains %s', (error, text) => {
    expect(describeError(error)).toContain(text);
  });
});

describe('timetable', () => {
  /** 23:30 in Logroño on the recording's day: line 10 towards Manuel de Falla stopped at 23:00. */
  const LATE = Date.parse('2026-10-03T21:30:00Z');

  it('explains an empty card with its line timetable, asked once per line and day', async () => {
    vi.setSystemTime(LATE);
    const source = new FakeSource();
    source.arrivalsFixture = 'upstream/arrivals-vacio-{stop}.json';
    const board = await mountBoard('p=101-10d.2d', source);
    await vi.waitFor(() => expect(source.timetableCalls.sort()).toEqual(['10', '2']));
    await board.updateComplete;
    const texts = async () => {
      const cards = cardsOf(board);
      await Promise.all(cards.map((card) => card.updateComplete));
      return cards.map((card) => card.shadowRoot!.querySelector('.empty')?.textContent?.trim());
    };
    await vi.waitFor(async () =>
      expect(await texts()).toEqual([
        'Servicio terminado · última salida 23:00',
        'Servicio terminado · última salida 22:30',
      ]),
    );
    await board.refresh();
    expect(source.timetableCalls).toHaveLength(2);
  });

  it("forgets yesterday's timetable when today's cannot be loaded", async () => {
    vi.setSystemTime(LATE);
    const source = new FakeSource();
    source.arrivalsFixture = 'upstream/arrivals-vacio-{stop}.json';
    const board = await mountBoard('p=101-10d', source);
    const text = async () => {
      const [card] = cardsOf(board);
      await card!.updateComplete;
      return card!.shadowRoot!.querySelector('.empty')?.textContent?.trim();
    };
    await vi.waitFor(async () => expect(await text()).toMatch(/^Servicio terminado/));

    vi.setSystemTime(LATE + 3 * 3_600_000); // 02:30 the next day
    source.timetable = (lineId) => {
      source.timetableCalls.push(lineId);
      return Promise.reject(new UpstreamUnavailable('caído'));
    };
    await board.refresh();
    await vi.waitFor(() => expect(source.timetableCalls).toEqual(['10', '10']));
    await board.updateComplete;
    expect(await text()).toBe('Sin llegadas próximas');
  });

  it('asks a new source again for a timetable the previous one could not give', async () => {
    vi.setSystemTime(LATE);
    const first = new FakeSource();
    first.arrivalsFixture = 'upstream/arrivals-vacio-{stop}.json';
    const board = await mountBoard('p=101-5a', first);
    await vi.waitFor(() => expect(first.timetableCalls).toEqual(['5']));

    const second = new FakeSource();
    second.arrivalsFixture = 'upstream/arrivals-vacio-{stop}.json';
    board.source = second;
    await board.updateComplete;
    await board.refresh();
    await vi.waitFor(() => expect(second.timetableCalls).toEqual(['5']));
  });

  it('does not ask again for a timetable that failed today', async () => {
    vi.setSystemTime(LATE);
    const source = new FakeSource();
    source.arrivalsFixture = 'upstream/arrivals-vacio-{stop}.json';
    const board = await mountBoard('p=101-5a', source);
    await vi.waitFor(() => expect(source.timetableCalls).toEqual(['5']));
    await board.refresh();
    await board.refresh();
    expect(source.timetableCalls).toEqual(['5']);
  });

  it('opens straight on the timetable when no bus is due, without asking for positions', async () => {
    vi.setSystemTime(Date.parse('2026-10-03T16:01:00Z')); // 18:01 in Logroño
    const source = new FakeSource();
    source.arrivalsFixture = 'upstream/arrivals-vacio-{stop}.json';
    const board = await mountBoard('p=101-10d', source);
    const [card] = cardsOf(board);
    await card!.updateComplete;
    card!.shadowRoot!.querySelector('article')!.click();
    await board.updateComplete;
    const route = board.shadowRoot!.querySelector('lb-route')!;
    expect(route.screen).toBe('horario');
    await vi.waitFor(() => expect(route.timetable).toBeDefined());
    await route.updateComplete;
    const timetable = route.shadowRoot!.querySelector('lb-timetable')!;
    await timetable.updateComplete;
    const root = timetable.shadowRoot!;
    // Towards Manuel de Falla, every 30 min from Artesanos: 18:00 has just left, 18:30 is next.
    expect(root.querySelector('.status')?.textContent?.trim()).toBe(
      'Próxima salida 18:30 · cada 30 min',
    );
    expect(root.querySelector('li.next')?.textContent?.trim()).toBe('18:30');
    // 08:00–18:00 every 30 min, plus the 15:25 and 15:55 reinforcements of the recording.
    expect(root.querySelectorAll('li.past')).toHaveLength(23);
    expect(root.querySelector('.note')?.textContent).toContain('Salidas de Artesanos');
    expect(source.vehicleCalls).toEqual([]);

    const toggle = [...route.shadowRoot!.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Recorrido',
    )!;
    toggle.click();
    await vi.waitFor(() => expect(source.vehicleCalls).toEqual(['10']));
    expect(route.screen).toBe('recorrido');
  });

  it('words what an empty card says', () => {
    const status = (state: string, extra: Record<string, unknown> = {}) =>
      ({
        state,
        first: '07:15',
        last: '22:45',
        next_departure: null,
        interval_min: null,
        interval_max_min: null,
        ...extra,
      }) as ServiceStatus;
    expect(serviceSentence(status('antes'))).toBe('Primera salida a las 07:15');
    expect(serviceSentence(status('terminado'))).toBe('Servicio terminado · última salida 22:45');
    expect(serviceSentence(status('sin_servicio'))).toBe('Hoy no hay servicio');
    expect(serviceSentence(status('en_servicio', { interval_min: 12, interval_max_min: 15 }))).toBe(
      'Sin llegadas próximas · pasa cada 12–15 min',
    );
    expect(serviceSentence(status('en_servicio'))).toBe('Sin llegadas próximas');
    expect(serviceSentence(null)).toBe('Sin llegadas próximas');
  });
});

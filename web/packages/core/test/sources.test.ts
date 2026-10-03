import { describe, expect, it } from 'vitest';

import {
  BackendSource,
  CATALOG_STORAGE_KEY,
  DirectSource,
  InvalidSelection,
  LineNotFound,
  MemoryStore,
  SafeStorage,
  StopNotFound,
  TIMETABLE_STORAGE_PREFIX,
  UPSTREAM_BASE_URL,
  UnusableSource,
  UpstreamSchemaError,
  UpstreamUnavailable,
  probeBackend,
  selectSource,
} from '../src/index.ts';
import { fakeFetch, json, loadFixture } from './fixtures.ts';

const RECORDED_AT = Date.parse('2026-10-03T16:00:45Z');
const LINES = `${UPSTREAM_BASE_URL}linesDiscovery/lines`;
const STOPS = `${UPSTREAM_BASE_URL}linesDiscovery/stops`;
const ARRIVALS_101 = `${UPSTREAM_BASE_URL}estimatedTimetable/byStop/101`;
const TIMETABLE_10 = `${UPSTREAM_BASE_URL}productionTimetable/byLine/10`;

const upstreamRoutes = (extra: Record<string, () => Response> = {}) => ({
  [LINES]: () => json(loadFixture('upstream/lines.json')),
  [STOPS]: () => json(loadFixture('upstream/stops.json')),
  ...extra,
});

describe('DirectSource', () => {
  it('normalises upstream arrivals exactly like the golden corpus', async () => {
    const { fetch, calls } = fakeFetch(
      upstreamRoutes({ [ARRIVALS_101]: () => json(loadFixture('upstream/arrivals-101.json')) }),
    );
    const source = new DirectSource(UPSTREAM_BASE_URL, { fetch, now: () => RECORDED_AT });
    const result = await source.arrivals('101');
    const expected = loadFixture<{ arrivals: unknown[] }>(
      'expected/arrivals-ayuntamiento-101.json',
    );
    expect(result.arrivals).toEqual(expected.arrivals);
    expect(result.generated_at).toBe('2026-10-03T16:00:45+00:00');
    expect(calls.at(-1)).toBe(`${ARRIVALS_101}?lines=2%2C5%2C7%2C10&previewMinutes=60`);
    expect(source.kind).toBe('directa');
  });

  it('loads the catalogue once and caches it in storage for a day', async () => {
    const store = new MemoryStore();
    let now = RECORDED_AT;
    const { fetch, calls } = fakeFetch(upstreamRoutes());
    const first = new DirectSource(UPSTREAM_BASE_URL, { fetch, store, now: () => now });
    await Promise.all([first.catalog(), first.catalog()]);
    expect(calls.filter((url) => url === LINES)).toHaveLength(1);
    expect(store.get(CATALOG_STORAGE_KEY)).toContain('"Ayuntamiento"');

    const second = new DirectSource(UPSTREAM_BASE_URL, { fetch, store, now: () => now });
    await second.catalog();
    expect(calls.filter((url) => url === LINES)).toHaveLength(1);

    now += 25 * 60 * 60 * 1000;
    await new DirectSource(UPSTREAM_BASE_URL, { fetch, store, now: () => now }).catalog();
    expect(calls.filter((url) => url === LINES)).toHaveLength(2);
  });

  it('asks for the timetable of a line once per local day, even across page reloads', async () => {
    const store = new MemoryStore();
    let now = RECORDED_AT; // 18:00:45 in Logroño
    const { fetch, calls } = fakeFetch(
      upstreamRoutes({ [TIMETABLE_10]: () => json(loadFixture('upstream/timetable-10.json')) }),
    );
    const open = () => new DirectSource(UPSTREAM_BASE_URL, { fetch, store, now: () => now });
    const today = await open().timetable('10');
    expect(today.service_date).toBe('2026-10-03');
    expect(today.directions.map((d) => d.pattern_id)).toEqual(['10:asc', '10:desc']);
    expect(store.get(`${TIMETABLE_STORAGE_PREFIX}10`)).toContain('"2026-10-03"');

    now += (5 * 60 + 59) * 60_000; // 23:59:45, same day, a reloaded page
    expect(await open().timetable('10')).toEqual(today);
    expect(calls.filter((url) => url === TIMETABLE_10)).toHaveLength(1);

    now += 60_000; // 00:00:45, a new service day
    expect((await open().timetable('10')).service_date).toBe('2026-10-04');
    expect(calls.filter((url) => url === TIMETABLE_10)).toHaveLength(2);
    await expect(open().timetable('99')).rejects.toBeInstanceOf(LineNotFound);
  });

  it('keeps an expired stored catalogue when the upstream is down', async () => {
    const store = new MemoryStore();
    const healthy = fakeFetch(upstreamRoutes());
    await new DirectSource(UPSTREAM_BASE_URL, {
      fetch: healthy.fetch,
      store,
      now: () => RECORDED_AT,
    }).catalog();
    const down = fakeFetch({ [UPSTREAM_BASE_URL]: () => json({}, 503) });
    const later = RECORDED_AT + 48 * 60 * 60 * 1000;
    const index = await new DirectSource(UPSTREAM_BASE_URL, {
      fetch: down.fetch,
      store,
      now: () => later,
    }).catalog();
    expect(index.stop('101').name).toBe('Ayuntamiento');
  });

  it('retries the catalogue after a failure and ignores corrupt storage', async () => {
    const store = new MemoryStore();
    store.set(CATALOG_STORAGE_KEY, '{not json');
    let healthy = false;
    const { fetch } = fakeFetch({
      [LINES]: () => (healthy ? json(loadFixture('upstream/lines.json')) : json({}, 500)),
      [STOPS]: () => (healthy ? json(loadFixture('upstream/stops.json')) : json({}, 500)),
    });
    const source = new DirectSource(UPSTREAM_BASE_URL, { fetch, store });
    await expect(source.catalog()).rejects.toBeInstanceOf(UpstreamUnavailable);
    healthy = true;
    await expect(source.catalog()).resolves.toBeDefined();
  });

  it.each([
    [() => json({}, 429), UpstreamUnavailable],
    [() => json({}, 502), UpstreamUnavailable],
    [() => json({ message: 'Not Found' }, 404), UpstreamSchemaError],
    [() => new Response('<html>mantenimiento</html>', { status: 200 }), UpstreamSchemaError],
    [() => json({ result: { llegadas: [] } }), UpstreamSchemaError],
  ])('maps upstream failures (%#)', async (reply, errorType) => {
    const { fetch } = fakeFetch(upstreamRoutes({ [ARRIVALS_101]: reply }));
    await expect(
      new DirectSource(UPSTREAM_BASE_URL, { fetch }).arrivals('101'),
    ).rejects.toBeInstanceOf(errorType);
  });

  it('turns network and CORS failures into UpstreamUnavailable but lets aborts through', async () => {
    const failing = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(new DirectSource(UPSTREAM_BASE_URL, { fetch: failing }).catalog()).rejects.toThrow(
      /TypeError: Failed to fetch/,
    );
    const { fetch } = fakeFetch(
      upstreamRoutes({ [ARRIVALS_101]: () => json(loadFixture('upstream/arrivals-101.json')) }),
    );
    const source = new DirectSource(UPSTREAM_BASE_URL, { fetch });
    await source.catalog();
    const controller = new AbortController();
    controller.abort();
    await expect(source.arrivals('101', controller.signal)).rejects.toThrow('Aborted');
  });

  it('times out slow requests', async () => {
    const hanging = (_input: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('timeout', 'AbortError')),
        );
      });
    const source = new DirectSource(UPSTREAM_BASE_URL, { fetch: hanging, timeoutMs: 30 });
    const started = Date.now();
    await expect(source.catalog()).rejects.toBeInstanceOf(UpstreamUnavailable);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it('answers a stop with no known lines without calling the upstream', async () => {
    const { fetch, calls } = fakeFetch({
      [LINES]: () => json({ result: { lines: [] } }),
      [STOPS]: () =>
        json({ result: { stops: [{ id: 7, name: 'X', lat: 0, lng: 0, lines: [99] }] } }),
    });
    const result = await new DirectSource(UPSTREAM_BASE_URL.slice(0, -1), {
      fetch,
      now: () => RECORDED_AT,
    }).arrivals('7');
    expect(result.arrivals).toEqual([]);
    expect(calls.some((url) => url.includes('byStop'))).toBe(false);
  });

  it('rejects unknown stops', async () => {
    const { fetch } = fakeFetch(upstreamRoutes());
    await expect(
      new DirectSource(UPSTREAM_BASE_URL, { fetch }).arrivals('424242'),
    ).rejects.toBeInstanceOf(StopNotFound);
  });
});

describe('BackendSource', () => {
  const API = 'http://casa.local:8000/api/v1/';
  const problem = (slug: string, status: number) =>
    json(
      {
        type: `https://chiva.github.io/logrono-bus/guia/errores/#${slug}`,
        title: 't',
        detail: `detalle ${slug}`,
        status,
      },
      status,
    );

  it('reads the catalogue once and arrivals per call', async () => {
    const catalog = loadFixture('expected/catalog.json');
    const arrivals = loadFixture('expected/arrivals-ayuntamiento-101.json');
    const { fetch, calls } = fakeFetch({
      'http://casa.local:8000/api/v1/catalog': () => json(catalog),
      'http://casa.local:8000/api/v1/stops/101/arrivals': () => json(arrivals),
    });
    const source = new BackendSource(API, { fetch });
    expect((await Promise.all([source.catalog(), source.catalog()]))[0].stop('101').name).toBe(
      'Ayuntamiento',
    );
    expect(calls.filter((url) => url.endsWith('/catalog'))).toHaveLength(1);
    expect(await source.arrivals('101')).toEqual(arrivals);
    expect(source.kind).toBe('servidor');
    const timetable = loadFixture('expected/timetable-linea-10.json');
    const served = fakeFetch({
      'http://casa.local:8000/api/v1/lines/10/timetable': () => json(timetable),
    });
    expect(await new BackendSource(API, { fetch: served.fetch }).timetable('10')).toEqual(
      timetable,
    );
  });

  it.each([
    ['parada-no-encontrada', 404, StopNotFound],
    ['linea-no-encontrada', 404, LineNotFound],
    ['seleccion-no-valida', 400, InvalidSelection],
    ['origen-cambiado', 502, UpstreamSchemaError],
    ['origen-no-disponible', 503, UpstreamUnavailable],
  ])('maps problem %s', async (slug, status, errorType) => {
    const { fetch } = fakeFetch({ [API.slice(0, -1)]: () => problem(slug, status) });
    await expect(new BackendSource(API, { fetch }).arrivals('101')).rejects.toBeInstanceOf(
      errorType,
    );
  });

  it('treats non-problem failures as unavailable and retries the catalogue', async () => {
    let attempt = 0;
    const { fetch } = fakeFetch({
      'http://casa.local:8000/api/v1/catalog': () =>
        ++attempt === 1
          ? new Response('Bad Gateway', { status: 502 })
          : json(loadFixture('expected/catalog.json')),
    });
    const source = new BackendSource(API, { fetch });
    await expect(source.catalog()).rejects.toBeInstanceOf(UpstreamUnavailable);
    await expect(source.catalog()).resolves.toBeDefined();
  });
});

describe('source selection', () => {
  const health = (apiVersion: number) => () => json({ status: 'ok', api_version: apiVersion });

  it('honours explicit choices', async () => {
    const { fetch, calls } = fakeFetch({});
    expect((await selectSource({ source: 'directa', api: null }, { fetch })).kind).toBe('directa');
    expect((await selectSource({ source: 'servidor', api: null }, { fetch })).kind).toBe(
      'servidor',
    );
    expect(
      (await selectSource({ source: 'auto', api: 'https://bus.casa/api/v1' }, { fetch })).kind,
    ).toBe('servidor');
    expect(calls).toEqual([]);
  });

  it('auto-detects a same-origin server speaking a compatible API', async () => {
    const compatible = fakeFetch({ './api/v1/health': health(1) });
    expect(
      (await selectSource({ source: 'auto', api: null }, { fetch: compatible.fetch })).kind,
    ).toBe('servidor');
    const newer = fakeFetch({ './api/v1/health': health(2) });
    expect((await selectSource({ source: 'auto', api: null }, { fetch: newer.fetch })).kind).toBe(
      'directa',
    );
    const none = fakeFetch({});
    expect((await selectSource({ source: 'auto', api: null }, { fetch: none.fetch })).kind).toBe(
      'directa',
    );
    const broken = async () => {
      throw new TypeError('offline');
    };
    expect(await probeBackend('./api/v1', broken)).toBe(false);
  });

  it('refuses an http server from an https page with an explanation', async () => {
    await expect(
      selectSource(
        { source: 'auto', api: 'http://192.168.1.10:8000/api/v1' },
        { pageProtocol: 'https:' },
      ),
    ).rejects.toBeInstanceOf(UnusableSource);
  });
});

describe('SafeStorage', () => {
  it('degrades silently when storage is missing or throws', () => {
    const missing = new SafeStorage(() => {
      throw new Error('SecurityError');
    });
    missing.set('k', 'v');
    expect(missing.get('k')).toBeNull();
    missing.remove('k');

    const throwing = new SafeStorage(
      () =>
        ({
          getItem: () => {
            throw new Error('denied');
          },
          setItem: () => {
            throw new Error('quota');
          },
          removeItem: () => {
            throw new Error('denied');
          },
        }) as unknown as Storage,
    );
    throwing.set('k', 'v');
    expect(throwing.get('k')).toBeNull();
    throwing.remove('k');
  });

  it('stores values when storage works', () => {
    const backing = new Map<string, string>();
    const storage = new SafeStorage(
      () =>
        ({
          getItem: (key: string) => backing.get(key) ?? null,
          setItem: (key: string, value: string) => backing.set(key, value),
          removeItem: (key: string) => backing.delete(key),
        }) as unknown as Storage,
    );
    storage.set('k', 'v');
    expect(storage.get('k')).toBe('v');
    storage.remove('k');
    expect(storage.get('k')).toBeNull();
    const memory = new MemoryStore();
    memory.set('a', 'b');
    memory.remove('a');
    expect(memory.get('a')).toBeNull();
  });
});

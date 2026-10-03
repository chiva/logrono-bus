/**
 * Where the data comes from.
 *
 * - `DirectSource` calls the Ayuntamiento's public API straight from the browser (it allows
 *   cross-origin requests) and normalises in TypeScript. This is what the GitHub Pages site uses:
 *   nothing to install.
 * - `BackendSource` calls a logrono-bus server (`/api/v1`), which caches and normalises for every
 *   screen in the house at once.
 *
 * Both return exactly the same model; the board never knows which one it is using.
 */
import { CatalogIndex } from './catalog.ts';
import { DirectionResolver } from './directions.ts';
import {
  InvalidSelection,
  LineNotFound,
  LogronoBusError,
  StopNotFound,
  UpstreamSchemaError,
  UpstreamUnavailable,
} from './errors.ts';
import type { Catalog, Health, LineTimetable, LineVehicles, StopArrivals } from './models.ts';
import {
  buildCatalog,
  normalizeArrivals,
  normalizeTimetable,
  normalizeVehicles,
} from './normalize.ts';
import { parseArrivals, parseLines, parseStops, parseTimetable, parseVehicles } from './raw.ts';
import type { KeyValueStore } from './storage.ts';
import type { BoardConfig } from './config.ts';
import { localDate } from './timetable.ts';

export const UPSTREAM_BASE_URL = 'https://transporteurbano.logrono.es/api/';
export const SAME_ORIGIN_API = './api/v1';
export const SUPPORTED_API_VERSION = 1;
export const REQUEST_TIMEOUT_MS = 10_000;
export const PROBE_TIMEOUT_MS = 3_000;
export const ARRIVALS_PREVIEW_MINUTES = 60;
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
export const CATALOG_STORAGE_KEY = 'logrono-bus:catalogo:v1';
/** Followed by the line id; one timetable per line, replaced when the local day changes. */
export const TIMETABLE_STORAGE_PREFIX = 'logrono-bus:horario:v1:';

export type SourceKind = 'directa' | 'servidor';

export interface DataSource {
  readonly kind: SourceKind;
  catalog(): Promise<CatalogIndex>;
  arrivals(stopId: string, signal?: AbortSignal): Promise<StopArrivals>;
  /** Where a line's buses are now (only fetched while a route view is open). */
  vehicles(lineId: string, signal?: AbortSignal): Promise<LineVehicles>;
  /** Today's departures and headways of a line (fetched at most once per line and day). */
  timetable(lineId: string, signal?: AbortSignal): Promise<LineTimetable>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SourceOptions {
  readonly fetch?: FetchLike;
  readonly store?: KeyValueStore;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

/** A configuration that cannot work in this browser (e.g. an http server from an https page). */
export class UnusableSource extends LogronoBusError {
  override name = 'UnusableSource';
}

/**
 * An abort signal that fires on `signal` or after `timeoutMs`. Built by hand rather than with
 * `AbortSignal.any`/`AbortSignal.timeout`, which the Echo Show's older Chromium may lack.
 */
function deadline(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forward = (): void => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    },
  };
}

async function fetchJson(
  fetcher: FetchLike,
  url: string,
  {
    signal,
    timeoutMs = REQUEST_TIMEOUT_MS,
  }: { signal?: AbortSignal | undefined; timeoutMs?: number } = {},
): Promise<{ response: Response; body: unknown }> {
  const limit = deadline(signal, timeoutMs);
  let response: Response;
  let text: string;
  try {
    response = await fetcher(url, {
      signal: limit.signal,
      headers: { Accept: 'application/json' },
    });
    text = await response.text();
  } catch (error) {
    if (signal?.aborted) throw error;
    // TypeError covers DNS, offline and CORS refusals alike: browsers do not tell them apart.
    throw new UpstreamUnavailable(`${url}: ${(error as Error).name}: ${(error as Error).message}`);
  } finally {
    limit.clear();
  }
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (response.ok) throw new UpstreamSchemaError('JSON no válido', url);
    }
  }
  return { response, body };
}

const nowIso = (now: () => number): string => new Date(now()).toISOString();

export class DirectSource implements DataSource {
  readonly kind = 'directa';
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #store: KeyValueStore | undefined;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  #loaded: Promise<{ index: CatalogIndex; resolver: DirectionResolver }> | undefined;

  constructor(baseUrl: string = UPSTREAM_BASE_URL, options: SourceOptions = {}) {
    this.#baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async catalog(): Promise<CatalogIndex> {
    return (await this.#load()).index;
  }

  async arrivals(stopId: string, signal?: AbortSignal): Promise<StopArrivals> {
    const { index, resolver } = await this.#load();
    const stop = index.stop(stopId);
    if (stop.line_ids.length === 0) {
      return { stop_id: stop.id, generated_at: nowIso(this.#now), arrivals: [] };
    }
    const query = new URLSearchParams({
      lines: stop.line_ids.join(','),
      previewMinutes: String(ARRIVALS_PREVIEW_MINUTES),
    });
    const url = `${this.#baseUrl}estimatedTimetable/byStop/${encodeURIComponent(stop.id)}?${query}`;
    const body = await this.#get(url, signal);
    return normalizeArrivals(parseArrivals(body), stop.id, index, resolver, nowIso(this.#now));
  }

  async vehicles(lineId: string, signal?: AbortSignal): Promise<LineVehicles> {
    const { index } = await this.#load();
    const line = index.line(lineId);
    const url = `${this.#baseUrl}vehicleMonitoring/byLine/${encodeURIComponent(line.id)}`;
    const body = await this.#get(url, signal);
    return normalizeVehicles(parseVehicles(body), line.id, index, nowIso(this.#now));
  }

  async timetable(lineId: string, signal?: AbortSignal): Promise<LineTimetable> {
    const { index } = await this.#load();
    const line = index.line(lineId);
    const today = localDate(this.#now());
    const key = `${TIMETABLE_STORAGE_PREFIX}${line.id}`;
    const stored = this.#readJson(key) as Partial<LineTimetable> | null;
    if (stored?.service_date === today && Array.isArray(stored.directions)) {
      return stored as LineTimetable;
    }
    const url = `${this.#baseUrl}productionTimetable/byLine/${encodeURIComponent(line.id)}`;
    const body = await this.#get(url, signal);
    const timetable = normalizeTimetable(parseTimetable(body), line.id, index, nowIso(this.#now));
    this.#store?.set(key, JSON.stringify(timetable));
    return timetable;
  }

  /** A stored JSON document, or null when absent or corrupt (storage can hold anything). */
  #readJson(key: string): unknown {
    const raw = this.#store?.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  #load(): Promise<{ index: CatalogIndex; resolver: DirectionResolver }> {
    if (!this.#loaded) {
      const loading = this.#loadCatalog().then((catalog) => {
        const index = new CatalogIndex(catalog);
        return { index, resolver: new DirectionResolver(index) };
      });
      // A failed load must not be cached forever: the next call retries.
      loading.catch(() => {
        if (this.#loaded === loading) this.#loaded = undefined;
      });
      this.#loaded = loading;
    }
    return this.#loaded;
  }

  async #loadCatalog(): Promise<Catalog> {
    const stored = this.#readStored();
    if (stored && this.#now() - Date.parse(stored.fetched_at) < CATALOG_TTL_MS) return stored;
    try {
      const [lines, stops] = await Promise.all([
        this.#get(`${this.#baseUrl}linesDiscovery/lines`),
        this.#get(`${this.#baseUrl}linesDiscovery/stops`),
      ]);
      const catalog = buildCatalog(parseLines(lines), parseStops(stops), nowIso(this.#now));
      this.#store?.set(CATALOG_STORAGE_KEY, JSON.stringify(catalog));
      return catalog;
    } catch (error) {
      // The network changes a few times a year: an expired catalogue beats no board at all.
      if (stored && error instanceof UpstreamUnavailable) return stored;
      throw error;
    }
  }

  #readStored(): Catalog | null {
    const catalog = this.#readJson(CATALOG_STORAGE_KEY) as Partial<Catalog> | null;
    return catalog && Array.isArray(catalog.stops) && typeof catalog.fetched_at === 'string'
      ? (catalog as Catalog)
      : null;
  }

  async #get(url: string, signal?: AbortSignal): Promise<unknown> {
    const { response, body } = await fetchJson(this.#fetch, url, {
      signal,
      timeoutMs: this.#timeoutMs,
    });
    if (response.status === 429 || response.status >= 500) {
      throw new UpstreamUnavailable(`${url}: HTTP ${response.status}`);
    }
    if (!response.ok) throw new UpstreamSchemaError(`HTTP ${response.status} inesperado`, url);
    return body;
  }
}

interface ProblemBody {
  readonly type?: string;
  readonly detail?: string;
  readonly title?: string;
}

/** Talks to a logrono-bus server; maps its RFC 9457 problems back onto the error types. */
export class BackendSource implements DataSource {
  readonly kind = 'servidor';
  readonly #apiBase: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  #index: Promise<CatalogIndex> | undefined;

  constructor(apiBase: string = SAME_ORIGIN_API, options: SourceOptions = {}) {
    this.#apiBase = apiBase.replace(/\/+$/, '');
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  catalog(): Promise<CatalogIndex> {
    if (!this.#index) {
      const loading = this.#get<Catalog>('/catalog').then((catalog) => new CatalogIndex(catalog));
      loading.catch(() => {
        if (this.#index === loading) this.#index = undefined;
      });
      this.#index = loading;
    }
    return this.#index;
  }

  arrivals(stopId: string, signal?: AbortSignal): Promise<StopArrivals> {
    return this.#get<StopArrivals>(`/stops/${encodeURIComponent(stopId)}/arrivals`, signal);
  }

  vehicles(lineId: string, signal?: AbortSignal): Promise<LineVehicles> {
    return this.#get<LineVehicles>(`/lines/${encodeURIComponent(lineId)}/vehicles`, signal);
  }

  timetable(lineId: string, signal?: AbortSignal): Promise<LineTimetable> {
    return this.#get<LineTimetable>(`/lines/${encodeURIComponent(lineId)}/timetable`, signal);
  }

  async #get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const { response, body } = await fetchJson(this.#fetch, `${this.#apiBase}${path}`, {
      signal,
      timeoutMs: this.#timeoutMs,
    });
    if (response.ok) return body as T;
    const problem = (body ?? {}) as ProblemBody;
    // Type URIs end in `…/errores/#<slug>`; older or foreign servers may use `…/<slug>`.
    const slug = problem.type?.split(/[#/]/).pop() ?? '';
    const detail = problem.detail ?? problem.title ?? `HTTP ${response.status}`;
    switch (slug) {
      case 'parada-no-encontrada':
        throw new StopNotFound(path.split('/')[2] ?? '');
      case 'linea-no-encontrada':
        throw new LineNotFound(path.split('/')[2] ?? '');
      case 'seleccion-no-valida':
        throw new InvalidSelection(detail);
      case 'origen-cambiado':
        throw new UpstreamSchemaError(detail, path);
      default:
        throw new UpstreamUnavailable(detail);
    }
  }
}

/** Whether a logrono-bus server answers at `apiBase` with an API version this app speaks. */
export async function probeBackend(apiBase: string, fetcher: FetchLike): Promise<boolean> {
  try {
    const { response, body } = await fetchJson(fetcher, `${apiBase.replace(/\/+$/, '')}/health`, {
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    return response.ok && (body as Partial<Health> | null)?.api_version === SUPPORTED_API_VERSION;
  } catch {
    return false;
  }
}

export interface SelectOptions extends SourceOptions {
  /** `location.protocol` of the page, to refuse mixed content up front with a clear message. */
  readonly pageProtocol?: string;
}

/**
 * Pick the data source for a board: an explicit choice wins; `auto` uses a server on the page's
 * own origin when there is one (the Docker image) and the Ayuntamiento's API otherwise.
 */
export async function selectSource(
  config: Pick<BoardConfig, 'source' | 'api'>,
  options: SelectOptions = {},
): Promise<DataSource> {
  const fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const apiBase = config.api ?? SAME_ORIGIN_API;
  if (config.api && options.pageProtocol === 'https:' && config.api.startsWith('http:')) {
    throw new UnusableSource(
      'Esta página es https y el servidor indicado es http: el navegador bloquea esa conexión. ' +
        'Abre la web desde tu propio servidor o publícalo con https.',
    );
  }
  if (config.source === 'directa') return new DirectSource(UPSTREAM_BASE_URL, options);
  if (config.source === 'servidor' || config.api) return new BackendSource(apiBase, options);
  return (await probeBackend(apiBase, fetcher))
    ? new BackendSource(apiBase, options)
    : new DirectSource(UPSTREAM_BASE_URL, options);
}

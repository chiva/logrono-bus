/**
 * Validated parsing of the upstream JSON, mirroring `logrono_bus.providers.logrono.raw`.
 *
 * Every surprise becomes an `UpstreamSchemaError` naming the JSON path, with the same paths and
 * defaults as the Python parser, so both report an API change identically.
 */
import { UpstreamSchemaError } from './errors.ts';

export interface RawStopRef {
  readonly id: string;
  readonly name: string;
}

export interface RawLine {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
  readonly asc: readonly RawStopRef[];
  readonly desc: readonly RawStopRef[];
}

export interface RawStop {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly lineIds: readonly string[];
}

export interface RawArrival {
  readonly lineId: string;
  readonly stopId: string;
  readonly directionRef: string;
  readonly vehicleRef: string;
  readonly order: number | null;
  /** ISO 8601, re-emitted exactly as Python's `datetime.isoformat()` would. */
  readonly aimed: string;
  readonly expected: string;
  readonly arrivalStatus: string;
  readonly cancelled: boolean;
  readonly inaccurate: boolean;
  readonly delayS: number;
}

export interface RawVehicle {
  readonly vehicleRef: string;
  readonly lineId: string;
  /** "Ida" / "Vuelta" here, unlike the numeric codes of the arrivals endpoint. */
  readonly directionRef: string;
  readonly lat: number;
  readonly lon: number;
  /** Empty when unknown. */
  readonly nextStopId: string;
  readonly recordedAt: string;
  readonly delayS: number;
}

export interface RawFrequency {
  /** First departure of the period, "HH:MM" local time. */
  readonly first: string;
  readonly last: string;
  readonly intervalMin: number;
  /** Present when the headway varies within the period (`intervalMinutesMax`). */
  readonly intervalMaxMin: number | null;
}

export interface RawDirectionTimetable {
  /** "Ida" / "Vuelta", as in vehicle positions. */
  readonly name: string;
  readonly frequencies: readonly RawFrequency[];
  /** Today's departures, "HH:MM" local time, in the order given. */
  readonly passes: readonly string[];
}

type JsonObject = Readonly<Record<string, unknown>>;

const typeName = (value: unknown): string => {
  if (value === null) return 'NoneType';
  if (Array.isArray(value)) return 'list';
  switch (typeof value) {
    case 'string':
      return 'str';
    case 'boolean':
      return 'bool';
    case 'number':
      return Number.isInteger(value) ? 'int' : 'float';
    case 'object':
      return 'dict';
    default:
      return typeof value;
  }
};

function expectObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UpstreamSchemaError(`se esperaba un objeto, llegó ${typeName(value)}`, path);
  }
  return value as JsonObject;
}

function expectList(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new UpstreamSchemaError(`se esperaba una lista, llegó ${typeName(value)}`, path);
  }
  return value;
}

function required(obj: JsonObject, key: string, path: string): unknown {
  if (!(key in obj)) throw new UpstreamSchemaError('falta el campo', `${path}.${key}`);
  return obj[key];
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new UpstreamSchemaError(`se esperaba texto, llegó ${typeName(value)}`, path);
  }
  return value.trim();
}

function int(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new UpstreamSchemaError(`se esperaba un entero, llegó ${typeName(value)}`, path);
  }
  return value;
}

function num(value: unknown, path: string): number {
  if (typeof value !== 'number') {
    throw new UpstreamSchemaError(`se esperaba un número, llegó ${typeName(value)}`, path);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new UpstreamSchemaError(`se esperaba un booleano, llegó ${typeName(value)}`, path);
  }
  return value;
}

/** Catalogue ids are ints, arrivals use strings, some endpoints zero-pad: one canonical form. */
function identifier(value: unknown, path: string): string {
  if (typeof value === 'boolean') {
    throw new UpstreamSchemaError('se esperaba un identificador, llegó un booleano', path);
  }
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  const text = str(value, path);
  if (!text) throw new UpstreamSchemaError('identificador vacío', path);
  return /^\d+$/.test(text) ? String(Number.parseInt(text, 10)) : text;
}

function optionalIdentifier(value: unknown, path: string): string {
  return value === undefined || value === null || value === '' ? '' : identifier(value, path);
}

const ISO_DATETIME =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** Validate a timezone-aware ISO 8601 string and re-emit it the way Python's isoformat does. */
export function canonicalTimestamp(value: unknown, path: string): string {
  const text = str(value, path);
  const match = ISO_DATETIME.exec(text);
  if (!match) {
    const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text);
    throw new UpstreamSchemaError(
      naive ? `fecha sin zona horaria '${text}'` : `fecha no válida '${text}'`,
      path,
    );
  }
  const [, date, hours, minutes, seconds = '00', fraction = '', zone = ''] = match;
  const micros = fraction.padEnd(6, '0');
  const fractionPart = Number(micros) === 0 ? '' : `.${micros}`;
  const offset =
    zone === 'Z'
      ? '+00:00'
      : zone.length === 3
        ? `${zone}:00`
        : zone.includes(':')
          ? zone
          : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const canonical = `${date}T${hours}:${minutes}:${seconds}${fractionPart}${offset}`;
  if (Number.isNaN(Date.parse(canonical))) {
    throw new UpstreamSchemaError(`fecha no válida '${text}'`, path);
  }
  return canonical;
}

function result(payload: unknown, key: string): readonly unknown[] {
  const root = expectObject(payload, '$');
  const inner = expectObject(required(root, 'result', '$'), '$.result');
  return expectList(required(inner, key, '$.result'), `$.result.${key}`);
}

function stopRefs(value: unknown, path: string): RawStopRef[] {
  return expectList(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const obj = expectObject(item, itemPath);
    return {
      id: identifier(required(obj, 'id', itemPath), `${itemPath}.id`),
      name: str(required(obj, 'name', itemPath), `${itemPath}.name`),
    };
  });
}

export function parseLines(payload: unknown): RawLine[] {
  return result(payload, 'lines').map((item, index) => {
    const path = `$.result.lines[${index}]`;
    const obj = expectObject(item, path);
    const stops = expectObject(required(obj, 'stops', path), `${path}.stops`);
    return {
      id: identifier(required(obj, 'id', path), `${path}.id`),
      name: str(required(obj, 'name', path), `${path}.name`),
      colour: str(required(obj, 'color', path), `${path}.color`),
      asc: stopRefs(required(stops, 'asc', `${path}.stops`), `${path}.stops.asc`),
      desc: stopRefs(required(stops, 'desc', `${path}.stops`), `${path}.stops.desc`),
    };
  });
}

export function parseStops(payload: unknown): RawStop[] {
  return result(payload, 'stops').map((item, index) => {
    const path = `$.result.stops[${index}]`;
    const obj = expectObject(item, path);
    const lineIds = expectList(obj['lines'] ?? [], `${path}.lines`);
    return {
      id: identifier(required(obj, 'id', path), `${path}.id`),
      name: str(required(obj, 'name', path), `${path}.name`),
      lat: num(required(obj, 'lat', path), `${path}.lat`),
      lon: num(required(obj, 'lng', path), `${path}.lng`),
      lineIds: lineIds.map((lineId, i) => identifier(lineId, `${path}.lines[${i}]`)),
    };
  });
}

export function parseArrivals(payload: unknown): RawArrival[] {
  return result(payload, 'arrivals').map((item, index) => {
    const path = `$.result.arrivals[${index}]`;
    const obj = expectObject(item, path);
    const order = obj['order'];
    return {
      lineId: identifier(required(obj, 'lineRef', path), `${path}.lineRef`),
      stopId: identifier(required(obj, 'stopPointRef', path), `${path}.stopPointRef`),
      directionRef: optionalIdentifier(obj['directionRef'], `${path}.directionRef`),
      vehicleRef: optionalIdentifier(obj['vehicleRef'], `${path}.vehicleRef`),
      order: order === undefined || order === null ? null : int(order, `${path}.order`),
      aimed: canonicalTimestamp(
        required(obj, 'aimedArrivalTime', path),
        `${path}.aimedArrivalTime`,
      ),
      expected: canonicalTimestamp(
        required(obj, 'expectedArrivalTime', path),
        `${path}.expectedArrivalTime`,
      ),
      arrivalStatus: str(obj['arrivalStatus'] ?? '', `${path}.arrivalStatus`),
      cancelled: bool(obj['cancellation'] ?? false, `${path}.cancellation`),
      inaccurate: bool(obj['predictionInaccurate'] ?? false, `${path}.predictionInaccurate`),
      delayS: int(obj['delaySeconds'] ?? 0, `${path}.delaySeconds`),
    };
  });
}

/**
 * Parse `GET vehicleMonitoring/byLine/{line}`. Its `nextStop*ArrivalTime` fields are local times
 * wrongly labelled UTC and are not read; `locationRecordedAtTime` is correct UTC.
 */
export function parseVehicles(payload: unknown): RawVehicle[] {
  return result(payload, 'activities').map((item, index) => {
    const path = `$.result.activities[${index}]`;
    const obj = expectObject(item, path);
    return {
      vehicleRef: identifier(required(obj, 'vehicleRef', path), `${path}.vehicleRef`),
      lineId: identifier(required(obj, 'lineRef', path), `${path}.lineRef`),
      directionRef: str(obj['directionRef'] ?? '', `${path}.directionRef`),
      lat: num(required(obj, 'latitude', path), `${path}.latitude`),
      lon: num(required(obj, 'longitude', path), `${path}.longitude`),
      nextStopId: optionalIdentifier(obj['nextStopRef'], `${path}.nextStopRef`),
      recordedAt: canonicalTimestamp(
        required(obj, 'locationRecordedAtTime', path),
        `${path}.locationRecordedAtTime`,
      ),
      delayS: int(obj['delaySeconds'] ?? 0, `${path}.delaySeconds`),
    };
  });
}

const CLOCK = /^(\d{1,2}):(\d{2})$/;
/** Timetables may write after-midnight trips as 24:xx–29:xx; anything later is not a time. */
const MAX_CLOCK_HOUR = 29;
const MINUTES_PER_HOUR = 60;

/** "7:05" or "07:05" → "07:05". */
function clock(value: unknown, path: string): string {
  const raw = str(value, path);
  const match = CLOCK.exec(raw);
  const hours = match ? Number(match[1]) : Number.NaN;
  const minutes = match ? Number(match[2]) : Number.NaN;
  if (!match || hours > MAX_CLOCK_HOUR || minutes >= MINUTES_PER_HOUR) {
    throw new UpstreamSchemaError(`hora no válida: '${raw}'`, path);
  }
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

function frequency(item: unknown, path: string): RawFrequency {
  const obj = expectObject(item, path);
  const max = obj['intervalMinutesMax'];
  return {
    first: clock(required(obj, 'firstPass', path), `${path}.firstPass`),
    last: clock(required(obj, 'lastPass', path), `${path}.lastPass`),
    intervalMin: int(required(obj, 'intervalMinutes', path), `${path}.intervalMinutes`),
    intervalMaxMin:
      max === undefined || max === null ? null : int(max, `${path}.intervalMinutesMax`),
  };
}

/**
 * Parse `GET productionTimetable/byLine/{line}`: today's service, per direction. Only the
 * per-direction lists are read; `frequencies` and `passes` merge both directions.
 */
export function parseTimetable(payload: unknown): RawDirectionTimetable[] {
  const root = expectObject(payload, '$');
  const inner = expectObject(required(root, 'result', '$'), '$.result');
  const frequencies = expectObject(
    required(inner, 'frequenciesByDirection', '$.result'),
    '$.result.frequenciesByDirection',
  );
  const passes = expectObject(
    required(inner, 'passesByDirection', '$.result'),
    '$.result.passesByDirection',
  );
  const names = [...new Set([...Object.keys(passes), ...Object.keys(frequencies)])];
  return names.map((name) => {
    const passesPath = `$.result.passesByDirection.${name}`;
    const frequenciesPath = `$.result.frequenciesByDirection.${name}`;
    return {
      name,
      frequencies: expectList(frequencies[name] ?? [], frequenciesPath).map((item, index) =>
        frequency(item, `${frequenciesPath}[${index}]`),
      ),
      passes: expectList(passes[name] ?? [], passesPath).map((item, index) =>
        clock(item, `${passesPath}[${index}]`),
      ),
    };
  });
}

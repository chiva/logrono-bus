/** Error hierarchy mirroring `logrono_bus.errors`, so the UI can react precisely. */

export class LogronoBusError extends Error {
  override name = 'LogronoBusError';
}

export class UpstreamError extends LogronoBusError {
  override name = 'UpstreamError';
}

/** Network failure, timeout, CORS refusal or 5xx: transient, worth retrying. */
export class UpstreamUnavailable extends UpstreamError {
  override name = 'UpstreamUnavailable';
}

/** The data source answered in a shape this version does not understand. */
export class UpstreamSchemaError extends UpstreamError {
  override name = 'UpstreamSchemaError';
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.path = path;
  }
}

export class StopNotFound extends LogronoBusError {
  override name = 'StopNotFound';
  readonly stopId: string;

  constructor(stopId: string) {
    super(`La parada '${stopId}' no existe`);
    this.stopId = stopId;
  }
}

export class LineNotFound extends LogronoBusError {
  override name = 'LineNotFound';
  readonly lineId: string;

  constructor(lineId: string) {
    super(`La línea '${lineId}' no existe`);
    this.lineId = lineId;
  }
}

export class InvalidSelection extends LogronoBusError {
  override name = 'InvalidSelection';
}

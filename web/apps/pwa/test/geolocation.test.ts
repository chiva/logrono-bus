import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GEOLOCATION_TIMEOUT_MS,
  LocationUnavailable,
  RECENT_POSITION_MAX_AGE_MS,
  locate,
} from '../src/geolocation.ts';

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;
const AT_STOP_101 = { latitude: 42.46563, longitude: -2.439249, accuracy: 20 };

type Lookup = (
  found: PositionCallback,
  failed: PositionErrorCallback,
  options: PositionOptions,
) => void;

function positionError(code: number): GeolocationPositionError {
  return { code, message: 'stub', PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT };
}

function position(coords: Partial<GeolocationCoordinates>): GeolocationPosition {
  return { coords: coords as GeolocationCoordinates, timestamp: 0 } as GeolocationPosition;
}

function secure(value: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
}

/** Replace the browser's geolocation with `lookup`; returns the spy to inspect its options. */
function stubGeolocation(lookup: Lookup) {
  const getCurrentPosition = vi.fn(lookup);
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
  });
  return getCurrentPosition;
}

describe('locate', () => {
  beforeEach(() => secure(true));
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'geolocation');
    Reflect.deleteProperty(window, 'isSecureContext');
  });

  it('resolves the position, asking for a precise and recent one', async () => {
    const lookup = stubGeolocation((found) => found(position(AT_STOP_101)));

    await expect(locate()).resolves.toEqual({ lat: 42.46563, lon: -2.439249, accuracyM: 20 });
    expect(lookup.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      timeout: GEOLOCATION_TIMEOUT_MS,
      maximumAge: RECENT_POSITION_MAX_AGE_MS,
    });
  });

  it('passes on how old a cached position may be', async () => {
    const lookup = stubGeolocation((found) => found(position(AT_STOP_101)));

    await locate(0);
    expect(lookup.mock.calls[0]?.[2]).toMatchObject({ maximumAge: 0 });
  });

  it.each([
    [PERMISSION_DENIED, 'No has dado permiso para usar tu ubicación'],
    [POSITION_UNAVAILABLE, 'No se ha podido obtener tu ubicación'],
    [TIMEOUT, 'No se ha podido obtener tu ubicación'],
  ])('explains browser error %i in Spanish', async (code, message) => {
    stubGeolocation((_found, failed) => failed(positionError(code)));

    const error: unknown = await locate().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LocationUnavailable);
    expect((error as Error).message).toContain(message);
  });

  it('rejects coordinates that are not on Earth', async () => {
    stubGeolocation((found) => found(position({ latitude: 200, longitude: 0, accuracy: 5 })));

    await expect(locate()).rejects.toThrow('No se ha podido obtener tu ubicación');
  });

  it('asks for https before trying, outside a secure page', async () => {
    secure(false);
    const lookup = stubGeolocation((found) => found(position(AT_STOP_101)));

    await expect(locate()).rejects.toThrow('solo permite usar la ubicación en páginas https');
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([undefined, null])(
    'says it cannot locate when the browser has no geolocation (%s)',
    async (missing) => {
      Object.defineProperty(navigator, 'geolocation', { value: missing, configurable: true });

      const error: unknown = await locate().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LocationUnavailable);
      expect((error as Error).message).toContain('No se ha podido obtener tu ubicación');
    },
  );
});

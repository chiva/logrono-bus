/**
 * Where the person is, once per request: no `watchPosition`, nothing stored here. Shared by the
 * stop picker («Cerca de mí» in the wizard) and the near-me view (`#cerca`).
 *
 * Leaflet is loaded on demand, so nothing here may import values from the map module.
 */
import { validHere } from './picker-memory.ts';
import type { Here } from './views/stop-map.ts';

export const GEOLOCATION_TIMEOUT_MS = 15_000;
/** Stops farther than this are not "near you". */
export const NEARBY_RADIUS_M = 600;
export const NO_STOPS_NEARBY = `No hay paradas a menos de ${NEARBY_RADIUS_M} m. ¿Estás en Logroño?`;
/** A position this recent is good enough for listing stops around the person. */
export const RECENT_POSITION_MAX_AGE_MS = 60_000;

/** A failed `locate()`: its message is the Spanish sentence to show. */
export class LocationUnavailable extends Error {
  override name = 'LocationUnavailable';
}

export function geolocationError(error: GeolocationPositionError | Error): string {
  if (!window.isSecureContext) {
    return 'El navegador solo permite usar la ubicación en páginas https. Busca la parada por nombre o en el mapa.';
  }
  if ('code' in error && error.code === error.PERMISSION_DENIED) {
    return 'No has dado permiso para usar tu ubicación. Puedes buscar la parada por nombre o en el mapa.';
  }
  return 'No se ha podido obtener tu ubicación. Prueba a buscar la parada por nombre.';
}

/**
 * The person's position, or `LocationUnavailable` explaining why not. `maximumAgeMs`: how old a
 * position the browser may hand back from its cache.
 */
export function locate(maximumAgeMs: number = RECENT_POSITION_MAX_AGE_MS): Promise<Here> {
  // Typed as always present, but missing (or null) in some browsers and embedded web views.
  const geolocation = navigator.geolocation as Geolocation | null | undefined;
  if (!geolocation || !window.isSecureContext) {
    return Promise.reject(new LocationUnavailable(geolocationError(new Error('unavailable'))));
  }
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const here = validHere({ lat: latitude, lon: longitude, accuracyM: accuracy });
        if (here) resolve(here);
        else reject(new LocationUnavailable(geolocationError(new Error('invalid position'))));
      },
      (error) => reject(new LocationUnavailable(geolocationError(error))),
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: maximumAgeMs },
    );
  });
}

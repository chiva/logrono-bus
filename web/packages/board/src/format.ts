/** How times read on a card. Spanish, short, and legible from across a room. */
import {
  type Arrival,
  type ServiceStatus,
  TIMEZONE,
  describeInterval,
  minutesUntil,
} from '@logrono-bus/core';

/** From this many minutes on, a clock time ("18:42") reads better than a countdown. */
export const CLOCK_TIME_FROM_MIN = 60;

export interface TimeLabel {
  /** The big part: "4", "Llegando", "18:42". */
  readonly value: string;
  /** "min", or empty when `value` stands alone. */
  readonly unit: string;
  /** Full sentence for screen readers. */
  readonly spoken: string;
}

const clock = new Intl.DateTimeFormat('es-ES', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
});

export function formatClock(timestamp: string | number): string {
  return clock.format(new Date(timestamp));
}

export function timeLabel(arrival: Arrival, nowMs: number): TimeLabel {
  if (arrival.cancelled) return { value: 'Cancelado', unit: '', spoken: 'cancelado' };
  const minutes = minutesUntil(arrival.expected, nowMs);
  if (minutes === 0) return { value: 'Llegando', unit: '', spoken: 'llegando' };
  if (minutes >= CLOCK_TIME_FROM_MIN) {
    const at = formatClock(arrival.expected);
    return { value: at, unit: '', spoken: `a las ${at}` };
  }
  return {
    value: String(minutes),
    unit: 'min',
    spoken: minutes === 1 ? 'en 1 minuto' : `en ${minutes} minutos`,
  };
}

/** "hace 40 s", "hace 3 min": how old the data on screen is. */
export function formatAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  return `hace ${Math.round(seconds / 60)} min`;
}

/** What a card with no bus due says, from where the line stands in its day. */
export function serviceSentence(status: ServiceStatus | null | undefined): string {
  switch (status?.state) {
    case 'antes':
      return `Primera salida a las ${status.first}`;
    case 'terminado':
      return `Servicio terminado · última salida ${status.last}`;
    case 'sin_servicio':
      return 'Hoy no hay servicio';
    case 'en_servicio':
      return status.interval_min === null
        ? 'Sin llegadas próximas'
        : `Sin llegadas próximas · pasa ${describeInterval(status.interval_min, status.interval_max_min)}`;
    default:
      return 'Sin llegadas próximas';
  }
}

/**
 * Keeping a board alive on a wall screen for days (Echo Show, old tablet):
 *
 * - **Frozen tab detection.** Browsers freeze background tabs and timers; when the page comes
 *   back, a gap far larger than the tick interval reveals it, and the caller refreshes at once and
 *   tells the user.
 * - **Periodic reload.** Long-lived pages leak memory on some embedded browsers (Silk); a full
 *   reload every few hours keeps them fresh, but only while online so the screen never ends up on
 *   an error page.
 */

export const GUARD_TICK_MS = 10_000;
export const FROZEN_AFTER_MS = 60_000;
export const RELOAD_EVERY_MS = 6 * 60 * 60 * 1000;

export interface KioskGuardOptions {
  readonly onFrozen: (gapMs: number) => void;
  readonly reload: () => void;
  readonly isOnline?: () => boolean;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export class KioskGuard {
  readonly #options: Required<KioskGuardOptions>;
  #lastTick = 0;
  #startedAt = 0;
  #handle: unknown;

  constructor(options: KioskGuardOptions) {
    this.#options = {
      isOnline: () => navigator.onLine,
      now: Date.now,
      setTimer: (callback, ms) => setInterval(callback, ms),
      clearTimer: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      ...options,
    };
  }

  start(): void {
    this.#startedAt = this.#lastTick = this.#options.now();
    this.#handle = this.#options.setTimer(() => this.tick(), GUARD_TICK_MS);
  }

  stop(): void {
    if (this.#handle !== undefined) this.#options.clearTimer(this.#handle);
    this.#handle = undefined;
  }

  tick(): void {
    const now = this.#options.now();
    const gap = now - this.#lastTick;
    this.#lastTick = now;
    if (gap > FROZEN_AFTER_MS) this.#options.onFrozen(gap);
    if (now - this.#startedAt >= RELOAD_EVERY_MS && this.#options.isOnline()) {
      this.stop();
      this.#options.reload();
    }
  }
}

/** Ask the browser to keep the screen on (Wake Lock API); silently unavailable on many devices. */
export async function keepScreenOn(): Promise<() => void> {
  // Absent on Silk and on the Portal's browser, although the DOM typings declare it always.
  const wakeLock = (navigator as Partial<Navigator>).wakeLock;
  if (!wakeLock) return () => undefined;
  try {
    const sentinel = await wakeLock.request('screen');
    return () => void sentinel.release();
  } catch {
    return () => undefined;
  }
}

/**
 * Refresh loop for a board, independent of the DOM so it can be tested with fake timers.
 *
 * - Refreshes every `intervalMs` (30 s by default: the upstream is a public service we do not own,
 *   and buses do not move fast enough to need more).
 * - On failure it backs off exponentially, with jitter, up to `maxBackoffMs`, so a screen left on
 *   during an outage does not hammer the upstream; the first success resets the pace.
 * - It pauses while the page is hidden and refreshes immediately when it becomes visible again.
 */

export const DEFAULT_INTERVAL_MS = 30_000;
export const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000;
export const JITTER_RATIO = 0.2;

export interface PollerOptions {
  readonly intervalMs?: number;
  readonly maxBackoffMs?: number;
  readonly random?: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export class Poller {
  readonly #task: (signal: AbortSignal) => Promise<void>;
  readonly #intervalMs: number;
  readonly #maxBackoffMs: number;
  readonly #random: () => number;
  readonly #setTimer: (callback: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  #timer: unknown;
  #controller: AbortController | undefined;
  #failures = 0;
  #running = false;
  #paused = false;

  constructor(task: (signal: AbortSignal) => Promise<void>, options: PollerOptions = {}) {
    this.#task = task;
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.#random = options.random ?? Math.random;
    this.#setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.#clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get failures(): number {
    return this.#failures;
  }

  /** Delay before the next run, given the current failure streak. */
  nextDelayMs(): number {
    if (this.#failures === 0) return this.#intervalMs;
    const backoff = Math.min(this.#maxBackoffMs, this.#intervalMs * 2 ** this.#failures);
    const jitter = backoff * JITTER_RATIO * (this.#random() * 2 - 1);
    return Math.round(Math.min(this.#maxBackoffMs, backoff + jitter));
  }

  /** Begin polling; when paused, the first request waits until `setPaused(false)`. */
  start(): void {
    if (this.#running) return;
    this.#running = true;
    if (!this.#paused) void this.runNow();
  }

  stop(): void {
    this.#running = false;
    this.#clear();
    this.#controller?.abort();
  }

  /** Pause while hidden (no requests), resume with an immediate refresh. */
  setPaused(paused: boolean): void {
    if (paused === this.#paused) return;
    this.#paused = paused;
    if (paused) {
      this.#clear();
    } else if (this.#running) {
      void this.runNow();
    }
  }

  async runNow(): Promise<void> {
    this.#clear();
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    try {
      await this.#task(controller.signal);
      this.#failures = 0;
    } catch {
      if (controller.signal.aborted) return;
      this.#failures += 1;
    }
    if (this.#running && !this.#paused && this.#controller === controller) {
      this.#timer = this.#setTimer(() => void this.runNow(), this.nextDelayMs());
    }
  }

  #clear(): void {
    if (this.#timer !== undefined) this.#clearTimer(this.#timer);
    this.#timer = undefined;
  }
}

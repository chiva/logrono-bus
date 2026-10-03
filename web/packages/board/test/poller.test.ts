import { describe, expect, it, vi } from 'vitest';

import { Poller } from '../src/index.ts';

function harness(task: (signal: AbortSignal) => Promise<void>) {
  const timers: { callback: () => void; ms: number }[] = [];
  const poller = new Poller(task, {
    intervalMs: 30_000,
    maxBackoffMs: 300_000,
    random: () => 0.5,
    setTimer: (callback, ms) => {
      timers.push({ callback, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { poller, timers };
}

describe('Poller', () => {
  it('runs immediately, then every interval while it succeeds', async () => {
    const task = vi.fn(async () => undefined);
    const { poller, timers } = harness(task);
    poller.start();
    poller.start();
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    expect(task).toHaveBeenCalledTimes(1);
    expect(timers[0]?.ms).toBe(30_000);
    timers[0]?.callback();
    await vi.waitFor(() => expect(timers).toHaveLength(2));
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('backs off exponentially on failure, capped, and resets on success', async () => {
    let fail = true;
    const { poller, timers } = harness(async () => {
      if (fail) throw new Error('down');
    });
    poller.start();
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    expect(poller.failures).toBe(1);
    expect(timers[0]?.ms).toBe(60_000);
    for (let attempt = 2; attempt <= 6; attempt += 1) {
      timers.at(-1)?.callback();
      await vi.waitFor(() => expect(timers).toHaveLength(attempt));
    }
    expect(timers.at(-1)?.ms).toBe(300_000);
    fail = false;
    timers.at(-1)?.callback();
    await vi.waitFor(() => expect(timers).toHaveLength(7));
    expect(poller.failures).toBe(0);
    expect(timers.at(-1)?.ms).toBe(30_000);
  });

  it('pauses while hidden and refreshes as soon as it is visible again', async () => {
    const task = vi.fn(async () => undefined);
    const { poller, timers } = harness(task);
    poller.start();
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    poller.setPaused(true);
    poller.setPaused(true);
    await poller.runNow();
    expect(timers).toHaveLength(1);
    poller.setPaused(false);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(3));
    expect(timers).toHaveLength(2);
  });

  it('started while paused, makes no request until resumed', async () => {
    const task = vi.fn(() => Promise.resolve());
    const { poller } = harness(task);
    poller.setPaused(true);
    poller.start();
    await Promise.resolve();
    expect(task).not.toHaveBeenCalled();
    poller.setPaused(false);
    await vi.waitFor(() => expect(task).toHaveBeenCalledOnce());
  });

  it('aborts the in-flight run on stop and does not count it as a failure', async () => {
    let seen: AbortSignal | undefined;
    const { poller, timers } = harness(
      (signal) =>
        new Promise((_resolve, reject) => {
          seen = signal;
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    poller.start();
    await vi.waitFor(() => expect(seen).toBeDefined());
    poller.stop();
    expect(seen?.aborted).toBe(true);
    await Promise.resolve();
    expect(poller.failures).toBe(0);
    expect(timers).toHaveLength(0);
  });

  it('adds up to ±20 % jitter to failure delays', async () => {
    const { poller } = harness(async () => {
      throw new Error('x');
    });
    await poller.runNow();
    const jittered = new Poller(
      async () => {
        throw new Error('x');
      },
      { random: () => 1, setTimer: () => 0, clearTimer: () => undefined },
    );
    await jittered.runNow();
    expect(jittered.nextDelayMs()).toBe(72_000);
    expect(poller.nextDelayMs()).toBe(60_000);
  });
});

describe('previousStopsThatFit', () => {
  it('caps the stops before yours to what the screen has room for', async () => {
    const { previousStopsThatFit } = await import('../src/index.ts');
    // Echo Show 5 landscape: 960 px wide, track text about 21.6 px.
    expect(previousStopsThatFit(960, 'horizontal', 21.6)).toBe(7);
    expect(previousStopsThatFit(300, 'vertical', 20)).toBe(3);
    // Never fewer than one, never more than the setting allows.
    expect(previousStopsThatFit(100, 'vertical', 20)).toBe(1);
    expect(previousStopsThatFit(5000, 'vertical', 20)).toBe(12);
    // Not measured yet: do not cap.
    expect(previousStopsThatFit(0, 'horizontal', 20)).toBe(12);
  });
});

/**
 * Tolerant key-value storage. localStorage can be missing or throw (private browsing, the Echo
 * Show's Silk with site data blocked, quota); the app must keep working without it.
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  readonly #data = new Map<string, string>();

  get(key: string): string | null {
    return this.#data.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.#data.set(key, value);
  }

  remove(key: string): void {
    this.#data.delete(key);
  }
}

/** Wraps a `Storage`; every failure degrades to "not stored". */
export class SafeStorage implements KeyValueStore {
  readonly #storage: Storage | undefined;

  constructor(storage: () => Storage | undefined) {
    try {
      this.#storage = storage();
    } catch {
      this.#storage = undefined;
    }
  }

  get(key: string): string | null {
    try {
      return this.#storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      this.#storage?.setItem(key, value);
    } catch {
      // Quota exceeded or storage disabled: the value simply is not persisted.
    }
  }

  remove(key: string): void {
    try {
      this.#storage?.removeItem(key);
    } catch {
      // Same as set(): nothing to clean up if storage is unavailable.
    }
  }
}

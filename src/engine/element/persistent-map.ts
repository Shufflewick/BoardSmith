import type { Game } from './game.js';

/**
 * A Map-like structure that persists through HMR by syncing to game.settings.
 * Use game.persistentMap() to create instances.
 *
 * Limitations:
 * - Keys must be strings. The backing store is a JSON object in
 *   `game.settings`, and a JSON object key IS a string: `K` was previously
 *   `string | number`, and a map declared with number keys handed those keys
 *   back as strings from `keys()`, `entries()`, `forEach()` and iteration
 *   while still typing them `number` (#149). Key a map by seat with
 *   `String(seat)`.
 * - Values must be serializable to JSON (no element references, functions, etc.)
 * - For element references, use element children instead
 */
export class PersistentMap<K extends string, V> implements Map<K, V> {
  #game: Game;
  #key: string;

  constructor(game: Game, key: string) {
    this.#game = game;
    this.#key = key;
    // Initialize settings entry if not exists
    if (!(key in game.settings)) {
      game.settings[key] = {};
    }
  }

  #getData(): Record<string, V> {
    return (this.#game.settings[this.#key] as Record<string, V>) ?? {};
  }

  #setData(data: Record<string, V>): void {
    this.#game.settings[this.#key] = data;
  }

  #toMap(): Map<K, V> {
    const data = this.#getData();
    // LOAD-BEARING. `Object.entries` widens every key to `string`; `K` may be a
    // narrower literal union (`'north' | 'south'`), and nothing at runtime can
    // prove the stored keys are still inside it — a previous session, or a
    // hand-edited snapshot, could have written any string. The cast is a single
    // assertion within `string`, not the `as unknown as` that used to hide a
    // number key coming back as a string.
    return new Map(Object.entries(data).map(([k, v]) => [k as K, v as V]));
  }

  get size(): number {
    return Object.keys(this.#getData()).length;
  }

  get(key: K): V | undefined {
    return this.#getData()[key];
  }

  set(key: K, value: V): this {
    const data = this.#getData();
    data[key] = value;
    this.#setData(data);
    return this;
  }

  has(key: K): boolean {
    return key in this.#getData();
  }

  delete(key: K): boolean {
    const data = this.#getData();
    const existed = key in data;
    delete data[key];
    this.#setData(data);
    return existed;
  }

  clear(): void {
    this.#setData({});
  }

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
    const data = this.#getData();
    for (const [k, v] of Object.entries(data)) {
      // See `#toMap` for why the key needs an assertion back into `K`.
      callbackfn.call(thisArg, v as V, k as K, this);
    }
  }

  entries() {
    return this.#toMap().entries();
  }

  keys() {
    return this.#toMap().keys();
  }

  values() {
    return this.#toMap().values();
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return 'PersistentMap';
  }
}

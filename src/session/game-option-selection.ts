/**
 * How a player's choice of game options becomes something a host may store or
 * hand to a game constructor.
 *
 * A game declares the options its players may set (`GameDefinition.gameOptions`:
 * a number, a boolean, a select). Everything else in `GameOptions` is minted
 * by the engine or the host (`seed`, `elementIdKey`, `playerCount`, the colour
 * palette, ...), and a client that could write one of those would choose the
 * game's shuffles or decode its element ids (#447). So a selection is admitted
 * only through {@link selectGameOptions}, which refuses an undeclared key, a
 * host-owned key, a value that is not of the declared type, and a number
 * outside its declared `min`/`max` or off its `step`, and the
 * session's types take a {@link GameOptionSelection}, which nothing else can
 * produce. A host that spreads a client's object straight into a constructor
 * is then a type error, not a leak found in review.
 */
import { ENGINE_OWNED_GAME_OPTION_KEYS } from '../engine/element/game.js';
import { PERSIST_KEY } from '../persistence/persistence.js';
import type { GameOptionDefinition, NumberOption } from '../types/protocol.js';

/**
 * Every option name a player's selection may not use: each `GameOptions`
 * field, and the fields the session or the dev host adds to a game's
 * constructor options from the lobby (`playerConfigs`, `playerOptions`,
 * `playerIsBot`) or from the persistence store.
 */
export const HOST_OWNED_GAME_OPTION_KEYS: readonly string[] = [
  ...ENGINE_OWNED_GAME_OPTION_KEYS,
  'playerConfigs',
  'playerOptions',
  'playerIsBot',
  PERSIST_KEY,
];

const hostOwned = new Set(HOST_OWNED_GAME_OPTION_KEYS);

/**
 * A selection that was refused: an undeclared or host-owned key, a value
 * that is not of its option's declared type, or a number outside its
 * option's declared `min`/`max` or off its `step`. The message names the option and
 * what would be accepted, so a host can show it to the player as it is.
 */
export class GameOptionSelectionError extends Error {}

declare const selected: unique symbol;

/**
 * Player-chosen game options that passed {@link selectGameOptions}: only
 * declared options, each of its declared type, and no host-owned key. The
 * brand means only that function makes one, so a session or a start op
 * typed to take a selection cannot be handed a client's raw object.
 */
export type GameOptionSelection = Readonly<Record<string, unknown>> & { readonly [selected]: true };

/**
 * Refuse a game's option declarations if one is named for a field the host
 * owns, or is a number option whose `min`, `max` or `step` no value could
 * satisfy (not a finite number, `min` above `max`, a `step` that is not
 * positive). Such an option could never be chosen, so the game is wrong, not
 * the player; this says so when the game is loaded rather than at its first
 * lobby.
 */
export function assertDeclarableGameOptions(declared: Record<string, GameOptionDefinition> | undefined): void {
  if (!declared) return;
  for (const [name, def] of Object.entries(declared)) {
    if (hostOwned.has(name)) {
      throw new Error(
        `This game declares a game option named "${name}", which is a field the engine or the host ` +
          `sets for every game, so a player could never choose it. Rename the option.`,
      );
    }
    if (def.type === 'number') assertDeclarableBounds(name, def);
  }
}

function assertDeclarableBounds(name: string, def: NumberOption): void {
  for (const field of ['min', 'max', 'step'] as const) {
    const value: unknown = def[field];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(
        `This game declares number option "${name}" with ${field} ${JSON.stringify(value) ?? String(value)}, ` +
          `which is not a finite number. Give ${field} a number or leave it out.`,
      );
    }
  }
  if (def.min !== undefined && def.max !== undefined && def.min > def.max) {
    throw new Error(
      `This game declares number option "${name}" with min ${def.min} above max ${def.max}, ` +
        `so no value could be chosen. Swap or correct them.`,
    );
  }
  if (def.step !== undefined && def.step <= 0) {
    throw new Error(
      `This game declares number option "${name}" with step ${def.step}; a step must be above 0. ` +
        `Give a positive step or leave it out.`,
    );
  }
}

/** A number as a person would write it, without binary rounding noise (0.30000000000000004 is 0.3). */
function plain(n: number): string {
  return String(Number(n.toPrecision(12)));
}

/**
 * Refuse a number outside the option's declared range or off its step. The
 * step counts from `min`, or from 0 when there is no `min`, as an HTML number
 * input counts it, so the lobby's spinner and this check agree on what is
 * reachable. A fractional step is compared with a tolerance, since 0.3 is not
 * an exact multiple of 0.1 in binary.
 */
function checkNumberBounds(name: string, def: NumberOption, n: number): void {
  const { min, max, step } = def;
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
    const range =
      min !== undefined && max !== undefined
        ? `between ${plain(min)} and ${plain(max)}`
        : min !== undefined
          ? `at least ${plain(min)}`
          : `at most ${plain(max as number)}`;
    throw new GameOptionSelectionError(`Game option "${name}" must be ${range}, got ${plain(n)}.`);
  }
  if (step !== undefined) {
    const base = min ?? 0;
    const steps = (n - base) / step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9 * Math.max(1, Math.abs(steps))) {
      const examples = [0, 1, 2].map((i) => plain(base + i * step)).join(', ');
      throw new GameOptionSelectionError(
        `Game option "${name}" must be in steps of ${plain(step)} from ${plain(base)} (${examples}, ...), got ${plain(n)}.`,
      );
    }
  }
}

function coerce(name: string, def: GameOptionDefinition, raw: unknown): unknown {
  // A lobby text field and a `--game-option` flag both send strings, so a
  // string is read as the declared type; whatever arrives, the value is
  // checked against that type before it is admitted.
  switch (def.type) {
    case 'number': {
      const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        throw new GameOptionSelectionError(`Game option "${name}" must be a number, got ${JSON.stringify(raw)}.`);
      }
      checkNumberBounds(name, def, n);
      return n;
    }
    case 'boolean': {
      const b = raw === 'true' ? true : raw === 'false' ? false : raw;
      if (typeof b !== 'boolean') {
        throw new GameOptionSelectionError(`Game option "${name}" must be true or false, got ${JSON.stringify(raw)}.`);
      }
      return b;
    }
    case 'select': {
      // Resolve a string to the declared choice it names, so a numeric choice
      // is reachable from a text input; membership is checked below.
      const value = typeof raw === 'string' ? (def.choices.find((c) => String(c.value) === raw)?.value ?? raw) : raw;
      if (!def.choices.some((c) => c.value === value)) {
        throw new GameOptionSelectionError(
          `Invalid value ${JSON.stringify(value)} for game option "${name}": must be one of: ` +
            `${def.choices.map((c) => JSON.stringify(c.value)).join(', ')}.`,
        );
      }
      return value;
    }
    default:
      return raw;
  }
}

/**
 * Admit a player's selection against the game's declared options.
 *
 * Returns a new object holding only the keys of `raw` that are declared, each
 * coerced to its declared type; a key whose value is `undefined` is no choice
 * and is left out. Throws {@link GameOptionSelectionError} for a host-owned
 * key, an undeclared key or a value the declaration does not admit (wrong
 * type, not a declared choice, a number outside `min`/`max` or off `step`),
 * and a plain error if the declarations themselves are unusable (see
 * {@link assertDeclarableGameOptions}).
 */
export function selectGameOptions(
  declared: Record<string, GameOptionDefinition> | undefined,
  raw: Record<string, unknown>,
): GameOptionSelection {
  assertDeclarableGameOptions(declared);
  const selection: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (hostOwned.has(name)) {
      throw new GameOptionSelectionError(
        `Game option "${name}" cannot be chosen: the engine or the host sets it for every game.`,
      );
    }
    // Own declarations only: `raw` is parsed client JSON, and a name such as
    // "constructor" or "toString" is found on every object's prototype.
    const def = declared !== undefined && Object.hasOwn(declared, name) ? declared[name] : undefined;
    if (!def) {
      const known = Object.keys(declared ?? {});
      throw new GameOptionSelectionError(
        known.length === 0
          ? `Unknown game option "${name}": this game declares no game options.`
          : `Unknown game option "${name}": the declared options are ${known.join(', ')}.`,
      );
    }
    // Defined as an own data property, never assigned: assigning "__proto__"
    // would set the selection's prototype instead of a key.
    Object.defineProperty(selection, name, { value: coerce(name, def, value), enumerable: true, writable: true, configurable: true });
  }
  return selection as GameOptionSelection;
}

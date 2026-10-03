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
 * host-owned key, and a value that is not of the declared type, and the
 * session's types take a {@link GameOptionSelection}, which nothing else can
 * produce. A host that spreads a client's object straight into a constructor
 * is then a type error, not a leak found in review.
 */
import { ENGINE_OWNED_GAME_OPTION_KEYS } from '../engine/element/game.js';
import { PERSIST_KEY } from '../persistence/persistence.js';
import type { GameOptionDefinition } from '../types/protocol.js';

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
 * A selection that was refused: an undeclared or host-owned key, or a value
 * that is not of its option's declared type. The message names the option and
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
 * owns. Such an option could never be chosen (the selection would be refused
 * by name), so the game is wrong, not the player; this says so when the game
 * is loaded rather than at its first lobby.
 */
export function assertDeclarableGameOptions(declared: Record<string, GameOptionDefinition> | undefined): void {
  if (!declared) return;
  for (const name of Object.keys(declared)) {
    if (hostOwned.has(name)) {
      throw new Error(
        `This game declares a game option named "${name}", which is a field the engine or the host ` +
          `sets for every game, so a player could never choose it. Rename the option.`,
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
 * key, an undeclared key or a value the declaration does not admit, and a
 * plain error if the declarations themselves name a host-owned field.
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

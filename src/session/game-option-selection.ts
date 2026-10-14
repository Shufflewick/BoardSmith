/**
 * How a player's choice of game options becomes something a host may store or
 * hand to a game constructor.
 *
 * A game declares the options its players may set in one place, the
 * `gameOptions` list in `boardsmith.json` (a number, a boolean, a select, each
 * with a default; read by {@link parseGameOptionList}, #701). Everything else
 * in `GameOptions` is minted
 * by the engine or the host (`seed`, `elementIdKey`, `playerCount`, the colour
 * palette, ...), and a client that could write one of those would choose the
 * game's shuffles or decode its element ids (#447). So a selection is admitted
 * only through {@link selectGameOptions}, which refuses an undeclared key, a
 * host-owned key, a value that is not of the declared type, and a number
 * outside its declared `min`/`max` or off its `step`, and the
 * session's types take a {@link GameOptionSelection}, which nothing else can
 * produce. An option declared `designerOnly` is refused there too: only
 * {@link selectDesignerGameOptions}, which `boardsmith simulate` and the dev
 * host's table setup call, admits it (#687). A host that spreads a client's object straight into a constructor
 * is then a type error, not a leak found in review.
 */
import { valuesEqual } from '../engine/action/choice-matching.js';
import { ENGINE_OWNED_GAME_OPTION_KEYS } from '../engine/element/game.js';
import { PERSIST_KEY } from '../persistence/persistence.js';
import type { GameOptionDefinition, NumberOption, SelectOption } from '../types/protocol.js';
import type { GamePreset } from './types.js';

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
 * owns, is not a number, boolean or select option, is a number option whose
 * `min`, `max` or `step` no value could satisfy (not a finite number, `min`
 * above `max`, a `step` that is not positive), or has no `default` or one its
 * own declaration refuses. Such an option could never be chosen, or would start
 * a game on a value no player could choose, so the game is wrong, not the
 * player; this says so when the game is loaded rather than at its first lobby.
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
    assertDeclarableShape(name, def);
    if (def.type === 'number') assertDeclarableBounds(name, def);
    assertDeclarableDefault(name, def);
  }
}

/** Throws, naming the option, when it is not a labelled number, boolean or select option with choices. */
function assertDeclarableShape(name: string, def: GameOptionDefinition): void {
  const type: unknown = def.type;
  if (type !== 'number' && type !== 'boolean' && type !== 'select') {
    throw new Error(
      `This game declares game option "${name}" with type ${JSON.stringify(type)}; a game option's ` +
        `type is "number", "boolean" or "select".`,
    );
  }
  if (typeof def.label !== 'string') {
    throw new Error(`This game declares game option "${name}" with no label. Give it the label a player sees.`);
  }
  if (def.type === 'select' && (!Array.isArray(def.choices) || def.choices.length === 0)) {
    throw new Error(
      `This game declares select option "${name}" with no choices. Give it a "choices" list of { value, label }.`,
    );
  }
}

/**
 * Every option is filled with its default when nobody chooses it (see
 * {@link fillGameOptionDefaults}), so every option needs one, and one its own
 * declaration admits.
 */
function assertDeclarableDefault(name: string, def: GameOptionDefinition): void {
  if (def.default === undefined) {
    throw new Error(
      `This game declares game option "${name}" with no default. Give it a default: it is the value ` +
        `a game is played with when nobody chooses one` +
        (def.designerOnly ? ', and no player can choose a designer-only option, so every real game is played with it.' : '.'),
    );
  }
  try {
    coerce(name, def, def.default);
  } catch (err) {
    if (!(err instanceof GameOptionSelectionError)) throw err;
    throw new Error(
      `This game declares game option "${name}" with default ${JSON.stringify(def.default)}, which its own ` +
        `declaration refuses: ${err.message} Correct the default.`,
    );
  }
}

/**
 * Refuse a game's presets if one sets an option a player could not choose: a
 * preset is a shortcut a player picks, so its options must pass
 * {@link selectGameOptions}. A preset naming a designer-only option, an
 * undeclared option or a value its option refuses is the game's mistake, so
 * this says so when the game is loaded, naming the preset.
 */
export function assertPresetsSelectable(
  declared: Record<string, GameOptionDefinition> | undefined,
  presets: readonly GamePreset[] | undefined,
): void {
  for (const preset of presets ?? []) {
    try {
      selectGameOptions(declared, preset.options ?? {});
    } catch (err) {
      if (!(err instanceof GameOptionSelectionError)) throw err;
      throw new Error(`This game's preset "${preset.name}" cannot be used: ${err.message} Correct the preset.`);
    }
  }
}

/** Throws, naming the field, when a number option declares a bound or default that is not a finite number. */
function assertFiniteBoundFields(name: string, def: NumberOption): void {
  for (const field of ['min', 'max', 'step', 'default'] as const) {
    const value: unknown = def[field];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(
        `This game declares number option "${name}" with ${field} ${JSON.stringify(value) ?? String(value)}, ` +
          `which is not a finite number. Give ${field} a number or leave it out.`,
      );
    }
  }
}

function assertDeclarableBounds(name: string, def: NumberOption): void {
  assertFiniteBoundFields(name, def);
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
  const problem = def.default === undefined ? undefined : numberBoundsProblem(def, def.default);
  if (problem !== undefined) {
    throw new Error(
      `This game declares number option "${name}" with default ${def.default}, but the option ` +
        `must be ${problem}. Correct the default or the bounds.`,
    );
  }
}

/** A number as a person would write it, without binary rounding noise (0.30000000000000004 is 0.3). */
function plain(n: number): string {
  return String(Number(n.toPrecision(12)));
}

/**
 * What a number option admits, said for a message, if `n` is outside the
 * option's declared range or off its step; `undefined` if `n` is admitted.
 *
 * The step counts from `min`, or from 0 when there is no `min`, as an HTML
 * number input counts it, so the lobby's spinner and this check agree on what
 * is reachable; a `max` that is off the step can therefore never be chosen.
 * `n` is compared with the nearest step value it rounds to, within a tolerance
 * that does not grow with the distance from the base (0.3 is not an exact
 * multiple of 0.1 in binary, but 1000000001 is plainly not a multiple of 2).
 */
function numberBoundsProblem(def: NumberOption, n: number): string | undefined {
  return rangeProblem(def, n) ?? stepProblem(def, n);
}

/** The option's range, said for a message, if `n` is outside it. */
function rangeProblem({ min, max }: NumberOption, n: number): string | undefined {
  if ((min === undefined || n >= min) && (max === undefined || n <= max)) return undefined;
  if (min === undefined) return `at most ${plain(max as number)}`;
  return max === undefined ? `at least ${plain(min)}` : `between ${plain(min)} and ${plain(max)}`;
}

/** The option's step, said for a message, if `n` is off it (see `numberBoundsProblem`). */
function stepProblem({ min, step }: NumberOption, n: number): string | undefined {
  if (step === undefined) return undefined;
  const base = min ?? 0;
  const k = Math.round((n - base) / step);
  if (Math.abs(n - (base + k * step)) <= Math.max(step * 1e-9, Math.abs(n) * 1e-12)) return undefined;
  const examples = [0, 1, 2].map((i) => plain(base + i * step)).join(', ');
  return `in steps of ${plain(step)} from ${plain(base)} (${examples}, ...)`;
}

/**
 * Freeze a declared choice value, and every plain object and array inside it,
 * in place. A game receives the declared value itself, and the same
 * declaration starts every later game in the process (the dev host restarts
 * from it), so a game that could change the value would change its own
 * declaration for the next game; frozen, the write throws in the game instead.
 * Anything that is not a plain object or array is left as it is.
 */
function deepFreeze(value: unknown): unknown {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
  } else if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    Object.values(value).forEach(deepFreeze);
  } else {
    return value;
  }
  return Object.freeze(value);
}

function coerce(name: string, def: GameOptionDefinition, raw: unknown): unknown {
  // A lobby text field and a `--game-option` flag both send strings, so a
  // string is read as the declared type; whatever arrives, the value is
  // checked against that type before it is admitted.
  switch (def.type) {
    case 'number':
      return coerceNumber(name, def, raw);
    case 'boolean':
      return coerceBoolean(name, raw);
    case 'select':
      return coerceSelect(name, def, raw);
    default:
      return raw;
  }
}

function coerceNumber(name: string, def: NumberOption, raw: unknown): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new GameOptionSelectionError(`Game option "${name}" must be a number, got ${JSON.stringify(raw)}.`);
  }
  const problem = numberBoundsProblem(def, n);
  if (problem !== undefined) {
    throw new GameOptionSelectionError(`Game option "${name}" must be ${problem}, got ${n}.`);
  }
  return n;
}

function coerceBoolean(name: string, raw: unknown): boolean {
  const b = raw === 'true' ? true : raw === 'false' ? false : raw;
  if (typeof b !== 'boolean') {
    throw new GameOptionSelectionError(`Game option "${name}" must be true or false, got ${JSON.stringify(raw)}.`);
  }
  return b;
}

function coerceSelect(name: string, def: SelectOption, raw: unknown): unknown {
  // A value matches a choice under `valuesEqual`, so an object choice that
  // crossed the wire as an equal object is still that choice (#574). Failing
  // that, a string names the non-object choice it spells, so a numeric
  // choice is reachable from a text input; an object is never named by its
  // text, which would make "[object Object]" the first object choice (#593).
  // The declared choice's value is returned, frozen (see `deepFreeze`).
  const choice =
    def.choices.find((c) => valuesEqual(c.value, raw)) ??
    (typeof raw === 'string'
      ? def.choices.find((c) => (typeof c.value !== 'object' || c.value === null) && String(c.value) === raw)
      : undefined);
  if (!choice) {
    throw new GameOptionSelectionError(
      `Invalid value ${JSON.stringify(raw)} for game option "${name}": must be one of: ` +
        `${def.choices.map((c) => JSON.stringify(c.value)).join(', ')}.`,
    );
  }
  return deepFreeze(choice.value);
}

/**
 * Admit a player's selection against the game's declared options.
 *
 * Returns a new object holding every declared option: the value `raw` gives
 * it, coerced to its declared type, or else its declared default (a key whose
 * value is `undefined` is no choice, so it gets the default too). Throws {@link GameOptionSelectionError} for a host-owned
 * key, an undeclared or designer-only key or a value the declaration does not
 * admit (wrong type, not a declared choice, a number outside `min`/`max` or
 * off `step`), and a plain error if the declarations themselves are unusable
 * (see {@link assertDeclarableGameOptions}).
 */
export function selectGameOptions(
  declared: Record<string, GameOptionDefinition> | undefined,
  raw: Record<string, unknown>,
): GameOptionSelection {
  return select(declared, raw, false);
}

/**
 * Admit the game designer's selection: {@link selectGameOptions}, except that
 * an option declared `designerOnly` may be set too. Only `boardsmith simulate`
 * (`--game-option`, `--compare`) and the dev host's table setup call this; a
 * host taking a player's choice never does.
 */
export function selectDesignerGameOptions(
  declared: Record<string, GameOptionDefinition> | undefined,
  raw: Record<string, unknown>,
): GameOptionSelection {
  return select(declared, raw, true);
}

function select(
  declared: Record<string, GameOptionDefinition> | undefined,
  raw: Record<string, unknown>,
  designer: boolean,
): GameOptionSelection {
  assertDeclarableGameOptions(declared);
  const selection: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const def = choosable(declared, name, designer);
    defineOption(selection, name, coerce(name, def, value));
  }
  return fillGameOptionDefaults(declared, selection) as GameOptionSelection;
}

/**
 * Defined as an own data property, never assigned: assigning "__proto__"
 * would set the object's prototype instead of a key.
 */
function defineOption(options: Record<string, unknown>, name: string, value: unknown): void {
  Object.defineProperty(options, name, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * A copy of `options` in which every declared option that is missing or
 * `undefined` holds its declared default, so a game reads `options.x` and never
 * repeats a default in code (#701). Both selections end here, and so does every
 * new `GameRunner` given `declaredGameOptions` (#708), which the `start` op
 * (with the declarations the game's bundle carries, see
 * {@link withDeclaredGameOptions}), `createTestGame` and the bot benchmark pass,
 * so every host starts a game with every option it declares.
 */
export function fillGameOptionDefaults<O extends Record<string, unknown>>(
  declared: Record<string, GameOptionDefinition> | undefined,
  options: O,
): O {
  const filled: Record<string, unknown> = { ...options };
  for (const [name, def] of Object.entries(declared ?? {})) {
    if (filled[name] === undefined) defineOption(filled, name, coerce(name, def, def.default));
  }
  return filled as O;
}

/** The declaration of option `name` if this selection may set it; throws {@link GameOptionSelectionError} if not. */
function choosable(
  declared: Record<string, GameOptionDefinition> | undefined,
  name: string,
  designer: boolean,
): GameOptionDefinition {
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
  if (def.designerOnly && !designer) {
    throw new GameOptionSelectionError(
      `Game option "${name}" is designer-only: players never choose it. Only boardsmith simulate ` +
        `and the dev host's table setup set it.`,
    );
  }
  return def;
}


/**
 * Read `boardsmith.json`'s `gameOptions` list, the one place a game declares
 * its options (#701), into the declarations keyed by option id that the
 * selections take. Every field but `id` is the option's declaration. Throws,
 * naming the entry, for a list that is not one, an entry with no `id`, an id
 * declared twice, a `designerOnly` that is not `true`, and anything
 * {@link assertDeclarableGameOptions} refuses. An absent list declares nothing.
 */
export function parseGameOptionList(list: unknown): Record<string, GameOptionDefinition> {
  if (list === undefined) return {};
  if (!Array.isArray(list)) {
    throw new Error(
      `boardsmith.json's "gameOptions" must be a list of options, each with an "id", got ${typeof list}.`,
    );
  }
  const declared: Record<string, GameOptionDefinition> = {};
  list.forEach((entry: unknown, index) => {
    const { id, ...def } = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    if (typeof id !== 'string' || id === '') {
      throw new Error(
        `boardsmith.json's game option ${index + 1} has no "id". Give every entry in "gameOptions" an "id": ` +
          `it is the name a game reads the option by (options.<id>).`,
      );
    }
    if (Object.hasOwn(declared, id)) {
      throw new Error(`boardsmith.json declares game option "${id}" twice. Remove or rename one.`);
    }
    if (def.designerOnly !== undefined && def.designerOnly !== true) {
      throw new Error(
        `boardsmith.json's game option "${id}" has designerOnly ${JSON.stringify(def.designerOnly)}; ` +
          `set it to true or leave it out.`,
      );
    }
    defineOption(declared, id, def);
  });
  assertDeclarableGameOptions(declared);
  return deepFreeze(declared) as Record<string, GameOptionDefinition>;
}

/**
 * The registered symbol under which a loaded game definition carries its option
 * declarations: a key no game writes by accident, and one every copy of the
 * engine (the CLI's, a bundle's, a platform runner's) reads alike.
 * `boardsmith build` writes it into the published rules (`rulesEntrySource`).
 */
export const DECLARED_GAME_OPTIONS_KEY = 'boardsmith.declaredGameOptions';
const DECLARED_GAME_OPTIONS = Symbol.for(DECLARED_GAME_OPTIONS_KEY);

/**
 * The game definition with `boardsmith.json`'s option list attached, as every
 * BoardSmith command loads it (`boardsmith dev`, `simulate`, `validate`, and
 * `build`, which writes the same declarations into the rules it publishes), so
 * the `start` op fills even a designer-only option, which no manifest lists,
 * with its default. Refuses a definition that still declares `gameOptions`
 * itself, saying where they go.
 */
export function withDeclaredGameOptions<D extends object>(definition: D, list: unknown): D {
  if (Object.hasOwn(definition, 'gameOptions')) {
    throw new Error(
      'This gameDefinition declares gameOptions. A game declares its options in one place, the ' +
        '"gameOptions" list in boardsmith.json (one entry per option, with an "id"); move them there ' +
        'and delete gameOptions from the gameDefinition.',
    );
  }
  return { ...definition, [DECLARED_GAME_OPTIONS]: parseGameOptionList(list) };
}

/**
 * The option declarations a loaded game definition carries (see
 * {@link withDeclaredGameOptions}), or `undefined` for a definition imported
 * straight from source, as a game's own tests do.
 */
export function declaredGameOptionsOf(definition: object): Record<string, GameOptionDefinition> | undefined {
  return (definition as { [DECLARED_GAME_OPTIONS]?: Record<string, GameOptionDefinition> })[DECLARED_GAME_OPTIONS];
}

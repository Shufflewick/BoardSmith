import { isDeepStrictEqual } from 'node:util';
import type { PlayerOptionDefinition } from '../../session/types.js';
import { numberBoundsProblem } from '../../session/game-option-selection.js';

/** A player option in boardsmith.json's list form, where its key is a field. */
export interface ConfigOptionDefinition {
  id?: string;
  name?: string;
  type: string;
  label: string;
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

type Option = Record<string, unknown>;

const isPair = (c: unknown) =>
  typeof c === 'object' && c !== null && typeof (c as Option).value === 'string' && typeof (c as Option).label === 'string';

function choiceProblems(name: string, option: Option): string[] {
  const { type, default: initial, choices } = option;
  if (typeof initial !== 'string') return [`${name} needs a string "default".`];
  if (!Array.isArray(choices) || choices.length === 0 || !choices.every(isPair)) {
    return [`${name} needs "choices": a non-empty list of { "value", "label" } strings, e.g. [{ "value": "easy", "label": "Easy" }].`];
  }
  const values = choices.map((c: Option) => c.value);
  // The platform lets an exclusive default name a seat ("last") rather than a choice.
  return type === 'select' && !values.includes(initial)
    ? [`${name} has default "${initial}", which is none of its choices (${values.join(', ')}).`]
    : [];
}

function numberProblems(name: string, { default: initial, min, max, step }: Option): string[] {
  if (typeof initial !== 'number') return [`${name} needs a number "default".`];
  if ([min, max, step].some((n) => n !== undefined && typeof n !== 'number')) {
    return [`${name} needs "min", "max" and "step", where given, to be numbers.`];
  }
  if (typeof step === 'number' && step <= 0) return [`${name} needs a "step" above 0.`];
  if (typeof min === 'number' && initial < min) return [`${name} has default ${initial}, below its min of ${min}.`];
  if (typeof max === 'number' && initial > max) return [`${name} has default ${initial}, above its max of ${max}.`];
  return [];
}

/** What each type the platform's manifest accepts needs (ShufflewickPub games/src/manifest-schema.ts). */
const TYPE_CHECKS: Record<string, (name: string, option: Option) => string[]> = {
  number: numberProblems,
  select: choiceProblems,
  exclusive: choiceProblems,
  boolean: (name, option) => (typeof option.default === 'boolean' ? [] : [`${name} needs a true or false "default".`]),
};

/** Why the platform's manifest could not carry this player option; empty when it can. */
function publishProblems(key: string, option: Option): string[] {
  const name = `Player option "${key}"`;
  const check = TYPE_CHECKS[option.type as string];
  if (!check) {
    return [`${name} has type ${JSON.stringify(option.type)}, which the lobby has no control for. Use "number", "select", "boolean" or "exclusive".`];
  }
  const label = typeof option.label === 'string' && option.label !== '' ? [] : [`${name} needs a "label".`];
  return [...label, ...check(name, option)];
}

/**
 * A game's player options: the ones its gameDefinition declares and the ones
 * boardsmith.json declares, by key (#992). `boardsmith dev` and the published
 * manifest both read this, so the dev lobby and the live one offer the same
 * list. A key the two declare differently is refused, since either answer
 * would silently drop the other, and so is an option the platform's manifest
 * cannot carry, since dev would offer what the live lobby cannot. Colour is
 * left out of code and refused in boardsmith.json: the lobby builds it from
 * `colorPalette` (#814).
 */
export function mergePlayerOptions(
  code: Record<string, PlayerOptionDefinition> | undefined,
  config: unknown,
): Record<string, PlayerOptionDefinition> {
  if (config !== undefined && !Array.isArray(config)) {
    throw new Error(
      'boardsmith.json "playerOptions" must be a list of options, each with an "id", ' +
        'e.g. [{ "id": "botLevel", "type": "select", "label": "Difficulty", "default": "easy", ' +
        '"choices": [{ "value": "easy", "label": "Easy" }] }].',
    );
  }
  const { color: _color, ...merged } = { ...code };
  const seen = new Set<string>();
  ((config ?? []) as ConfigOptionDefinition[]).forEach(({ id, name, ...declared }, index) => {
    const key = id ?? name;
    if (!key) {
      throw new Error(`boardsmith.json playerOptions[${index}] has no "id". Give it one, e.g. "id": "botLevel".`);
    }
    if (key === 'color') {
      throw new Error(
        'boardsmith.json declares a "color" player option, which the lobby never offers: it builds colour from ' +
          '"colorPalette". Remove the "color" entry and list your colours in boardsmith.json\'s "colorPalette".',
      );
    }
    if (seen.has(key)) {
      throw new Error(`boardsmith.json declares player option "${key}" twice. Remove or rename one.`);
    }
    seen.add(key);
    const inCode = code?.[key];
    // Compared as JSON, the form the manifest publishes, so an undefined field in code is no difference.
    if (inCode !== undefined && !isDeepStrictEqual(JSON.parse(JSON.stringify(inCode)), declared)) {
      throw new Error(
        `The player option "${key}" is declared in both your gameDefinition and boardsmith.json, differently.\n` +
          `  gameDefinition: ${JSON.stringify(inCode)}\n` +
          `  boardsmith.json: ${JSON.stringify(declared)}\n` +
          `Declare "${key}" in one place, or make the two declarations the same.`,
      );
    }
    merged[key] = declared as unknown as PlayerOptionDefinition;
  });
  const problems = Object.entries(merged).flatMap(([key, option]) => publishProblems(key, option as unknown as Option));
  if (problems.length > 0) {
    throw new Error(
      `The live lobby could not offer these player options, so neither dev nor build will:\n  ${problems.join('\n  ')}`,
    );
  }
  return merged;
}

type Exclusive = Extract<PlayerOptionDefinition, { type: 'exclusive' }>;
type SeatOption = Exclude<PlayerOptionDefinition, { type: 'color' }>;

/** The options a seat sets, by key: every declared one but colour, which is chosen with the seat. */
function seatOptionEntries(options: Record<string, PlayerOptionDefinition>): Array<[string, SeatOption]> {
  return Object.entries(options).filter((entry): entry is [string, SeatOption] => entry[1].type !== 'color');
}

/**
 * The seat (1-indexed) an exclusive option's default names, read as the
 * platform's lobby reads it (ShufflewickPub `resolveExclusiveDefaultSeat`):
 * "last" is the last seat, a whole number is that seat kept in range, and
 * anything else is the first seat.
 */
function defaultHolder(option: Exclusive, playerCount: number): number {
  if (option.default === 'last') return playerCount;
  const seat = option.default === '' ? NaN : Number(option.default);
  return Number.isInteger(seat) ? Math.min(Math.max(seat, 1), playerCount) : 1;
}

/**
 * What each seat starts with for the player options `options` declares
 * (#1304, #1325): each select, number and boolean option's default, and each
 * exclusive option's first choice on the one seat its default names, as the
 * platform's lobby starts a table. Colour is chosen per seat from its palette,
 * so it is not here.
 */
export function defaultSeatOptions(
  options: Record<string, PlayerOptionDefinition>,
  playerCount: number,
): Array<Record<string, unknown>> {
  const entries = seatOptionEntries(options);
  const personal = Object.fromEntries(entries.flatMap(([key, option]) => (option.type === 'exclusive' ? [] : [[key, option.default]])));
  const seats = Array.from({ length: playerCount }, () => ({ ...personal }) as Record<string, unknown>);
  for (const [key, option] of entries) {
    if (option.type === 'exclusive') seats[defaultHolder(option, playerCount) - 1][key] = option.choices[0].value;
  }
  return seats;
}

/** Which seat holds each exclusive option: the start op's `exclusiveSeats`, as the platform sends it. */
export function exclusiveSeats(
  options: Record<string, PlayerOptionDefinition>,
  seats: Array<Record<string, unknown>>,
): Record<string, number> {
  return Object.fromEntries(
    seatOptionEntries(options).flatMap(([key, option]) =>
      option.type === 'exclusive' ? [[key, seats.findIndex((seat) => seat[key] !== undefined) + 1]] : [],
    ),
  );
}

function numberRefusal(option: Extract<SeatOption, { type: 'number' }>, value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${option.label} must be a number, not ${JSON.stringify(value)}.`;
  const problem = numberBoundsProblem(option, value);
  return problem === undefined ? undefined : `${option.label} must be ${problem}, not ${value}.`;
}

/** Why `value` cannot be `option`'s value, or undefined when it can. */
function valueRefusal(option: SeatOption, value: unknown): string | undefined {
  if (option.type === 'number') return numberRefusal(option, value);
  if (option.type === 'boolean') {
    return typeof value === 'boolean' ? undefined : `${option.label} must be true or false, not ${JSON.stringify(value)}.`;
  }
  const values = option.choices.map((c) => c.value);
  return values.includes(value as string)
    ? undefined
    : `${option.label} is ${JSON.stringify(value)}, which is none of its choices (${values.join(', ')}).`;
}

/** Why `seat`'s options cannot be set, or undefined when they can. */
function seatRefusal(options: Record<string, PlayerOptionDefinition>, values: unknown, seat: number): string | undefined {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return `Seat ${seat}'s player options must be a set of option values, such as { "ready": true }.`;
  }
  const entries = seatOptionEntries(options);
  const missing = entries.find(([key, option]) => option.type !== 'exclusive' && !Object.hasOwn(values, key));
  if (missing) return `Seat ${seat} has no value for ${missing[1].label}. Give each seat a value for every player option.`;
  const declared = new Map(entries);
  for (const [key, value] of Object.entries(values)) {
    const option = declared.get(key);
    if (!option) {
      return `Seat ${seat}: "${key}" is not a player option of this game; its player options are ${[...declared.keys()].join(', ')}.`;
    }
    const refused = valueRefusal(option, value);
    if (refused !== undefined) return `Seat ${seat}: ${refused}`;
  }
  return undefined;
}

/**
 * Why `table` cannot be the seats' player options, or undefined when it can
 * (#1323). It is one set of values per seat, in seat order: each a declared
 * option's value of its type, refused as the platform's lobby refuses one,
 * with each exclusive option on exactly one seat, since the platform will not
 * start a table where one is unassigned or given twice.
 */
export function seatOptionsRefusal(
  options: Record<string, PlayerOptionDefinition>,
  table: unknown,
  playerCount: number,
): string | undefined {
  if (!Array.isArray(table) || table.length !== playerCount) {
    return `Send one set of player options for each of the ${playerCount} seats, in seat order.`;
  }
  for (const [index, values] of table.entries()) {
    const refused = seatRefusal(options, values, index + 1);
    if (refused !== undefined) return refused;
  }
  for (const [key, option] of seatOptionEntries(options)) {
    if (option.type !== 'exclusive') continue;
    const holders = table.flatMap((values: Record<string, unknown>, index) => (values[key] === undefined ? [] : [index + 1]));
    if (holders.length === 0) return `Give ${option.label} to one seat.`;
    if (holders.length > 1) return `${option.label} is given to seats ${holders.join(' and ')}; give it to one seat.`;
  }
  return undefined;
}

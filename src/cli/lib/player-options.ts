import { isDeepStrictEqual, styleText } from 'node:util';
import type { GameDefinition, GamePreset, PlayerOptionDefinition } from '../../session/types.js';
import { createColorOption, paletteChoices, type ColorChoice, type ColorOptionDefinition } from '../../session/colors.js';
import { numberBoundsProblem } from '../../session/game-option-selection.js';
import { parseBotLevel } from '../../bot/index.js';

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

/** The level `boardsmith dev` plays a seat at when neither `--bot-level` nor a preset gives one. */
export const DEV_BOT_LEVEL = 'medium';

/** One seat as the start op carries it. */
export interface StartSeat extends SeatSetup {
  name: string;
}

/**
 * The start op's seat fields, as the platform's start sends them (#1565): each
 * seat's player options with its colour, which seat holds each exclusive
 * option, which seats are bots, and the per-seat `playerConfigs`. `colors`
 * goes to the engine only when every seat has one, since a partial list would
 * misalign seats. The dev host and `presetStartOptions` both build it here.
 */
export function seatStartOptions(
  options: Record<string, PlayerOptionDefinition>,
  seats: StartSeat[],
  palette: readonly ColorChoice[],
): Record<string, unknown> {
  const playerOptions = seats.map((seat) => (seat.color === undefined ? { ...seat.playerOptions } : { ...seat.playerOptions, color: seat.color }));
  const colors = seats.map((seat) => seat.color);
  const labels = palette.length === 0 ? {} : { colorLabels: Object.fromEntries(palette.map((c) => [c.value, c.label])) };
  return {
    ...(colors.includes(undefined) ? {} : { colors, ...labels }),
    playerOptions,
    exclusiveSeats: exclusiveSeats(options, playerOptions),
    playerIsBot: seats.map((seat) => seat.isBot),
    // The seat's own fields go last, so a player option with the same key cannot replace them.
    playerConfigs: seats.map((seat, index) => ({ ...playerOptions[index], name: seat.name, isBot: seat.isBot, botLevel: seat.botLevel })),
  };
}

/** One seat as a preset sets it up, with every player option it did not set at its default (#1544). */
export interface SeatSetup {
  playerOptions: Record<string, unknown>;
  color?: string;
  isBot: boolean;
  botLevel?: string;
}

const PRESET_SEAT_FIELDS = ['color', 'isBot', 'botLevel', 'playerOptions'];

/** Why a preset's seat cannot be set up as written, apart from its player options, or undefined when it can. */
function presetSeatRefusal(seat: Record<string, unknown>, n: number, palette: readonly string[]): string | undefined {
  const field = Object.keys(seat).find((key) => !PRESET_SEAT_FIELDS.includes(key));
  if (field !== undefined) {
    return (
      `seat ${n} sets "${field}", which a preset seat does not take. A seat takes ${PRESET_SEAT_FIELDS.slice(0, -1).join(', ')} ` +
      `and playerOptions, and a player option goes in playerOptions, e.g. { playerOptions: { ${JSON.stringify(field)}: ... } }.`
    );
  }
  if (seat.color !== undefined && !palette.includes(seat.color as string)) {
    return `seat ${n}'s color ${JSON.stringify(seat.color)} is not in the game's colorPalette (${palette.join(', ')}).`;
  }
  if (seat.isBot !== undefined && typeof seat.isBot !== 'boolean') return `seat ${n}'s isBot must be true or false.`;
  if (seat.botLevel === undefined) return undefined;
  if (seat.isBot !== true) return `seat ${n} sets a botLevel but is not a bot. Give it isBot: true, or remove its botLevel.`;
  try {
    parseBotLevel(seat.botLevel as string);
  } catch (err) {
    return `seat ${n}: ${(err as Error).message}`;
  }
  return undefined;
}

/**
 * Each seat as `preset` sets it up, or undefined when it sets up no seats
 * (#1544). A player option a seat does not set takes its default, and an
 * exclusive option no seat sets goes to the seat its default names, as the
 * platform's lobby opens a table. Throws, naming the preset, on a seat the
 * platform's lobby would refuse: a field a seat does not take, a colour
 * outside `palette`, a bot level that is not one, or player options
 * {@link seatOptionsRefusal} refuses.
 */
export function presetSeatSetup(
  preset: GamePreset,
  options: Record<string, PlayerOptionDefinition>,
  palette: readonly string[],
): SeatSetup[] | undefined {
  const seats = preset.players as Array<Record<string, unknown>> | undefined;
  if (!seats?.length) return undefined;
  const refuse = (reason: string) => new Error(`This game's preset "${preset.name}" cannot be used: ${reason} Correct the preset.`);
  seats.forEach((seat, index) => {
    const refused = presetSeatRefusal(seat, index + 1, palette);
    if (refused !== undefined) throw refuse(refused);
  });
  const colors = seats.map((seat, index) => (seat.color as string | undefined) ?? palette[index]);
  const twin = colors.findIndex((color, index) => color !== undefined && colors.indexOf(color) !== index);
  if (twin !== -1) {
    throw refuse(`seats ${colors.indexOf(colors[twin]) + 1} and ${twin + 1} both take the color ${colors[twin]}; give each seat its own.`);
  }
  const given = seats.map((seat) => (seat.playerOptions ?? {}) as Record<string, unknown>);
  const set = new Set(given.flatMap((values) => Object.keys(values)));
  const table = defaultSeatOptions(options, seats.length).map((defaults, index) => {
    const values = Object.fromEntries(Object.entries(defaults).filter(([key]) => options[key]?.type !== 'exclusive' || !set.has(key)));
    return { ...values, ...given[index] };
  });
  const refused = seatOptionsRefusal(options, table, seats.length);
  if (refused !== undefined) throw refuse(refused);
  return seats.map((seat, index) => ({
    playerOptions: table[index],
    ...(seat.color === undefined ? {} : { color: seat.color as string }),
    isBot: seat.isBot === true,
    ...(seat.botLevel === undefined ? {} : { botLevel: seat.botLevel as string }),
  }));
}

/**
 * Normalize colorPalette entries to {value, label} format.
 * Accepts plain hex strings, {value, label}, or {hex, label, id} objects.
 *
 * IN-01: an object entry missing all of `value`/`hex`/`color` is malformed
 * (a typo'd field name, most often) — warn loudly (matches the
 * `formatUnknownKeyWarnings` non-exiting pattern) and DROP the entry instead
 * of emitting an invisible/unclickable empty-string swatch in the lobby
 * color picker.
 */
function normalizeColorPalette(
  palette: ReadonlyArray<string | object>
): Array<{ value: string; label: string }> {
  const { choices, unnamed } = paletteChoices(palette);
  for (const entry of unnamed) {
    console.warn(
      styleText('yellow',
        `  Warning: colorPalette entry ${JSON.stringify(entry)} is missing "value"/"hex"/"color" — skipped (not rendered as a swatch).`,
      ),
    );
  }
  return choices;
}

/**
 * D16/DEVHOST-04: the dev `color` player option, always offered, resolved as
 * production does: the published manifest carries only `boardsmith.json`'s
 * `colorPalette`, else players are seated in the engine palette (#814). A palette a
 * game declares in code is never published, so one that differs is refused
 * here rather than shown in dev and missing live. Its choices also seed each
 * seat's colour in MultiplayerHost, so the option and the seats always agree.
 */
export function resolveColorOption(
  gameDefinition: Pick<GameDefinition, 'playerOptions' | 'colorPalette'>,
  config: { colorPalette?: Array<string | Record<string, unknown>> },
): ColorOptionDefinition {
  const option = createColorOption();
  if (config.colorPalette) option.choices = normalizeColorPalette(config.colorPalette);
  const source = config.colorPalette ? 'boardsmith.json\'s "colorPalette"' : 'the engine\'s default palette';
  for (const [where, palette] of Object.entries(codeColorPalettes(gameDefinition))) {
    if (palette && !samePalette(normalizeColorPalette(palette), option.choices)) {
      throw new Error(
        `Your gameDefinition declares ${where} in code, but the live lobby uses ${source} ` +
          `(${option.choices.map((c) => c.label).join(', ')}), so dev would show colours players never get. ` +
          `Declare the palette in boardsmith.json's "colorPalette", or remove ${where} from your gameDefinition.`,
      );
    }
  }
  return option;
}

/**
 * The player options dev offers: the game's merged code and boardsmith.json
 * options, which the published manifest carries too (#992), and the colour
 * option, which the live lobby builds from the same `colorPalette`.
 */
export function resolveDevPlayerOptions(
  gameDefinition: Pick<GameDefinition, 'playerOptions' | 'colorPalette'>,
  config: { playerOptions?: unknown; colorPalette?: Array<string | Record<string, unknown>> },
): Record<string, PlayerOptionDefinition> & { color: ColorOptionDefinition } {
  return {
    ...mergePlayerOptions(gameDefinition.playerOptions, config.playerOptions),
    color: resolveColorOption(gameDefinition, config),
  };
}

/** The colour lists a game declares in code, by where it declares them. */
function codeColorPalettes(gameDefinition: Pick<GameDefinition, 'playerOptions' | 'colorPalette'>) {
  const declared = gameDefinition.playerOptions?.color;
  // A `color` option that is not a colour list (or has no choices) can never match, so it is refused too.
  const choices = declared?.type === 'color' ? declared.choices : undefined;
  return { 'playerOptions.color': declared && (choices ?? []), colorPalette: gameDefinition.colorPalette };
}

function samePalette(a: ColorChoice[], b: ColorChoice[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => c.value.toLowerCase() === b[i]!.value.toLowerCase() && c.label === b[i]!.label)
  );
}

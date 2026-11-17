/**
 * The verdict of an in-browser smoke walk (#453): what it saw, and the problems that fail it.
 *
 * Kept apart from `browser-smoke.ts`, which drives Chromium under Playwright, so the verdict is
 * decided by plain code a vitest test can hold to its wording.
 */
import { rulesErrorSentence } from '../engine/action/rules-error.js';
import { PageFrozen } from './browser-smoke-clock.js';
import { parsePositiveWholeNumber } from '../utils/positive-whole-number.js';

/** Where a game keeps its smoke test. `boardsmith init` writes it and `boardsmith verify` runs it. */
export const SMOKE_SPEC_PATH = 'tests/browser/smoke.spec.ts';

/**
 * The annotation a passing walk leaves on its test, which `boardsmith verify` reads to say what it
 * did: a {@link SmokeRecord}, as JSON.
 */
export const SMOKE_ANNOTATION = 'boardsmith-smoke';

/** The fewest words a declared action's reason may have: a sentence, not a label. */
const REASON_MIN_WORDS = 4;

/**
 * The seed a table's walk deals from when the spec names none (#460), so every run walks the same
 * game and any failure can be walked again with `boardsmith smoke`.
 */
export const DEFAULT_SMOKE_SEED = 'smoke';

/**
 * The environment variable `boardsmith smoke --seed` hands the walk its deals in, as a JSON list,
 * so a run can deal any game again without editing the spec.
 */
export const SMOKE_SEEDS_ENV = 'BOARDSMITH_SMOKE_SEEDS';

/**
 * A game a table's walk deals (#1602): a seed, dealt at the game's `minPlayers`, as `boardsmith dev`
 * starts, or a seed and how many players sit at it.
 */
export type SmokeDeal = string | { readonly seed: string; readonly players: number };

/** "seed "a"", or "seed "a" at 3 players" for a deal that names its player count. */
const dealName = (deal: SmokeDeal) => (typeof deal === 'string' ? `seed "${deal}"` : `seed "${deal.seed}" at ${deal.players} players`);

/**
 * The deals a walk deals, in order: the seeds `boardsmith smoke --seed` names (`chosen`), else the
 * spec's `seed`, one deal or a list of them, else {@link DEFAULT_SMOKE_SEED}. Throws, saying what to
 * write instead, on an empty list, a blank seed, a player count that is not one, or a deal listed twice.
 */
export function smokeSeeds(seed: SmokeDeal | readonly SmokeDeal[] | undefined, chosen?: readonly SmokeDeal[]): SmokeDeal[] {
  if (chosen !== undefined) return checkedSeeds([...chosen], '`boardsmith smoke --seed`');
  return checkedSeeds(seed === undefined ? [DEFAULT_SMOKE_SEED] : Array.isArray(seed) ? [...seed] : [seed as SmokeDeal], `\`seed\` in ${SMOKE_SPEC_PATH}`);
}

/** `deals`, which `from` gave, once none has a blank seed or a count that is not one, none is listed twice, and there is one at least. */
function checkedSeeds(deals: SmokeDeal[], from: string): SmokeDeal[] {
  if (deals.length === 0) {
    throw new Error(
      `${from} is an empty list, so the walk would deal no game. List at least one seed, or leave ` +
        `\`seed\` out to deal from "${DEFAULT_SMOKE_SEED}".`,
    );
  }
  if (deals.some((deal) => dealSeed(deal).trim() === '')) {
    throw new Error(`${from} has a blank seed. A seed is any text that is not blank, such as "7" or "opening".`);
  }
  const notACount = deals.find((deal) => typeof deal !== 'string' && !(Number.isInteger(deal.players) && deal.players >= 1));
  if (typeof notACount === 'object') {
    throw new Error(
      `${from} deals "${notACount.seed}" at ${notACount.players} players, which is not a number of players. Name how many players sit at the deal, such as 3.`,
    );
  }
  const names = deals.map(dealName);
  const twice = deals.find((_, i) => names.indexOf(names[i]) !== i);
  if (twice !== undefined) {
    const what = typeof twice === 'string' ? `"${twice}"` : `"${twice.seed}" at ${twice.players} players`;
    throw new Error(`${from} lists ${what} twice, which walks the same deal twice. List each ${typeof twice === 'string' ? 'seed' : 'deal'} once.`);
  }
  return deals;
}

/** The seed `deal` is dealt from. */
export const dealSeed = (deal: SmokeDeal) => (typeof deal === 'string' ? deal : deal.seed);

/**
 * How many players sit at `deal`, at a game that `seats` from `min` to `max` (#1602): the count it
 * names, else `min`, as `boardsmith dev` starts. Throws, saying what to write instead, on a count
 * the game does not seat.
 */
export function smokeDealPlayers(deal: SmokeDeal, seats: { min: number; max: number }): number {
  if (typeof deal === 'string') return seats.min;
  if (deal.players >= seats.min && deal.players <= seats.max) return deal.players;
  throw new Error(
    `The deal of seed "${deal.seed}" at ${deal.players} players cannot be dealt: this game seats ${seats.min} to ${seats.max}. ` +
      `Choose a count from ${seats.min} to ${seats.max}.`,
  );
}

/** The spec's `actions`, once none is blank or listed twice (#926). */
export function smokeActions(actions: readonly string[]): string[] {
  const from = `\`actions\` in ${SMOKE_SPEC_PATH}`;
  if (actions.some((name) => name.trim() === '')) throw new Error(`${from} has a blank name. Name each action as its rules do, such as "greet".`);
  const twice = actions.find((name, i) => actions.indexOf(name) !== i);
  if (twice !== undefined) throw new Error(`${from} lists "${twice}" twice. List each action once.`);
  return [...actions];
}

/**
 * The world seats a walk plays (#471), in order: `seats` in the spec, a count of the first seats the
 * world gives (1, 2...) or a list naming them, so a spec can choose seats the world brings together.
 * Undefined when the spec names none: the walk plays the one seat the world gives its page. Throws,
 * saying what to write instead, on a count or seat that is not a whole number from 1, an empty list
 * or a seat listed twice.
 */
export function smokeWorldSeats(seats: number | readonly number[] | undefined): number[] | undefined {
  if (seats === undefined) return undefined;
  const from = `\`seats\` in ${SMOKE_SPEC_PATH}`;
  if (typeof seats === 'number') {
    if (!Number.isInteger(seats) || seats < 1) {
      throw new Error(
        `${from} is ${seats}, which is not a number of seats. Give how many seats the walk plays, such as 2, or list them, such as [1, 4].`,
      );
    }
    return Array.from({ length: seats }, (_, i) => i + 1);
  }
  if (seats.length === 0) throw new Error(`${from} is an empty list, so the walk would play no seat. List at least one, or leave \`seats\` out to play one.`);
  const notASeat = seats.find((seat) => !Number.isInteger(seat) || seat < 1);
  if (notASeat !== undefined) throw new Error(`${from} lists ${notASeat}, which is not a seat. Seats are numbered from 1.`);
  const twice = seats.find((seat, i) => seats.indexOf(seat) !== i);
  if (twice !== undefined) throw new Error(`${from} lists seat ${twice} twice. List each seat once.`);
  return [...seats];
}

/** What every walk gets, whatever its size: the 600 s the whole run had before it grew with the walk. */
const WALK_BASE_MS = 600_000;

/** What each seat gets on each deal besides its steps: to load and seat it, deal, and settle at the end. */
const WALK_DEAL_MS = 90_000;

/** What each seat gets for each step it may take: some 15 times what a step of a heavy game takes. */
const WALK_STEP_MS = 10_000;

/** The longest delay a timer can wait: Node fires a longer one at once. */
const LONGEST_TIMER_MS = 2_147_483_647;

/**
 * The longest a walk of `deals` deals of at most `steps` steps each, played by the world `seats` the
 * spec names (one seat at a table, which names none), may run before Playwright ends it (#1601). A hang
 * guard sized to the walk the spec asks for; the walk's own checks catch a stuck game sooner.
 */
export function smokeWalkLimit(deals: number, steps: number, seats: readonly number[] | undefined): number {
  const played = deals * (seats?.length ?? 1);
  return Math.min(LONGEST_TIMER_MS, WALK_BASE_MS + played * (WALK_DEAL_MS + steps * WALK_STEP_MS));
}

/** The spec's `steps`, once it is a positive whole number: with none, the walk takes no step and passes any game that loads (#924). */
export function smokeSteps(steps: number): number {
  return parsePositiveWholeNumber(`\`steps\` in ${SMOKE_SPEC_PATH}`, String(steps));
}

/** Where a walk stopped because no seat was offered anything for `seconds`. */
interface SmokeStall {
  /** The step it stopped at, counted within its deal. */
  readonly step: number;
  /** The seed the game it stopped in was dealt from; null in a world, which `boardsmith dev` deals itself. */
  readonly seed: string | null;
  readonly seconds: number;
}

/**
 * What a function in a spec's `inputs` may read of the page while the walk answers a field (#470):
 * what a player sees there, and nothing it could press.
 */
export interface SmokeInputView {
  /**
   * The text of each visible element `selector` matches in the game's frame, in page order, as a
   * player reads it: whitespace collapsed, blank ones left out.
   */
  texts(selector: string): Promise<string[]>;
  /**
   * The other seats the walk plays in a world (`seats`, #471), so an input can name a player standing
   * with this one, as a friend playing alongside knows their name. Empty at a table, and in a world
   * walked from one seat.
   */
  readonly otherSeats: readonly number[];
  /**
   * The seed of the deal being walked, one of the spec's `seed` (#1598), so an input can choose
   * differently in each deal, as a choice that decides which actions a game offers needs. Null in a
   * world, which `boardsmith dev` deals itself.
   */
  readonly seed: string | null;
}

/**
 * The value the walk types in one text or number field (#470), or the label of the choice it
 * presses for a pick of choices (#1598): the text or number itself, or a function of what the page shows, for a value only known once the game is under way (the name of
 * a player standing in the same square). The function returns nothing when the page gives no value
 * yet; the walk then cancels the action and takes it again once it gives one, or once the game has
 * moved on. The walk may ask it before opening the action as well as when typing (#471), so it only
 * reads the page. A list of values for a text or number field is tried in order, the next one each
 * time the game refuses the action, for a value whose legality depends on the whole position (#1663),
 * and a function may return one, to read the position and still have values tried in turn (#1682).
 */
export type SmokeInput = SmokeValue | ((view: SmokeInputView) => SmokeValue | undefined | Promise<SmokeValue | undefined>);

/** A value a spec's input gives: the text or number to type, or a list of them to try in turn (#1663). */
type SmokeValue = string | number | readonly (string | number)[];

/** The spec's `inputs`: for each action, by the name its rules give it, the value for each of its fields, by pick name. */
export type SmokeInputs = Readonly<Record<string, Readonly<Record<string, SmokeInput>>>>;

/** The kinds of field a spec's `inputs` answer: the panel's text editor, its number editor, and a pick of choices. */
type FieldKind = 'text' | 'number' | 'choice';

/**
 * What the walk typed in one field of an action, and whether the spec's `inputs` gave it, with the
 * values that input gave to try in turn (#1663, #1682), or the walk chose it.
 */
export type TypedValue = { readonly field: string; readonly value: string; readonly kind: FieldKind } & (
  | { readonly from: 'inputs'; readonly values: readonly string[] }
  | { readonly from: 'walk' }
);

/** A value to type from the spec's `inputs`, of the `values` its input gives to try in turn. */
type GivenValue = { readonly value: string; readonly values: readonly string[] };

/** How a spec's `inputs` answer one field: a value to type, none yet, or a problem with the spec's function. */
type InputAnswer = GivenValue | { readonly wanting: true } | { readonly problem: string };

/** How a message names one input in the spec: `inputs.attack.target`. */
const inputName = (action: string, field: string) => `\`inputs.${action}.${field}\``;

/**
 * What the spec's `inputs` give for `field` of `action`, a field of `kind`, reading `view` when the
 * input is a function: undefined when the spec gives nothing for that field, so the walk types its
 * own value. Of a list, given or returned by the function (#1682), the value after the `refused` ones
 * the game refused (#1663). A value for a number field that is not a number is a problem with the spec.
 */
export async function inputFor(
  inputs: SmokeInputs,
  action: string,
  field: string,
  kind: FieldKind,
  view: SmokeInputView,
  refused: number,
): Promise<InputAnswer | undefined> {
  if (!Object.hasOwn(inputs, action) || !Object.hasOwn(inputs[action], field)) return undefined;
  const input = inputs[action][field];
  let given: SmokeValue | undefined;
  try {
    given = typeof input === 'function' ? await input(view) : input;
  } catch (error) {
    // The page stopped answering while the function read it (#618): that ends the walk, as any such read does.
    if (error instanceof PageFrozen) throw error;
    const said = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { problem: `${inputName(action, field)} in ${SMOKE_SPEC_PATH} failed while the walk answered "${action}": ${said}` };
  }
  return Array.isArray(given) ? listAnswer(given, refused, kind, action, field) : oneAnswer(String(given ?? ''), kind, action, field);
}

/** How the text of the one value an input gave answers a field of `kind`: the only value to try. */
function oneAnswer(text: string, kind: FieldKind, action: string, field: string): InputAnswer {
  const answer = answerOf(text, kind, action, field);
  return 'value' in answer ? { ...answer, values: [answer.value] } : answer;
}

/** Which value of the list `values` answers a field of `kind` once the game refused `refused` of them: a longer list in another field of the action may outlast it, leaving it at its last. */
function listAnswer(values: readonly (string | number)[], refused: number, kind: FieldKind, action: string, field: string): InputAnswer {
  if (kind === 'choice') {
    return { problem: `${inputName(action, field)} in ${SMOKE_SPEC_PATH} gives a list for a pick of choices. Give the one label to press, or choose by \`seed\` with a function.` };
  }
  if (values.length === 0) {
    return { problem: `${inputName(action, field)} in ${SMOKE_SPEC_PATH} gives an empty list. Give the values to try, in order, such as [-1, 1, -2, 2].` };
  }
  if (values.some((value) => String(value).trim() === '')) {
    return {
      problem: `${inputName(action, field)} in ${SMOKE_SPEC_PATH} gives a blank value in its list, so the walk would type nothing there. Give the text a player types in that field.`,
    };
  }
  const texts: string[] = [];
  for (const value of values) {
    const answer = answerOf(String(value), kind, action, field);
    if (!('value' in answer)) return answer;
    texts.push(answer.value);
  }
  return { value: texts[Math.min(refused, texts.length - 1)], values: texts };
}

/**
 * What the walk types in `field` of `action` from the spec's `given` value. When the game refused
 * values of another list there, the function read a new position, so the walk forgets the seat's
 * refusals in the action and types the first of this one (#1682).
 */
export function typedFrom(given: GivenValue, attempts: SeatAttempts, action: string, field: string, kind: FieldKind): TypedValue {
  const refusedList = attempts.refusedLists.get(action)?.get(field);
  if (refusedList === undefined || refusedList === listKey(given.values)) return { field, value: given.value, from: 'inputs', values: given.values, kind };
  forgetRefusals(attempts, action);
  return { field, value: given.values[0], from: 'inputs', values: given.values, kind };
}

/** How a list of values is told apart from another. */
const listKey = (values: readonly string[]) => JSON.stringify(values);

/** Forgets the values the game refused in `action` in the seat whose `attempts` they are. */
function forgetRefusals(attempts: SeatAttempts, action: string): void {
  attempts.refused.delete(action);
  attempts.refusedLists.delete(action);
}

/** How the text an input gave answers a field of `kind`: none yet when blank, and a problem when a number field's is not a number. */
function answerOf(text: string, kind: FieldKind, action: string, field: string): { readonly value: string } | { readonly wanting: true } | { readonly problem: string } {
  if (text.trim() === '') return { wanting: true };
  if (kind !== 'number') return { value: text };
  if (!Number.isFinite(Number(text))) {
    return { problem: `${inputName(action, field)} in ${SMOKE_SPEC_PATH} gives "${text}" for a number field. Give a number, such as 7.` };
  }
  return { value: text.trim() };
}

/** Why the walk cannot press the choice `value` that `field` of `action` gives: the pick offers no choice labelled so, only `offered`. */
export function choiceNotOffered(action: string, field: string, value: string, offered: readonly string[]): string {
  return (
    `${inputName(action, field)} in ${SMOKE_SPEC_PATH} gives "${value}", but the pick offers no choice labelled that: ` +
    `it offers ${offered.length === 0 ? 'none' : quoted(offered)}. Give the label of a choice as the panel shows it, and one in a ` +
    'category by its path, such as "Sheriffs / Hale".'
  );
}

/**
 * Whether the action `name` is ready to take because the page gives a value now (#471): it has an
 * input that reads the page, and every such input gives one, read as a number for a field the walk
 * has met as a number field. What such an input reads, such as another player standing here, may be
 * gone a few steps on, so the walk takes the action before anything else.
 */
export async function readyToTake(walk: SmokeWalk, name: string, view: SmokeInputView): Promise<boolean> {
  if (!Object.hasOwn(walk.inputs, name)) return false;
  const reads = Object.keys(walk.inputs[name]).filter((field) => typeof walk.inputs[name][field] === 'function');
  if (reads.length === 0) return false;
  const kinds = walk.fieldsMet.get(name);
  const given = await Promise.all(reads.map((field) => inputFor(walk.inputs, name, field, kinds?.get(field) ?? 'text', view, 0)));
  return given.every((answer) => answer !== undefined && 'value' in answer);
}

/**
 * Records the reasons the panel gave for the actions it showed greyed out (#472): each once, the one
 * given most recently moved last, so a report quoting the latest few quotes the current ones.
 */
export function recordGreyed(walk: SmokeWalk, greyed: ReadonlyArray<readonly [string, string | undefined]>): void {
  for (const [name, reason] of greyed) {
    if (reason === undefined) continue;
    walk.greyed.set(name, [...(walk.greyed.get(name) ?? []).filter((given) => given !== reason), reason]);
  }
}

/**
 * Why the walk reports that taking `action` failed: what the game said, how many numbers it refused
 * when it refused each one the walk tried (`refused` before the last), and what the walk typed, so a
 * refused value from the spec's `inputs` is named as such and one the walk chose says how to give
 * the game the value it needs (#470), unless the rules crashed (`rulesErrorSentence`).
 */
export function actionFailed(action: string, error: string | undefined, typed: readonly TypedValue[], refused: number): string {
  const each = refused > 0 ? ` The game refused each of the ${refused + 1} values the walk entered.` : '';
  const said = typed.map(({ field, value, from }) =>
    from === 'inputs'
      ? ` The walk typed "${value}" in its field "${field}", as ${inputName(action, field)} in ${SMOKE_SPEC_PATH} gives it.`
      : ` The walk typed "${value}" in its field "${field}".`,
  );
  // A crash in the rules is not the game asking for another value, so it gets no hint to give one.
  const crashed = error?.startsWith(rulesErrorSentence(action)) ?? false;
  const hint = !crashed && typed.some(({ from }) => from === 'walk')
    ? ` If the game needs a particular value there, such as a name the board shows, give it in \`inputs\` in ${SMOKE_SPEC_PATH}.`
    : '';
  return `The panel offered "${action}", and taking it failed: ${error ?? 'no reason given'}${each}${said.join('')}${hint}`;
}

/** What a walk saw. */
export interface SmokeWalk {
  /** The actions the spec lists. */
  readonly listed: readonly string[];
  /**
   * The listed actions the spec says no walk from a fresh game reaches, each with the reason. The
   * walk does not require one unless it sees it enabled: then it is required like any other, so a
   * declaration cannot hide an action that is offered and does nothing.
   */
  readonly unreachable: Readonly<Record<string, string>>;
  /** Every action the panel offered, whether or not it could be taken. */
  readonly offered: Set<string>;
  /** Every action the panel offered enabled (not greyed out), opened, or resolved. */
  readonly enabled: Set<string>;
  /** Every action taken and resolved without failing. */
  readonly taken: Set<string>;
  /** The most actions the walk would take on each deal. */
  readonly steps: number;
  /** Every error the page showed, in the order it showed them. */
  readonly errors: string[];
  /** The spec's deals, in order (#460, #1602); none in a world. */
  readonly seeds: SmokeDeal[];
  /** Every deal the walk stopped early because no seat was offered anything. */
  readonly stalls: SmokeStall[];
  /** The values the spec gives the walk to type, by action and field (#470). */
  readonly inputs: SmokeInputs;
  /**
   * The actions the walk cancelled because the spec's `inputs` gave no value for a field yet, with
   * that field; an action leaves it once taken.
   */
  readonly wanting: Map<string, string>;
  /**
   * The fields the walk met in each action it opened, by pick name, with the kind of each (#470), so
   * an input naming a field none of them has (a misspelt pick name) is reported once the walk met any
   * of the action's fields or took it, and an input for a number field is read as a number before
   * the action is opened (`readyToTake`).
   */
  readonly fieldsMet: Map<string, Map<string, FieldKind>>;
  /**
   * The reasons the panel gave for each action it showed greyed out (#472), each once, the one it
   * gave most recently last (`recordGreyed`), so an action never seen ready to take is reported with
   * them.
   */
  readonly greyed: Map<string, string[]>;
  /** The world seats the walk played, when the spec named them (#471); none at a table. */
  readonly seats: number[];
}

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(', ');

/** "1 and 4", or "2, 7 and 9". */
const listed = (items: readonly (string | number)[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** Records a problem on the walk, once. */
export function note(walk: SmokeWalk, problem: string): void {
  if (!walk.errors.includes(problem)) walk.errors.push(problem);
}

/** What the page's `boardsmith:action-resolved` events carry, in every frame. */
export interface ResolvedAction {
  readonly action: string;
  readonly success: boolean;
  readonly error?: string;
}

/**
 * The problem it is when the things the board marks selected (`board`, `data-bs-selected`) are not
 * the Action Panel's selection (`panel`), said with `after`, the press that led there; undefined when
 * they agree, or the board marks nothing, as a board drawing no selection does (#1642).
 */
export function selectionsDiffer(board: readonly string[], panel: string | null, after: string): string | undefined {
  // A board may draw its one selected thing in several places.
  const marked = [...new Set(board)];
  if (marked.length === 0 || (marked.length === 1 && marked[0] === panel)) return undefined;
  return (
    `The board showed ${quoted(marked)} selected while the Action Panel had ${panel === null ? 'nothing' : `"${panel}"`} selected, ${after}. ` +
    'The board and the panel show one shared selection: select a thing with actionController.select(), and mark the thing ' +
    'actionController.selection names with selectedAttrs().'
  );
}

/** What the walk remembers of a deal that recording a resolved action reads and writes (#466). */
export interface ResolvedMemory {
  /** How many times each action was taken and resolved. */
  readonly resolved: Map<string, number>;
  /** The action resolved last, which a game that is now over ended on. */
  lastResolved: string | undefined;
  /** The actions that failed when taken: reported once, and not tried again while anything else is offered. */
  readonly failed: Set<string>;
  /** What the game said when it refused a value the walk had another to try for, which its error toasts repeat. */
  readonly refusals: Set<string>;
  /** How many actions have been taken on this deal, so the walk knows when the game has moved on (#470). */
  moves: number;
}

/** What the walk typed in the actions of one seat it plays, and the values the game refused there: each seat tries every value from its own position (#1677). */
export interface SeatAttempts {
  /** How many values the game's own rules have refused in each action since the seat last took it or put it off, so the walk types the next number up, or a list's next value (#923, #1663). */
  readonly refused: Map<string, number>;
  /** The lists of the spec's `inputs` whose values the game refused, by action and then field, so a different list, read from a new position, starts from its first value (#1682). */
  readonly refusedLists: Map<string, Map<string, string>>;
  /** What the walk typed in each action's fields on its last attempt at it (#470), for the report if the game refuses it. */
  readonly typed: Map<string, TypedValue[]>;
}

/** How many numbers the walk enters in an action whose game refuses them, before it reports the action (#466). */
const NUMBER_TRIES = 3;

/**
 * Records the actions the page resolved since the walk last looked, in the seat whose `attempts`
 * they are: a taken one is offered, enabled and taken, and the deal remembers it; a failed one is
 * reported and not tried again, unless the game refused a value it has another to try for
 * (`refusedAValue`). What the walk typed is spent either way, so a later failure of the action is
 * never taken for a refusal of a number it did not type, and a failure is reported with it
 * (`actionFailed`, #470), after `where`, the browser it was taken in when a world walk plays several
 * seats (#471). Either way the action no longer waits on an input, and a taken one counts as the game
 * moving on.
 */
export function recordResolved(resolved: readonly ResolvedAction[], walk: SmokeWalk, memory: ResolvedMemory, attempts: SeatAttempts, where = ''): void {
  for (const { action, success, error } of resolved) {
    walk.offered.add(action);
    walk.enabled.add(action);
    walk.wanting.delete(action);
    const typed = attempts.typed.get(action) ?? [];
    attempts.typed.delete(action);
    if (success) {
      memory.moves++;
      forgetRefusals(attempts, action);
      walk.taken.add(action);
      memory.resolved.set(action, (memory.resolved.get(action) ?? 0) + 1);
      memory.lastResolved = action;
    } else if (!refusedAValue(action, error, typed, memory, attempts)) {
      memory.failed.add(action);
      note(walk, `${where}${actionFailed(action, error, typed, attempts.refused.get(action) ?? 0)}`);
    }
  }
}

/**
 * Records that the walk put `action` off because the spec's `inputs` give no value for its `field`
 * yet (#470): it waits on that input, and every seat's values refused in it are forgotten, since no
 * seat takes it again until the game has moved on, where the first may be legal (#1677).
 */
export function recordPutOff(walk: SmokeWalk, seats: Iterable<SeatAttempts>, action: string, field: string): void {
  walk.wanting.set(action, field);
  for (const attempts of seats) forgetRefusals(attempts, action);
}

/**
 * Whether `action` failed because the game's own rules refused a value it has another to try for:
 * a number the walk chose and typed in one of its fields (`typed`), with tries left, or a value from
 * a list in the spec's `inputs` with values left (#1663, #1682); a single value from `inputs` is the spec's
 * answer, never moved up (#470). Then the walk takes it again with the next value, and the
 * refusal, and the error toast that repeats it, are the game working, not a problem (#466). A failure
 * the engine words as an error in the game's rules (`rulesErrorSentence`) is a crash, never a
 * refusal, whatever the walk typed.
 */
function refusedAValue(
  action: string,
  error: string | undefined,
  typed: readonly TypedValue[],
  memory: ResolvedMemory,
  attempts: SeatAttempts,
): boolean {
  const refused = attempts.refused.get(action) ?? 0;
  const tries = Math.max(
    typed.some(({ from, kind }) => from === 'walk' && kind === 'number') ? NUMBER_TRIES : 1,
    ...typed.map((t) => (t.from === 'inputs' ? t.values.length : 1)),
  );
  if (refused >= tries - 1) return false;
  if (error === undefined || error.startsWith(rulesErrorSentence(action))) return false;
  attempts.refused.set(action, refused + 1);
  const lists = new Map<string, string>();
  for (const t of typed) if (t.from === 'inputs') lists.set(t.field, listKey(t.values));
  attempts.refusedLists.set(action, lists);
  memory.refusals.add(error);
  return true;
}

/** "dealt from seed "a", then from seed "b" at 3 players", or the empty string for a world, which names no seed. */
function dealtFrom(seeds: readonly SmokeDeal[], then = 'then'): string {
  return seeds.length === 0 ? '' : `dealt from ${seeds.map(dealName).join(`, ${then} from `)}`;
}

/** Whether a walk was dealt at a table: a world's is dealt by `boardsmith dev`, and names no seed. */
const atATable = (walk: SmokeWalk) => walk.seeds.length > 0;

/** The stall that ended a table walk (#473): a table game offering no seat anything while it is not over has hung. */
const tableStall = (walk: SmokeWalk) => walk.stalls.find((stall) => stall.seed !== null);

/** Why a table game that stalled fails the walk (#473), whether or not listed actions remain. */
function stalled(stall: SmokeStall): string {
  return (
    `The game stalled at step ${stall.step} of the game dealt from seed "${stall.seed}": no seat was offered anything for ` +
    `${stall.seconds}s, and the game was not over, so the players at that table could never finish it. Run \`boardsmith ` +
    'smoke` to watch where the game stops offering actions: a step no seat can act in, or one waiting on something no player does.'
  );
}

/**
 * What to do about a listed action the walk could not take, after `opening` (which says why): more
 * steps, a seed whose deal brings it about, at a table, a second seat in a world walked from one, or
 * naming it in `unreachable`. `bringsIt` says what a deal does for it ("offers it").
 */
function whatToDo(walk: SmokeWalk, opening: string, gettingThere: string, bringsIt: string): string {
  const chooseASeed = atATable(walk)
    ? ` If the deal decides ${bringsIt === 'offers it' ? 'whether it is offered' : 'it'} (the cards a player is dealt, say), ` +
      `choose a seed whose deal ${bringsIt}, and list it in \`seed\` there.`
    : '';
  const secondSeat =
    !atATable(walk) && walk.seats.length < 2
      ? ' If it needs another player there too, list the seats the walk plays in `seats` there, choosing seats the world brings together.'
      : '';
  return (
    `${opening} If a fresh game takes longer to ${gettingThere}, raise \`steps\` in ${SMOKE_SPEC_PATH}.${chooseASeed}${secondSeat} ` +
    `If no walk from a fresh game can reach it ${atATable(walk) ? 'whatever the deal ' : ''}(it needs a long game, or a position ` +
    'play does not get to), name it in `unreachable` there with the reason.'
  );
}

/** "in 12 steps from a fresh game dealt from seed "a"", or with no seed for a world. */
function freshGames(walk: SmokeWalk): string {
  return `in ${walk.steps} steps from a fresh game${atATable(walk) ? ` ${dealtFrom(walk.seeds, 'nor')}` : ''}`;
}

/** Why the walk never saw a listed action offered, and what to do about it. */
function neverOffered(walk: SmokeWalk, name: string): string {
  if (tableStall(walk) !== undefined) {
    return `The walk never saw "${name}" offered: the game stalled first (above), so more \`steps\` would not help. Fix the stall, then run it again.`;
  }
  const [stall] = walk.stalls;
  if (stall !== undefined) {
    return (
      `The walk never saw "${name}" offered. It stopped at step ${stall.step}, because no seat had been offered anything for ` +
      `${stall.seconds}s, so more \`steps\` would not help. Run \`boardsmith smoke\` to watch where the game stops offering ` +
      'actions: a step no seat can act in, or one waiting on something no player does. Fix that, then run it again.'
    );
  }
  const advice = whatToDo(walk, `The walk never saw "${name}" offered ${freshGames(walk)}.`, 'reach it', 'offers it');
  return `${advice} If the game no longer has it, remove it from \`actions\`.`;
}

/** How many of the reasons the panel gave for a greyed-out action a report quotes: the latest. */
const GREYED_REASONS = 3;

/**
 * Why the walk never took a listed action the panel only ever showed greyed out (#472): the reasons
 * the panel gave, and what to do about it.
 */
function onlyGreyed(walk: SmokeWalk, name: string): string {
  const reasons = walk.greyed.get(name) ?? [];
  const latest = reasons.slice(-GREYED_REASONS).map((reason) => `"${reason}"`);
  const more = reasons.length > GREYED_REASONS ? ` (and ${reasons.length - GREYED_REASONS} more)` : '';
  const said =
    reasons.length === 0
      ? 'The panel gave no reason.'
      : reasons.length === 1
        ? `The panel said why: ${latest[0]}`
        : `The panel gave these reasons, the latest last: ${latest.join('; ')}${more}`;
  const opening = `The panel offered "${name}" only greyed out ${freshGames(walk)}, so the walk could never take it. ${said}`;
  return whatToDo(walk, opening, 'get past that', 'lets a player take it');
}

/** Whether the spec declares `name` out of reach and the walk never saw it enabled, so it is not required. */
function excused(walk: SmokeWalk, name: string): boolean {
  return Object.hasOwn(walk.unreachable, name) && !walk.enabled.has(name);
}

/**
 * The listed actions the walk must take and has not: every one except an action the spec names in
 * `unreachable` that the walk never saw enabled.
 */
function requiredUntaken(walk: SmokeWalk): string[] {
  return walk.listed.filter((name) => !walk.taken.has(name) && !excused(walk, name));
}

/** Why the spec's `inputs` cannot stand: one names no listed action, or gives blank text. */
function inputProblems(walk: SmokeWalk): string[] {
  const problems: string[] = [];
  for (const [action, fields] of Object.entries(walk.inputs)) {
    if (!walk.listed.includes(action)) {
      problems.push(
        `${SMOKE_SPEC_PATH} gives \`inputs\` for "${action}", but \`actions\` does not list it. Name the action as \`actions\` ` +
          'does, or remove it from `inputs` if the game no longer has it.',
      );
      continue;
    }
    for (const [field, input] of Object.entries(fields)) {
      const problem = fieldInputProblem(walk, action, field, input);
      if (problem !== undefined) problems.push(problem);
    }
  }
  return problems;
}

/**
 * Why one field's input in the spec cannot stand: it names a field the walk never met in its action
 * (judged only once the walk has seen the action's fields: it met one, or took the action), or it is
 * blank text.
 */
function fieldInputProblem(walk: SmokeWalk, action: string, field: string, input: SmokeInput): string | undefined {
  // An action taken without the walk opening it was taken in one press: it has no fields (#926).
  const met = walk.fieldsMet.get(action) ?? new Map<string, FieldKind>();
  if ((met.size > 0 || walk.taken.has(action)) && !met.has(field)) {
    return (
      `${inputName(action, field)} in ${SMOKE_SPEC_PATH} names a field the walk never met in "${action}", whose fields it ` +
      `met are ${met.size === 0 ? 'none' : quoted([...met.keys()].sort())}. Name the field by the pick name its rules give it.`
    );
  }
  if (typeof input === 'string' && input.trim() === '') {
    return `${inputName(action, field)} in ${SMOKE_SPEC_PATH} is blank, so the walk would type nothing there. Give the text a player types in that field.`;
  }
  return undefined;
}

/** Why the spec's `unreachable` declarations cannot stand: one names no listed action, or gives no reason. */
function declarationProblems(walk: SmokeWalk): string[] {
  const problems: string[] = [];
  if (walk.listed.length > 0 && walk.listed.every((name) => Object.hasOwn(walk.unreachable, name))) {
    problems.push(
      `${SMOKE_SPEC_PATH} names every action in \`actions\` in \`unreachable\`, so the walk would require none of them. ` +
        'A fresh game offers at least the first action a player takes: take the ones a walk reaches out of `unreachable`.',
    );
  }
  for (const [name, reason] of Object.entries(walk.unreachable)) {
    if (!walk.listed.includes(name)) {
      problems.push(
        `${SMOKE_SPEC_PATH} names "${name}" in \`unreachable\`, but \`actions\` does not list it. \`actions\` lists every action ` +
          `the game has; add it there, or remove it from \`unreachable\` if the game no longer has it.`,
      );
    } else if (reason.trim().split(/\s+/).filter(Boolean).length < REASON_MIN_WORDS) {
      problems.push(
        `${SMOKE_SPEC_PATH} names "${name}" in \`unreachable\` without saying why. Write a sentence saying what game state ` +
          'offers it and why a walk from a fresh game does not get there.',
      );
    }
  }
  return problems;
}

/**
 * Why the walk never took the required action `name`: it never saw it offered, saw it only greyed
 * out (#472), cancelled it for want of an input (#470), or saw it ready and still did not take it.
 */
function whyNotTaken(walk: SmokeWalk, name: string): string {
  if (!walk.offered.has(name)) return neverOffered(walk, name);
  if (!walk.enabled.has(name)) return onlyGreyed(walk, name);
  const field = walk.wanting.get(name);
  if (field !== undefined) {
    return (
      `The panel offered "${name}", but the walk never took it in ${walk.steps} steps: when it last opened it, ` +
      `${inputName(name, field)} in ${SMOKE_SPEC_PATH} gave no text for its field "${field}", so the walk cancelled it. ` +
      'Make it return the text a player would type there whenever the game offers the action.'
    );
  }
  return `The panel offered "${name}", but the walk never took it in ${walk.steps} steps. The errors above, if any, say why.`;
}

/** Everything that fails the walk, errors first. An empty list is a pass. */
export function smokeProblems(walk: SmokeWalk): string[] {
  const problems = [...walk.errors, ...declarationProblems(walk), ...inputProblems(walk)];
  const stall = tableStall(walk);
  if (stall !== undefined) problems.push(stalled(stall));
  const unlisted = [...walk.offered].filter((name) => !walk.listed.includes(name)).sort();
  if (unlisted.length > 0) {
    problems.push(
      `The game offered ${quoted(unlisted)}, which ${SMOKE_SPEC_PATH} does not list. ` +
        `Add ${unlisted.length === 1 ? 'it' : 'them'} to \`actions\` there.`,
    );
  }
  for (const name of requiredUntaken(walk)) problems.push(whyNotTaken(walk, name));
  return problems;
}

/**
 * What a walk that found `problems` fails with: the seeds it was dealt from first, so the failure
 * can be walked again exactly with `boardsmith smoke`, then each problem on its own line.
 */
export function smokeFailure(walk: SmokeWalk, problems: readonly string[]): string {
  const dealt = walk.seeds.length === 0 ? '' : `, ${dealtFrom(walk.seeds)},`;
  const found = problems.length === 1 ? 'a problem' : `${problems.length} problems`;
  return `The smoke walk${dealt} found ${found}:\n${problems.map((p) => `  - ${p}`).join('\n')}`;
}

/** What a passing walk did, as `boardsmith verify` reports it. */
export interface SmokeRecord {
  /** The spec's deals, in order; none in a world. */
  readonly seeds: SmokeDeal[];
  /** The world seats the walk played, when the spec named them (#471); none at a table. */
  readonly seats: number[];
  /** The actions taken, sorted. */
  readonly taken: string[];
  /** How many board controls were pressed. */
  readonly controls: number;
  /** How many games the walk played: it starts a new one when a game ends with listed actions untaken. */
  readonly games: number;
  /** The declared actions the walk neither took nor saw enabled, and so did not require, with the spec's reasons. */
  readonly excused: Array<{ action: string; reason: string }>;
  /** The declared actions the walk took anyway, whose declaration should go. */
  readonly reachedAnyway: string[];
}

/** The record of a walk that pressed `controls` board controls over `games` games. */
export function smokeRecord(walk: SmokeWalk, played: { controls: number; games: number }): SmokeRecord {
  const declared = Object.keys(walk.unreachable).sort();
  return {
    seeds: [...walk.seeds],
    seats: [...walk.seats],
    taken: [...walk.taken].sort(),
    controls: played.controls,
    games: played.games,
    excused: declared
      .filter((name) => !walk.taken.has(name) && excused(walk, name))
      .map((action) => ({ action, reason: walk.unreachable[action].trim() })),
    reachedAnyway: declared.filter((name) => walk.taken.has(name)),
  };
}

/** What `boardsmith verify` says a passing walk did. */
export function smokeSummary(record: SmokeRecord): string {
  const took = record.taken.length === 0 ? 'no action' : quoted(record.taken);
  const pressed = `${record.controls} board control${record.controls === 1 ? '' : 's'}`;
  const deals = Math.max(1, record.seeds.length);
  const games =
    record.games > deals ? `, over ${record.games} games (a new one each time a game ended with listed actions still to take)` : '';
  const dealt = record.seeds.length === 0 ? '' : ` and ${dealtFrom(record.seeds)}`;
  const excusedNote =
    record.excused.length > 0
      ? ` Not required, as ${SMOKE_SPEC_PATH} says a walk from a fresh game cannot reach them: ` +
        `${record.excused.map(({ action, reason }) => `"${action}" ("${reason}")`).join('; ')}.`
      : '';
  const reached =
    record.reachedAnyway.length > 0
      ? ` The walk took ${quoted(record.reachedAnyway)}, which ${SMOKE_SPEC_PATH} says a walk from a fresh game cannot ` +
        `reach: remove ${record.reachedAnyway.length === 1 ? 'it' : 'them'} from \`unreachable\` there, so the walk requires ` +
        `${record.reachedAnyway.length === 1 ? 'it' : 'them'}.`
      : '';
  return `Served by \`boardsmith dev\` from a fresh start${dealt}, ${whoPlayed(record)} took ${took} and pressed ${pressed}, with no error${games}.${excusedNote}${reached}`;
}

/** Who a passing walk played as: the world seats it played (#471), or one seated player. */
function whoPlayed(record: SmokeRecord): string {
  return record.seats.length > 1 ? `players at seats ${listed(record.seats)}` : 'a seated player';
}

/** How many presses one open action may take before the walk gives up on it (#463). */
export const MOST_ANSWERS = 50;

/** How many presses in a row may leave an open action's panel unchanged before the walk gives up on it. */
const STUCK_AFTER = 3;

/** What answering one open action has pressed and shown so far (#463). */
interface AnswerTrail {
  readonly name: string;
  /** Where the walk is, as a message says it: "at step 7 of the game dealt from seed "smoke"". */
  readonly where: string;
  readonly pressed: string[];
  /** Each state its panel showed, with the board picks made by then. */
  readonly shown: Set<string>;
  /** The panel as it was before the last press. */
  before: string;
  /** How many presses in a row left the panel as it was. */
  unchanged: number;
}

/** The trail of answering the open action `name`, whose panel shows `panel`. */
export function startAnswering(name: string, where: string, panel: string): AnswerTrail {
  return { name, where, pressed: [], shown: new Set([`${panel}\u0000`]), before: panel, unchanged: 0 };
}

/**
 * Records that pressing `answer` (undefined: there was nothing to press) left the open action's
 * panel showing `after`, with the board picks `picked` made, and says why the walk gives up on the
 * action, or undefined to go on. It gives up when there was nothing to press, when
 * {@link STUCK_AFTER} presses in a row changed nothing, when the panel comes back to a state it
 * showed before with the same picks (the walk answers a state the same way each time, so it would
 * go round that loop for ever), and after {@link MOST_ANSWERS} presses.
 */
export function answered(trail: AnswerTrail, answer: string | undefined, after: string, picked: readonly string[]): string | undefined {
  const { name, where } = trail;
  if (answer === undefined) return `The panel opened "${name}" ${where} and offered nothing to choose or press: ${after}`;
  trail.pressed.push(answer);
  trail.unchanged = after === trail.before ? trail.unchanged + 1 : 0;
  if (trail.unchanged >= STUCK_AFTER) return `The panel opened "${name}" ${where}, and pressing its choices changed nothing: ${after}`;
  const state = `${after}\u0000${[...picked].sort().join('\u0000')}`;
  if (after !== trail.before && trail.shown.has(state)) {
    return (
      `Answering "${name}" ${where} went round in a loop: pressing ${quoted(trail.pressed)} brought its panel back to a ` +
      `state it had shown before ("${after}"), so the action never finishes that way.`
    );
  }
  if (trail.pressed.length >= MOST_ANSWERS) {
    return (
      `Answering "${name}" ${where} took ${MOST_ANSWERS} presses and the action was still open. The last ones: ` +
      `${quoted(trail.pressed.slice(-10))}. Its panel: ${after}`
    );
  }
  trail.shown.add(state);
  trail.before = after;
  return undefined;
}

/**
 * Why the walk could not go on, from what stopped it and, once it was walking, the step and the seed
 * of the game it was at. A Playwright timeout, a page that stopped answering within `waited`
 * seconds, says so (#464).
 */
export function walkStopped(error: unknown, waited: number, at?: { step: number; seed: string | null }): string {
  const where = at === undefined ? '' : ` at step ${at.step}${at.seed === null ? '' : ` of the game dealt from seed "${at.seed}"`}`;
  const said = error instanceof Error ? error.message.split('\n')[0] : String(error);
  const why =
    error instanceof Error && error.name === 'TimeoutError'
      ? `the page did not answer within ${waited}s (${said}). Run \`boardsmith smoke\` to watch that step.`
      : said;
  return `The walk could not go on${where}: ${why}`;
}

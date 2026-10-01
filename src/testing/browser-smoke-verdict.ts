/**
 * The verdict of an in-browser smoke walk (#453): what it saw, and the problems that fail it.
 *
 * Kept apart from `browser-smoke.ts`, which drives Chromium under Playwright, so the verdict is
 * decided by plain code a vitest test can hold to its wording.
 */
import { rulesErrorSentence } from '../engine/action/rules-error.js';

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
 * The environment variable `boardsmith smoke --seed` hands the walk its seeds in, as a JSON list,
 * so a run can deal any game again without editing the spec.
 */
export const SMOKE_SEEDS_ENV = 'BOARDSMITH_SMOKE_SEEDS';

/**
 * The seeds a walk deals from, in order: those `boardsmith smoke --seed` names (`chosen`), else the
 * spec's `seed`, one seed or a list of them, else {@link DEFAULT_SMOKE_SEED}. Throws, saying what to
 * write instead, on an empty list, a blank seed or a seed listed twice.
 */
export function smokeSeeds(seed: string | readonly string[] | undefined, chosen?: readonly string[]): string[] {
  if (chosen !== undefined) return checkedSeeds([...chosen], '`boardsmith smoke --seed`');
  return checkedSeeds(seed === undefined ? [DEFAULT_SMOKE_SEED] : typeof seed === 'string' ? [seed] : [...seed], `\`seed\` in ${SMOKE_SPEC_PATH}`);
}

/** `seeds`, which `from` gave, once none is blank or listed twice and there is one at least. */
function checkedSeeds(seeds: string[], from: string): string[] {
  if (seeds.length === 0) {
    throw new Error(
      `${from} is an empty list, so the walk would deal no game. List at least one seed, or leave ` +
        `\`seed\` out to deal from "${DEFAULT_SMOKE_SEED}".`,
    );
  }
  if (seeds.some((s) => s.trim() === '')) {
    throw new Error(`${from} has a blank seed. A seed is any text that is not blank, such as "7" or "opening".`);
  }
  const twice = seeds.find((s, i) => seeds.indexOf(s) !== i);
  if (twice !== undefined) {
    throw new Error(`${from} lists "${twice}" twice, which walks the same deal twice. List each seed once.`);
  }
  return seeds;
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
}

/**
 * The value the walk types in one text or number field (#470): the text or number itself, or a
 * function of what the page shows, for a value only known once the game is under way (the name of
 * a player standing in the same square). The function returns nothing when the page gives no value
 * yet; the walk then cancels the action and takes it again once the game has moved on.
 */
export type SmokeInput =
  | string
  | number
  | ((view: SmokeInputView) => string | number | undefined | Promise<string | number | undefined>);

/** The spec's `inputs`: for each action, by the name its rules give it, the value for each of its fields, by pick name. */
export type SmokeInputs = Readonly<Record<string, Readonly<Record<string, SmokeInput>>>>;

/** The two kinds of field the walk types in: the panel's text editor and its number editor. */
type FieldKind = 'text' | 'number';

/** What the walk typed in one field of an action, and whether the spec's `inputs` gave it or the walk chose it. */
export interface TypedValue {
  readonly field: string;
  readonly value: string;
  readonly from: 'inputs' | 'walk';
  readonly kind: FieldKind;
}

/** How a spec's `inputs` answer one field: a value to type, none yet, or a problem with the spec's function. */
type InputAnswer = { readonly value: string } | { readonly wanting: true } | { readonly problem: string };

/** How a message names one input in the spec: `inputs.attack.target`. */
const inputName = (action: string, field: string) => `\`inputs.${action}.${field}\``;

/**
 * What the spec's `inputs` give for `field` of `action`, a field of `kind`, reading `view` when the
 * input is a function: undefined when the spec gives nothing for that field, so the walk types its
 * own value. A value for a number field that is not a number is a problem with the spec.
 */
export async function inputFor(
  inputs: SmokeInputs,
  action: string,
  field: string,
  kind: FieldKind,
  view: SmokeInputView,
): Promise<InputAnswer | undefined> {
  if (!Object.hasOwn(inputs, action) || !Object.hasOwn(inputs[action], field)) return undefined;
  const input = inputs[action][field];
  try {
    return answerOf(String((typeof input === 'function' ? await input(view) : input) ?? ''), kind, action, field);
  } catch (error) {
    const said = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { problem: `${inputName(action, field)} in ${SMOKE_SPEC_PATH} failed while the walk answered "${action}": ${said}` };
  }
}

/** How the text an input gave answers a field of `kind`: none yet when blank, and a problem when a number field's is not a number. */
function answerOf(text: string, kind: FieldKind, action: string, field: string): InputAnswer {
  if (text.trim() === '') return { wanting: true };
  if (kind === 'text') return { value: text };
  if (!Number.isFinite(Number(text))) {
    return { problem: `${inputName(action, field)} in ${SMOKE_SPEC_PATH} gives "${text}" for a number field. Give a number, such as 7.` };
  }
  return { value: text.trim() };
}

/**
 * Why the walk reports that taking `action` failed: what the game said, how many numbers it refused
 * when it refused each one the walk tried (`refused` before the last), and what the walk typed, so a
 * refused value from the spec's `inputs` is named as such and one the walk chose says how to give
 * the game the value it needs (#470), unless the rules crashed (`rulesErrorSentence`).
 */
export function actionFailed(action: string, error: string | undefined, typed: readonly TypedValue[], refused: number): string {
  const each = refused > 0 ? ` The game refused each of the ${refused + 1} numbers the walk entered.` : '';
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
  /** The seeds the spec's deals were dealt from, in order (#460); none in a world. */
  readonly seeds: string[];
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
   * The fields the walk met in each action it opened, by pick name (#470), so an input naming a
   * field none of them has (a misspelt pick name) is reported once the walk met any of the action's
   * fields or took it.
   */
  readonly fieldsMet: Map<string, Set<string>>;
}

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(', ');

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

/** What the walk remembers of a deal that recording a resolved action reads and writes (#466). */
export interface ResolvedMemory {
  /** How many times each action was taken and resolved. */
  readonly resolved: Map<string, number>;
  /** The action resolved last, which a game that is now over ended on. */
  lastResolved: string | undefined;
  /** The actions that failed when taken: reported once, and not tried again while anything else is offered. */
  readonly failed: Set<string>;
  /** How many numbers the game's own rules have refused in each action, so the walk types the next one up. */
  readonly refused: Map<string, number>;
  /** What the game said when it refused a number, which its error toasts repeat. */
  readonly refusals: Set<string>;
  /** What the walk typed in each action's fields on its last attempt at it (#470), for the report if the game refuses it. */
  readonly typed: Map<string, TypedValue[]>;
  /** How many actions have been taken on this deal, so the walk knows when the game has moved on (#470). */
  moves: number;
}

/** How many numbers the walk enters in an action whose game refuses them, before it reports the action (#466). */
const NUMBER_TRIES = 3;

/**
 * Records the actions the page resolved since the walk last looked: a taken one is offered, enabled
 * and taken, and the deal remembers it; a failed one is reported and not tried again, unless the
 * game refused a number the walk chose and typed in it (`refusedANumber`). What the walk typed is
 * spent either way, so a later failure of the action is never taken for a refusal of a number it did
 * not type, and a failure is reported with it (`actionFailed`, #470). Either way the action no longer
 * waits on an input, and a taken one counts as the game moving on.
 */
export function recordResolved(resolved: readonly ResolvedAction[], walk: SmokeWalk, memory: ResolvedMemory): void {
  for (const { action, success, error } of resolved) {
    walk.offered.add(action);
    walk.enabled.add(action);
    walk.wanting.delete(action);
    const typed = memory.typed.get(action) ?? [];
    memory.typed.delete(action);
    if (success) {
      memory.moves++;
      walk.taken.add(action);
      memory.resolved.set(action, (memory.resolved.get(action) ?? 0) + 1);
      memory.lastResolved = action;
    } else if (!refusedANumber(action, error, typed, memory)) {
      memory.failed.add(action);
      note(walk, actionFailed(action, error, typed, memory.refused.get(action) ?? 0));
    }
  }
}

/**
 * Whether `action` failed because the game's own rules refused a number the walk chose and typed in
 * one of its fields (`typed`), with tries left; a number from the spec's `inputs` is the spec's
 * answer, never moved up (#470). Then the walk takes it again with the next number up, and the
 * refusal, and the error toast that repeats it, are the game working, not a problem (#466). A failure
 * the engine words as an error in the game's rules (`rulesErrorSentence`) is a crash, never a
 * refusal, whatever number the walk typed.
 */
function refusedANumber(action: string, error: string | undefined, typed: readonly TypedValue[], memory: ResolvedMemory): boolean {
  const refused = memory.refused.get(action) ?? 0;
  const choseANumber = typed.some(({ from, kind }) => from === 'walk' && kind === 'number');
  if (!choseANumber || refused >= NUMBER_TRIES - 1) return false;
  if (error === undefined || error.startsWith(rulesErrorSentence(action))) return false;
  memory.refused.set(action, refused + 1);
  memory.refusals.add(error);
  return true;
}

/** "dealt from seed "a", then from seed "b"", or the empty string for a world, which names no seed. */
function dealtFrom(seeds: readonly string[], then = 'then'): string {
  return seeds.length === 0 ? '' : `dealt from ${seeds.map((seed) => `seed "${seed}"`).join(`, ${then} from `)}`;
}

/** Why the walk never saw a listed action offered, and what to do about it. */
function neverOffered(walk: SmokeWalk, name: string): string {
  const [stall] = walk.stalls;
  if (stall !== undefined) {
    const where = stall.seed === null ? `step ${stall.step}` : `step ${stall.step} of the game dealt from seed "${stall.seed}"`;
    return (
      `The walk never saw "${name}" offered. It stopped at ${where}, because no seat had been offered anything for ` +
      `${stall.seconds}s, so more \`steps\` would not help. Run \`boardsmith smoke\` to watch where the game stops offering ` +
      'actions: a step no seat can act in, or one waiting on something no player does. Fix that, then run it again.'
    );
  }
  const deals = walk.seeds.length === 0 ? '' : ` ${dealtFrom(walk.seeds, 'nor')}`;
  const chooseASeed =
    walk.seeds.length === 0
      ? ''
      : ' If the deal decides whether it is offered (the cards a player is dealt, say), choose a seed whose deal offers it, ' +
        'and list it in `seed` there.';
  return (
    `The walk never saw "${name}" offered in ${walk.steps} steps from a fresh game${deals}. If a fresh game takes ` +
    `longer to reach it, raise \`steps\` in ${SMOKE_SPEC_PATH}.${chooseASeed} If no walk from a fresh game can reach it ` +
    `${walk.seeds.length === 0 ? '' : 'whatever the deal '}(it needs a long game, or a position play does not get to), name ` +
    'it in `unreachable` there with the reason. If the game no longer has it, remove it from `actions`.'
  );
}

/** Whether the spec declares `name` out of reach and the walk never saw it enabled, so it is not required. */
function excused(walk: SmokeWalk, name: string): boolean {
  return Object.hasOwn(walk.unreachable, name) && !walk.enabled.has(name);
}

/**
 * The listed actions the walk must take and has not: every one except an action the spec names in
 * `unreachable` that the walk never saw enabled.
 */
export function requiredUntaken(walk: SmokeWalk): string[] {
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
  const met = walk.fieldsMet.get(action);
  if (met !== undefined && (met.size > 0 || walk.taken.has(action)) && !met.has(field)) {
    return (
      `${inputName(action, field)} in ${SMOKE_SPEC_PATH} names a field the walk never met in "${action}", whose fields it ` +
      `met are ${met.size === 0 ? 'none' : quoted([...met].sort())}. Name the field by the pick name its rules give it.`
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

/** Everything that fails the walk, errors first. An empty list is a pass. */
export function smokeProblems(walk: SmokeWalk): string[] {
  const problems = [...walk.errors, ...declarationProblems(walk), ...inputProblems(walk)];
  const unlisted = [...walk.offered].filter((name) => !walk.listed.includes(name)).sort();
  if (unlisted.length > 0) {
    problems.push(
      `The game offered ${quoted(unlisted)}, which ${SMOKE_SPEC_PATH} does not list. ` +
        `Add ${unlisted.length === 1 ? 'it' : 'them'} to \`actions\` there.`,
    );
  }
  for (const name of requiredUntaken(walk)) {
    const field = walk.wanting.get(name);
    problems.push(
      !walk.offered.has(name)
        ? neverOffered(walk, name)
        : field !== undefined
          ? `The panel offered "${name}", but the walk never took it in ${walk.steps} steps: when it last opened it, ` +
            `${inputName(name, field)} in ${SMOKE_SPEC_PATH} gave no text for its field "${field}", so the walk cancelled it. ` +
            'Make it return the text a player would type there whenever the game offers the action.'
          : `The panel offered "${name}", but the walk never took it in ${walk.steps} steps. The errors above, if any, say why.`,
    );
  }
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
  /** The seeds the spec's deals were dealt from, in order; none in a world. */
  readonly seeds: string[];
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
  const excused =
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
  return `Served by \`boardsmith dev\` from a fresh start${dealt}, a seated player took ${took} and pressed ${pressed}, with no error${games}.${excused}${reached}`;
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

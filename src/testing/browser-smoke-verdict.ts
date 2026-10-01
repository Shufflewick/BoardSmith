/**
 * The verdict of an in-browser smoke walk (#453): what it saw, and the problems that fail it.
 *
 * Kept apart from `browser-smoke.ts`, which drives Chromium under Playwright, so the verdict is
 * decided by plain code a vitest test can hold to its wording.
 */

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
 * The seeds a walk deals from, in order: the spec's `seed`, one seed or a list of them, else
 * {@link DEFAULT_SMOKE_SEED}. Throws, saying what to write instead, on an empty list, a blank seed
 * or a seed listed twice.
 */
export function smokeSeeds(seed: string | readonly string[] | undefined): string[] {
  const seeds = seed === undefined ? [DEFAULT_SMOKE_SEED] : typeof seed === 'string' ? [seed] : [...seed];
  if (seeds.length === 0) {
    throw new Error(
      `\`seed\` in ${SMOKE_SPEC_PATH} is an empty list, so the walk would deal no game. List at least one seed, or leave ` +
        `\`seed\` out to deal from "${DEFAULT_SMOKE_SEED}".`,
    );
  }
  if (seeds.some((s) => s.trim() === '')) {
    throw new Error(`\`seed\` in ${SMOKE_SPEC_PATH} has a blank seed. A seed is any text that is not blank, such as "7" or "opening".`);
  }
  const twice = seeds.find((s, i) => seeds.indexOf(s) !== i);
  if (twice !== undefined) {
    throw new Error(`\`seed\` in ${SMOKE_SPEC_PATH} lists "${twice}" twice, which walks the same deal twice. List each seed once.`);
  }
  return seeds;
}

/** Where a walk stopped because no seat was offered anything for `seconds`. */
export interface SmokeStall {
  /** The step it stopped at, counted within its deal. */
  readonly step: number;
  /** The seed the game it stopped in was dealt from; null in a world, which `boardsmith dev` deals itself. */
  readonly seed: string | null;
  readonly seconds: number;
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
}

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(', ');

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
  const problems = [...walk.errors, ...declarationProblems(walk)];
  const unlisted = [...walk.offered].filter((name) => !walk.listed.includes(name)).sort();
  if (unlisted.length > 0) {
    problems.push(
      `The game offered ${quoted(unlisted)}, which ${SMOKE_SPEC_PATH} does not list. ` +
        `Add ${unlisted.length === 1 ? 'it' : 'them'} to \`actions\` there.`,
    );
  }
  for (const name of requiredUntaken(walk)) {
    problems.push(
      walk.offered.has(name)
        ? `The panel offered "${name}", but the walk never took it in ${walk.steps} steps. The errors above, if any, say why.`
        : neverOffered(walk, name),
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
export interface AnswerTrail {
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

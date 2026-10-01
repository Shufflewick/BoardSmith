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

/** What a walk saw. */
export interface SmokeWalk {
  /** The actions the spec lists. */
  readonly listed: readonly string[];
  /**
   * The listed actions the spec says no walk from a fresh game reaches, each with the reason. The
   * walk does not require them, takes them when offered, and fails on one that fails.
   */
  readonly unreachable: Readonly<Record<string, string>>;
  /** Every action the panel offered, whether or not it could be taken. */
  readonly offered: Set<string>;
  /** Every action taken and resolved without failing. */
  readonly taken: Set<string>;
  /** The most actions the walk would take. */
  readonly steps: number;
  /** Every error the page showed, in the order it showed them. */
  readonly errors: string[];
}

const quoted = (names: readonly string[]) => names.map((n) => `"${n}"`).join(', ');

/** The listed actions the walk must take and has not: every one the spec does not name in `unreachable`. */
export function requiredUntaken(walk: SmokeWalk): string[] {
  return walk.listed.filter((name) => !walk.taken.has(name) && !Object.hasOwn(walk.unreachable, name));
}

/** Why the spec's `unreachable` declarations cannot stand: one names no listed action, or gives no reason. */
function declarationProblems(walk: SmokeWalk): string[] {
  const problems: string[] = [];
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
        : `The walk never saw "${name}" offered in ${walk.steps} steps from a fresh game. If a fresh game takes longer ` +
            `to reach it, raise \`steps\` in ${SMOKE_SPEC_PATH}. If no walk from a fresh game can reach it (it needs a long ` +
            `game, or a position play does not get to), name it in \`unreachable\` there with the reason. If the game no ` +
            `longer has it, remove it from \`actions\`.`,
    );
  }
  return problems;
}

/** What a passing walk did, as `boardsmith verify` reports it. */
export interface SmokeRecord {
  /** The actions taken, sorted. */
  readonly taken: string[];
  /** How many board controls were pressed. */
  readonly controls: number;
  /** How many games the walk played: it starts a new one when a game ends with listed actions untaken. */
  readonly games: number;
  /** The declared actions the walk did not take, and so did not require. */
  readonly excused: string[];
  /** The declared actions the walk took anyway, whose declaration should go. */
  readonly reachedAnyway: string[];
}

/** The record of a walk that pressed `controls` board controls over `games` games. */
export function smokeRecord(walk: SmokeWalk, played: { controls: number; games: number }): SmokeRecord {
  const declared = Object.keys(walk.unreachable).sort();
  return {
    taken: [...walk.taken].sort(),
    controls: played.controls,
    games: played.games,
    excused: declared.filter((name) => !walk.taken.has(name)),
    reachedAnyway: declared.filter((name) => walk.taken.has(name)),
  };
}

/** What `boardsmith verify` says a passing walk did. */
export function smokeSummary(record: SmokeRecord): string {
  const took = record.taken.length === 0 ? 'no action' : quoted(record.taken);
  const pressed = `${record.controls} board control${record.controls === 1 ? '' : 's'}`;
  const games =
    record.games > 1 ? `, over ${record.games} games (a new one each time a game ended with listed actions still to take)` : '';
  const excused =
    record.excused.length > 0
      ? ` Not required, as ${SMOKE_SPEC_PATH} says a walk from a fresh game cannot reach them: ${quoted(record.excused)}.`
      : '';
  const reached =
    record.reachedAnyway.length > 0
      ? ` The walk took ${quoted(record.reachedAnyway)}, which ${SMOKE_SPEC_PATH} says a walk from a fresh game cannot ` +
        `reach: remove ${record.reachedAnyway.length === 1 ? 'it' : 'them'} from \`unreachable\` there, so the walk requires ` +
        `${record.reachedAnyway.length === 1 ? 'it' : 'them'}.`
      : '';
  return `Served by \`boardsmith dev\` from a fresh start, a seated player took ${took} and pressed ${pressed}, with no error${games}.${excused}${reached}`;
}

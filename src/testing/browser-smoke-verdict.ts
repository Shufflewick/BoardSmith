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
 * did: `{ "taken": [...action names], "controls": <board controls pressed> }`.
 */
export const SMOKE_ANNOTATION = 'boardsmith-smoke';

/** What a walk saw. */
export interface SmokeWalk {
  /** The actions the spec lists. */
  readonly listed: readonly string[];
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

/** Everything that fails the walk, errors first. An empty list is a pass. */
export function smokeProblems(walk: SmokeWalk): string[] {
  const problems = [...walk.errors];
  const unlisted = [...walk.offered].filter((name) => !walk.listed.includes(name)).sort();
  if (unlisted.length > 0) {
    problems.push(
      `The game offered ${quoted(unlisted)}, which ${SMOKE_SPEC_PATH} does not list. ` +
        `Add ${unlisted.length === 1 ? 'it' : 'them'} to \`actions\` there.`,
    );
  }
  for (const name of walk.listed.filter((listed) => !walk.taken.has(listed))) {
    problems.push(
      walk.offered.has(name)
        ? `The panel offered "${name}", but the walk never took it in ${walk.steps} steps. The errors above, if any, say why.`
        : `The walk never saw "${name}" offered in ${walk.steps} steps from a fresh game. If a fresh game takes longer ` +
            `to reach it, raise \`steps\` in ${SMOKE_SPEC_PATH}; if the game no longer has it, remove it from \`actions\`.`,
    );
  }
  return problems;
}

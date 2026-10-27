/**
 * The "mutation" block of boardsmith.json (#955): an override of how many mutants `boardsmith mutate`
 * runs at once, and the total Vitest workers they share.
 *
 *   "mutation": { "trials": 2, "workers": 8 }
 *
 * The unmutated run gets all `workers`; each trial `workers / trials`, rounded down. With no block,
 * every sampled mutant runs at once and each Vitest picks its own worker count (#1496).
 */

export interface MutationBudget {
  trials: number;
  workers: number;
}

const EXAMPLE = '{ "trials": 2, "workers": 8 }';

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1;

/** What is wrong with a "mutation" block, each problem saying what to write instead. Empty when it is right, or absent. */
export function mutationBlockProblems(block: unknown): string[] {
  if (block === undefined) return [];
  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    return [`"mutation" must be an object, e.g. ${EXAMPLE}. Got ${JSON.stringify(block)}.`];
  }
  const settings = block as Record<string, unknown>;
  const problems = Object.keys(settings)
    .filter((key) => key !== 'trials' && key !== 'workers')
    .map((key) => `Unknown key "${key}" in "mutation". It takes only "trials" and "workers".`);
  for (const key of ['trials', 'workers']) {
    if (!isCount(settings[key])) problems.push(`"mutation.${key}" must be a whole number of at least 1, e.g. ${EXAMPLE}. Got ${JSON.stringify(settings[key])}.`);
  }
  if (problems.length === 0 && (settings.workers as number) < (settings.trials as number)) {
    problems.push(
      `"mutation.workers" (${settings.workers}) must be at least "mutation.trials" (${settings.trials}), so every trial running at once has a test worker. Raise workers or lower trials.`,
    );
  }
  return problems;
}

/** The budget a project's boardsmith.json sets, or undefined for none. Throws the block's problems. */
export function mutationBudget(config: Record<string, unknown>): MutationBudget | undefined {
  const problems = mutationBlockProblems(config.mutation);
  if (problems.length > 0) throw new Error(`boardsmith.json has a problem in "mutation": ${problems.join(' ')}`);
  return config.mutation as MutationBudget | undefined;
}

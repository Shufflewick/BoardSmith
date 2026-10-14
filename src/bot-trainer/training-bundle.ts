import { pathToFileURL } from 'node:url';
import type { TrainingBundle } from './types.js';

/**
 * The training bundle at `path` (see {@link TrainingBundle}), refused with what
 * to add when it lacks the game's definition or the benchmark. The evolver
 * loads it before any benchmark runs, and each worker loads it again.
 */
export async function loadTrainingBundle(path: string): Promise<TrainingBundle> {
  const bundle = (await import(path.startsWith('file://') ? path : pathToFileURL(path).href)) as Partial<TrainingBundle>;
  if (
    !bundle.gameDefinition?.gameClass ||
    typeof bundle.benchmarkBot !== 'function' ||
    typeof bundle.weightedBot !== 'function'
  ) {
    throw new Error(
      `${path} must export the game's gameDefinition, benchmarkBot and weightedBot, built into one module ` +
        "so the bot plays on the game's own engine. Add `export { benchmarkBot, weightedBot } from " +
        "'boardsmith/bot-trainer';` to the entry it is built from.",
    );
  }
  return bundle as TrainingBundle;
}

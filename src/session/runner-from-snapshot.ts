import type { Game, GameClass, TutorialDefinition } from '../engine/index.js';
import {
  GameRunner,
  type GameStateSnapshot,
  type RunnerCheckpointPolicy,
  type UndoPolicy,
  type RandomnessPolicy,
} from '../runtime/index.js';

/** What rebuilding a runner reads off a game definition, with the host's randomness and history policies resolved. */
interface RunnerPolicies {
  gameClass: GameClass;
  checkpoints?: RunnerCheckpointPolicy;
  undo?: UndoPolicy;
  tutorial?: TutorialDefinition;
  readonly randomness: RandomnessPolicy;
  /** The host's instant for this op, epoch ms (#1532). */
  readonly now?: number;
}

/**
 * The runner `snapshot` holds, built the way every op builds it: with the
 * definition's checkpoint and undo policies, the host's randomness policy, and
 * the tutorial definition threaded back onto the game (tutorials are
 * unserializable attributes excluded from the snapshot, so every restore must
 * re-supply them). `executeOp` runs every op on one, and
 * `createHeadlessSession` reads a test's game with it.
 */
export function runnerFromSnapshot(snapshot: GameStateSnapshot, def: RunnerPolicies): GameRunner {
  const runner = GameRunner.fromSnapshot(
    snapshot,
    def.gameClass,
    // A host keeps the game from before a failed op, so a failed action changed nothing (#1254).
    { checkpoints: def.checkpoints, randomness: def.randomness, undo: def.undo, discardsFailedOps: true },
  );
  return withHostState(runner, def);
}

/**
 * `runner` with what no snapshot carries put back from `def`: the tutorial
 * definition, an unserializable attribute, and the host's instant for this op,
 * which replaces the one the snapshot was taken at (#1532).
 */
export function withHostState<R extends GameRunner>(runner: R, def: Pick<RunnerPolicies, 'tutorial' | 'now'>): R {
  if (def.tutorial) {
    (runner.game as Game).tutorialDefinition = def.tutorial;
  }
  if (def.now !== undefined) runner.setNow(def.now);
  return runner;
}

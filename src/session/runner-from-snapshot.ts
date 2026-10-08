import type { Game, GameClass, TutorialDefinition } from '../engine/index.js';
import {
  GameRunner,
  type GameStateSnapshot,
  type CheckpointPolicy,
  type UndoPolicy,
  type RandomnessPolicy,
} from '../runtime/index.js';

/** What rebuilding a runner reads off a game definition, with the host's randomness policy resolved. */
interface RunnerPolicies {
  gameClass: GameClass;
  checkpoints?: CheckpointPolicy;
  undo?: UndoPolicy;
  tutorial?: TutorialDefinition;
  readonly randomness: RandomnessPolicy;
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
    { checkpoints: def.checkpoints, randomness: def.randomness, undo: def.undo },
  );
  if (def.tutorial) {
    (runner.game as Game).tutorialDefinition = def.tutorial;
  }
  return runner;
}

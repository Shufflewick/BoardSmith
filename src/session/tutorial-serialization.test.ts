/**
 * Tutorial serialization round-trip guard.
 *
 * Phase 104 Plan 01 — Task 3
 *
 * LOAD-BEARING GUARD: These tests MUST fail if `tutorialProgress` is stored as
 * a `#private` field or a getter instead of a plain public instance field. They
 * prove the three serialization invariants that the entire tutorial substrate
 * relies on:
 *
 *   1. SNAPSHOT ROUND-TRIP: Progress set on a live game survives
 *      `runner.getSnapshot()` → `GameRunner.fromSnapshot()` → restored progress
 *      is deeply identical, including numeric seat keys (not coerced to strings).
 *
 *   2. UNDO REWIND: Mutating progress, then performing+undoing a game action
 *      rewinds progress to the boundary value captured at the undo checkpoint.
 *
 *   3. MCTS CLONE: An MCTS-style `new GameClass(options) + loadSerializedState`
 *      clone of a game with progress carries the root's progress value.
 *
 * These invariants fall out automatically from storing progress as a plain
 * public field (which `toJSON()` serializes via `Object.keys`) because every
 * path — `getSnapshot`, per-action `ActionCheckpoint`, `fromSnapshot`,
 * `fromCheckpoint` (undo), MCTS `restoreGame` — all funnel through
 * `loadSerializedState`. A wrong storage choice (#private/getter) would cause
 * the restored game to have an empty Map (constructor default), and test 1
 * would immediately fail.
 *
 * Do NOT depend on external game packages. This file is self-contained.
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import type { TutorialDefinition, TutorialProgress } from '../engine/tutorial/types.js';

// ---------------------------------------------------------------------------
// Minimal test game: two spaces (a and b), one Pawn piece.
// The 'movePawn' action moves the pawn from space a → b (or b → a).
// This gives us a concrete action to perform and undo.
// ---------------------------------------------------------------------------

class Pawn extends Piece<TutorialGame> {}
class Square extends Space<TutorialGame> {}

class TutorialGame extends Game<TutorialGame, Player> {
  a!: Square;
  b!: Square;

  constructor(options: GameOptions) {
    super(options);

    this.a = this.create(Square, 'a');
    this.b = this.create(Square, 'b');
    this.a.create(Pawn, 'pawn');

    this.registerAction(
      Action.create('movePawn')
        .execute((_args, ctx) => {
          const game = ctx.game as TutorialGame;
          const pawn = game.all(Pawn)[0];
          if (!pawn) return { success: false };
          // Toggle pawn between a and b
          const target = pawn.parent === game.a ? game.b : game.a;
          pawn.putInto(target);
          return { success: true };
        })
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['movePawn'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      })
    );
  }
}

/** Tutorial definition threaded un-serialized (like ai config). */
const TUTORIAL_DEF: TutorialDefinition = {
  steps: [
    { id: 's1', gate: { action: 'movePawn' } },
    { id: 's2', gate: { action: 'movePawn' } },
  ],
};

/** Build a started runner with a seeded game. */
function buildRunner(withTutorial = false): GameRunner<TutorialGame> {
  const runner = new GameRunner<TutorialGame>({
    GameClass: TutorialGame,
    gameType: 'tutorial-test',
    gameOptions: {
      playerCount: 1,
      seed: 'tut-test-seed',
      ...(withTutorial ? { tutorial: TUTORIAL_DEF } : {}),
    },
  });
  runner.start();
  return runner;
}

// ---------------------------------------------------------------------------
// Test 1: Snapshot round-trip preserves tutorialProgress with numeric keys
// ---------------------------------------------------------------------------

describe('tutorialProgress serialization round-trip', () => {
  it('survives runner.getSnapshot() → GameRunner.fromSnapshot() byte-identically', () => {
    const runner = buildRunner();

    // Set progress for seat 1 (numeric key — must survive JSON round-trip as number)
    const progressBefore: TutorialProgress = { stepId: 's1', status: 'running' };
    runner.game.tutorialProgress.set(1, progressBefore);

    // Capture snapshot (progress rides in game.toJSON() via Object.keys)
    const snapshot = runner.getSnapshot();

    // Round-trip through JSON (simulates cold-restart storage, as production would)
    const snapshotJson = JSON.parse(JSON.stringify(snapshot));

    // Restore from snapshot
    const restored = GameRunner.fromSnapshot<TutorialGame>(snapshotJson, TutorialGame);

    // CRITICAL: tutorialProgress must be a real Map (not a plain object with __map)
    expect(restored.game.tutorialProgress).toBeInstanceOf(Map);

    // CRITICAL: numeric key 1 (not string "1") must be present
    expect(restored.game.tutorialProgress.has(1)).toBe(true);
    expect(restored.game.tutorialProgress.has('1' as unknown as number)).toBe(false);

    // Progress value must be byte-identical
    const restoredProgress = restored.game.tutorialProgress.get(1);
    expect(restoredProgress).toBeDefined();
    expect(restoredProgress?.stepId).toBe('s1');
    expect(restoredProgress?.status).toBe('running');
  });

  it('preserves tutorialProgress for multiple seats simultaneously', () => {
    const runner = buildRunner();

    runner.game.tutorialProgress.set(1, { stepId: 's1', status: 'running' });
    runner.game.tutorialProgress.set(2, { stepId: 's2', status: 'completed' });

    const snapshot = runner.getSnapshot();
    const snapshotJson = JSON.parse(JSON.stringify(snapshot));
    const restored = GameRunner.fromSnapshot<TutorialGame>(snapshotJson, TutorialGame);

    expect(restored.game.tutorialProgress.size).toBe(2);
    expect(restored.game.tutorialProgress.get(1)?.stepId).toBe('s1');
    expect(restored.game.tutorialProgress.get(2)?.status).toBe('completed');
  });

  it('round-trips an empty Map without error (initial game state)', () => {
    const runner = buildRunner();
    // No progress set — tutorialProgress starts empty

    const snapshot = runner.getSnapshot();
    const snapshotJson = JSON.parse(JSON.stringify(snapshot));
    const restored = GameRunner.fromSnapshot<TutorialGame>(snapshotJson, TutorialGame);

    expect(restored.game.tutorialProgress).toBeInstanceOf(Map);
    expect(restored.game.tutorialProgress.size).toBe(0);
  });

  it('tutorialDefinition is NOT in the snapshot (must not serialize)', () => {
    const runner = buildRunner(true /* withTutorial */);
    // tutorialDefinition was set from options.tutorial in constructor
    expect(runner.game.tutorialDefinition).toBeDefined();
    expect(runner.game.tutorialDefinition?.steps).toHaveLength(2);

    const snapshot = runner.getSnapshot();
    const snapshotJson = JSON.parse(JSON.stringify(snapshot));

    // tutorialDefinition must NOT appear in the serialized game state
    const stateJson = JSON.stringify(snapshotJson.state);
    expect(stateJson).not.toContain('tutorialDefinition');

    // Restoring without the definition leaves tutorialDefinition undefined
    // (definition must be re-supplied by the session layer on restore)
    const restored = GameRunner.fromSnapshot<TutorialGame>(snapshotJson, TutorialGame);
    expect(restored.game.tutorialDefinition).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 2: Undo rewinds tutorialProgress to the boundary value
//
// Undo flow:
//   - `runner.start()` calls `captureCheckpoint()` seeding actionCheckpoints[0]
//   - `runner.captureCheckpoint()` overwrites actionCheckpoints[len] where
//     len = actionHistory.length
//   - `GameRunner.fromCheckpoint(snapshot, index, GameClass)` restores the game
//     from the per-action checkpoint at `index` (replaces the runner's game)
// ---------------------------------------------------------------------------

describe('tutorialProgress undo rewind', () => {
  it('restores progress to the boundary value captured at the undo checkpoint', () => {
    const runner = buildRunner();
    // After start(): actionCheckpoints[0] = initial state (empty progress)

    // Set 's1' progress on the live game, then explicitly re-capture
    // checkpoint 0 so the undo target has 's1' progress encoded.
    runner.game.tutorialProgress.set(1, { stepId: 's1', status: 'running' });
    runner.captureCheckpoint(); // actionCheckpoints[0] now has 's1'

    // Perform an action → actionHistory.length becomes 1
    const result = runner.performAction('movePawn', 1, {});
    expect(result.success).toBe(true);

    // Mutate progress to 's2' AFTER the action (simulates TutorialController
    // advancing the step in the session layer post-action)
    runner.game.tutorialProgress.set(1, { stepId: 's2', status: 'running' });
    expect(runner.game.tutorialProgress.get(1)?.stepId).toBe('s2');

    // Capture post-action checkpoint (actionCheckpoints[1] = state after action)
    runner.captureCheckpoint();

    // Take the full snapshot — includes both checkpoints
    const snapshot = runner.getSnapshot();
    const snapshotJson = JSON.parse(JSON.stringify(snapshot));

    // Undo to checkpoint 0 (the turn-start boundary before the action).
    // fromCheckpoint rebuilds the game from the stored actionCheckpoints[0] state,
    // which has 's1' progress — proving that progress is lockstep with undo.
    const undoneRunner = GameRunner.fromCheckpoint<TutorialGame>(
      snapshotJson,
      0,
      TutorialGame
    );
    expect(undoneRunner).not.toBeNull();

    const progressAfterUndo = undoneRunner!.game.tutorialProgress.get(1);
    expect(progressAfterUndo?.stepId).toBe('s1');
    expect(progressAfterUndo?.status).toBe('running');
  });

  it('undo to a checkpoint with no progress yields an empty Map', () => {
    const runner = buildRunner();
    // actionCheckpoints[0] = initial state, empty progress (set by start())

    // Perform action WITHOUT setting progress first → actionHistory.length = 1
    runner.performAction('movePawn', 1, {});

    // Now set progress and capture checkpoint 1
    runner.game.tutorialProgress.set(1, { stepId: 's1', status: 'running' });
    runner.captureCheckpoint(); // actionCheckpoints[1] = state with 's1'

    const snapshot = runner.getSnapshot();
    const snapshotJson = JSON.parse(JSON.stringify(snapshot));

    // Undo to checkpoint 0 (initial state, no progress)
    const undoneRunner = GameRunner.fromCheckpoint<TutorialGame>(
      snapshotJson,
      0,
      TutorialGame
    );
    expect(undoneRunner).not.toBeNull();

    // Progress must revert to the empty Map from the initial state
    expect(undoneRunner!.game.tutorialProgress).toBeInstanceOf(Map);
    expect(undoneRunner!.game.tutorialProgress.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 3: MCTS-style clone carries the root's tutorialProgress
// ---------------------------------------------------------------------------

describe('tutorialProgress MCTS clone', () => {
  it('new GameClass(options) + loadSerializedState carries root progress', () => {
    const runner = buildRunner(true /* withTutorial */);

    // Set progress on the root game
    runner.game.tutorialProgress.set(1, { stepId: 's1', status: 'running' });

    // Take a snapshot (this is exactly what the MCTS bot does to create its
    // root snapshot in MCTSBot.search() → captureSnapshot → runner.getSnapshot())
    const snapshot = runner.getSnapshot();
    const snapshotJson = JSON.parse(JSON.stringify(snapshot));

    // Simulate MCTS restoreGame: create fresh instance, loadSerializedState
    // (mirrors mcts-bot.ts:1201-1234 exactly)
    const cloneOptions = snapshotJson.gameOptions ?? {
      playerCount: snapshotJson.state.settings.playerCount as number,
      playerNames: snapshotJson.state.settings.playerNames as string[],
      seed: snapshotJson.seed,
    };
    const clone = new TutorialGame(cloneOptions);
    clone.loadSerializedState(snapshotJson.state);

    // Clone must carry the root's progress
    expect(clone.tutorialProgress).toBeInstanceOf(Map);
    expect(clone.tutorialProgress.has(1)).toBe(true);
    expect(clone.tutorialProgress.get(1)?.stepId).toBe('s1');
    expect(clone.tutorialProgress.get(1)?.status).toBe('running');
  });

  it('MCTS clone does NOT carry tutorialDefinition (it is un-serialized static config)', () => {
    const runner = buildRunner(true /* withTutorial */);
    runner.game.tutorialProgress.set(1, { stepId: 's1', status: 'running' });

    const snapshot = runner.getSnapshot();
    const snapshotJson = JSON.parse(JSON.stringify(snapshot));

    // MCTS restoreGame uses the options from the snapshot (no tutorial in gameOptions
    // since tutorial is excluded from serialized state)
    const cloneOptions = snapshotJson.gameOptions ?? {
      playerCount: snapshotJson.state.settings.playerCount as number,
      playerNames: snapshotJson.state.settings.playerNames as string[],
      seed: snapshotJson.seed,
    };

    const clone = new TutorialGame(cloneOptions);
    clone.loadSerializedState(snapshotJson.state);

    // Definition is NOT in the snapshot → must be undefined on the clone
    // (The bot never advances the tutorial — lifecycle is session-only — so
    // the absence of tutorialDefinition in the MCTS clone is by design.)
    expect(clone.tutorialDefinition).toBeUndefined();

    // But progress IS there (serialized)
    expect(clone.tutorialProgress.get(1)?.stepId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// Test 4: tutorialDefinition threads correctly from GameOptions
// ---------------------------------------------------------------------------

describe('tutorialDefinition threading', () => {
  it('game.tutorialDefinition is set when options.tutorial is provided', () => {
    const runner = buildRunner(true /* withTutorial */);

    expect(runner.game.tutorialDefinition).toBeDefined();
    expect(runner.game.tutorialDefinition).toBe(TUTORIAL_DEF);
    expect(runner.game.tutorialDefinition?.steps).toHaveLength(2);
    expect(runner.game.tutorialDefinition?.steps[0]?.id).toBe('s1');
  });

  it('game.tutorialDefinition is undefined when no tutorial in options', () => {
    const runner = buildRunner(false /* no tutorial */);
    expect(runner.game.tutorialDefinition).toBeUndefined();
  });

  it('Object.keys(game) includes tutorialProgress; tutorialDefinition is NOT serialized by toJSON', () => {
    const runner = buildRunner(true /* withTutorial */);
    const keys = Object.keys(runner.game);
    // tutorialProgress IS an own-enumerable property (required for toJSON)
    expect(keys).toContain('tutorialProgress');
    // tutorialDefinition IS an own property (it's a public field) but toJSON
    // must skip it because it's in unserializableAttributes.
    // Verify toJSON exclusion by checking the serialized state:
    const snapshot = runner.getSnapshot();
    const snapshotJson = JSON.parse(JSON.stringify(snapshot));
    const stateKeys = Object.keys(snapshotJson.state.attributes ?? {});
    expect(stateKeys).not.toContain('tutorialDefinition');
  });

  it('tutorialDefinition is in Game.unserializableAttributes', () => {
    const unser = (TutorialGame as unknown as { unserializableAttributes: string[] }).unserializableAttributes;
    expect(unser).toContain('tutorialDefinition');
    expect(unser).not.toContain('tutorialProgress');
  });
});

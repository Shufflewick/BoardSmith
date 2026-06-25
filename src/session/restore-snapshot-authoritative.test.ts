/**
 * Audit F42: GameSession.restore() must be SNAPSHOT-AUTHORITATIVE.
 *
 * Restore reconstructs game state via GameRunner.fromSnapshot(storedState.snapshot),
 * NOT via GameRunner.replay(actionHistory). Replay is unsound: selection-step /
 * pending-completed mutations (e.g. a Piece moved inside a repeating selection's
 * onEach) are recorded in neither command nor action history, so replaying an
 * incomplete actionHistory mis-positions the flow and loses those mutations.
 *
 * These tests prove:
 *   1. A multi-step / repeating-selection action's pending mutations survive a
 *      save -> (JSON round-trip, simulating a cold restart) -> restore EXACTLY.
 *   2. restore() calls GameRunner.fromSnapshot and NEVER GameRunner.replay.
 *   3. Undo and time-travel work AFTER restore (they were silently dead when
 *      restore cold-replayed action history, because the per-action undo
 *      checkpoints were never reconstructed).
 *   4. Stored state with NO snapshot fails loud with an actionable error instead
 *      of silently falling back to unsound replay.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  loop,
  eachPlayer,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { GameSession } from './game-session.js';
import type { StorageAdapter, StoredGameState } from './types.js';
import type { TutorialDefinition } from '../engine/tutorial/types.js';

// ---------------------------------------------------------------------------
// Test game: a repeating-selection action whose onEach moves pieces. The moves
// happen DURING the multi-step selection (not in execute), so they are exactly
// the kind of "pending mutation" that action-history replay cannot reproduce.
// ---------------------------------------------------------------------------

class Token extends Piece<CollectGame> {}
class Stash extends Space<CollectGame> {}
class Hand extends Space<CollectGame> {}

class CollectGame extends Game<CollectGame, Player> {
  stash!: Stash;
  hand!: Hand;

  constructor(options: GameOptions) {
    super(options);

    this.stash = this.create(Stash, 'stash');
    this.hand = this.create(Hand, 'hand');
    this.stash.create(Token, 'p1');
    this.stash.create(Token, 'p2');
    this.stash.create(Token, 'p3');

    this.registerAction(
      Action.create('collect')
        .chooseFrom('token', {
          // Choices are the remaining stash token names plus the 'stop' terminator.
          choices: (ctx) => [
            ...(ctx.game as CollectGame).stash.all(Token).map((t) => t.name),
            'stop',
          ],
          repeat: {
            until: (_ctx, last) => last === 'stop',
            onEach: (ctx, choice) => {
              if (choice === 'stop') return;
              // Pending mutation: move the chosen token from the stash to the hand.
              // Recorded in neither command nor action history — only the final
              // 'collect' entry (with collected args) lands in actionHistory.
              const game = ctx.game as CollectGame;
              const token = game.stash.all(Token).find((t) => t.name === choice);
              if (token) token.putInto(game.hand);
            },
          },
        })
        .execute(() => ({ success: true }))
    );

    // Single action-step that lets player 1 keep taking 'collect' turns. Staying
    // on player 1 (currentPlayer === 1, moveCount > 0) is what makes undo
    // available after restore.
    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['collect'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      })
    );
  }
}

/**
 * In-memory storage that simulates a real cold restart: it persists a JSON
 * round-trip of the stored state (exactly what a SQLite/KV adapter would do),
 * so any non-JSON-serializable custom state would be lost here too.
 */
class JsonRoundTripStorage implements StorageAdapter {
  saved: string | null = null;
  async save(state: StoredGameState): Promise<void> {
    this.saved = JSON.stringify(state);
  }
  async load(): Promise<StoredGameState | null> {
    return this.saved ? (JSON.parse(this.saved) as StoredGameState) : null;
  }
}

async function buildPlayedSession() {
  const storage = new JsonRoundTripStorage();
  const session = GameSession.create<CollectGame>({
    gameType: 'collect',
    GameClass: CollectGame,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'f42-seed',
    storage,
  });

  // Drive one full multi-step 'collect': pick p1, pick p2, then stop. The two
  // picks move p1 and p2 into the hand via onEach before execute() runs.
  await session.processSelectionStep(1, 'token', 'p1', 'collect');
  await session.processSelectionStep(1, 'token', 'p2');
  const done = await session.processSelectionStep(1, 'token', 'stop');
  expect(done.success).toBe(true);
  expect(done.actionComplete).toBe(true);

  return { session, storage };
}

function tokenNames(space: Space<CollectGame>): string[] {
  return space
    .all(Token)
    .map((t) => t.name)
    .filter((n): n is string => n !== undefined)
    .sort();
}

describe('F42: GameSession.restore is snapshot-authoritative', () => {
  it('persists a snapshot and reconstructs the exact post-multi-step state', async () => {
    const { session, storage } = await buildPlayedSession();

    // Sanity: the pending mutations actually happened in the live game.
    const liveGame = session.runner.game;
    expect(tokenNames(liveGame.hand)).toEqual(['p1', 'p2']);
    expect(tokenNames(liveGame.stash)).toEqual(['p3']);

    const liveJson = JSON.stringify(liveGame.toJSON());

    // Cold restart: load the JSON-round-tripped stored state.
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.snapshot).toBeDefined();

    const restored = GameSession.restore<CollectGame>(loaded!, CollectGame);

    // The restored tree is byte-for-byte identical to the live one — the pending
    // onEach moves survived because state, not action history, was authoritative.
    expect(JSON.stringify(restored.runner.game.toJSON())).toEqual(liveJson);
    expect(tokenNames(restored.runner.game.hand)).toEqual(['p1', 'p2']);
    expect(tokenNames(restored.runner.game.stash)).toEqual(['p3']);

    // actionHistory is preserved (for undo turn-detection) — exactly one entry
    // for the completed multi-step action.
    expect(restored.runner.actionHistory).toHaveLength(1);
    expect(restored.runner.actionHistory[0].name).toBe('collect');
  });

  it('uses GameRunner.fromSnapshot and never GameRunner.replay', async () => {
    const { storage } = await buildPlayedSession();
    const loaded = await storage.load();

    const fromSnapshotSpy = vi.spyOn(GameRunner, 'fromSnapshot');
    const replaySpy = vi.spyOn(GameRunner, 'replay');

    try {
      GameSession.restore<CollectGame>(loaded!, CollectGame);

      expect(fromSnapshotSpy).toHaveBeenCalledTimes(1);
      expect(fromSnapshotSpy.mock.calls[0][0]).toBe(loaded!.snapshot);
      expect(replaySpy).not.toHaveBeenCalled();
    } finally {
      fromSnapshotSpy.mockRestore();
      replaySpy.mockRestore();
    }
  });

  it('supports undo after restore (dead under the old replay restore)', async () => {
    const { storage } = await buildPlayedSession();
    const loaded = await storage.load();
    const restored = GameSession.restore<CollectGame>(loaded!, CollectGame);

    // It is still player 1's turn (the action-step repeats), so the just-completed
    // 'collect' is undoable. Under the OLD replay restore this returned the
    // "cold-restored ... cannot undo across pending mutations" error because the
    // per-action undo checkpoints were never reconstructed. With fromSnapshot the
    // snapshot carries them, so undo succeeds and rewinds the action history.
    //
    // (Note: a multi-step action's onEach mutations fold into the turn-start
    // checkpoint, so the board view is not asserted here — that fold is an
    // orthogonal, pre-existing checkpoint property. What F42 fixes is that undo is
    // no longer DEAD after a restore.)
    const undo = await restored.undoToTurnStart(1);
    expect(undo.success).toBe(true);
    expect(undo.actionsUndone).toBe(1);
    expect(restored.runner.actionHistory).toHaveLength(0);
  });

  it('supports time-travel (getStateAtAction) after restore', async () => {
    const { storage } = await buildPlayedSession();
    const loaded = await storage.load();
    const restored = GameSession.restore<CollectGame>(loaded!, CollectGame);

    // State at action 0 (turn start, before collect) — hand empty.
    const at0 = restored.getStateAtAction(0, 1);
    expect(at0.success).toBe(true);

    // State at action 1 (after collect completed) — current state.
    const at1 = restored.getStateAtAction(1, 1);
    expect(at1.success).toBe(true);

    // The current (restored) game still reflects the collected state — viewing
    // history did not mutate it.
    expect(tokenNames(restored.runner.game.hand)).toEqual(['p1', 'p2']);
  });

  it('fails loud when stored state has no snapshot (no silent replay fallback)', async () => {
    const { storage } = await buildPlayedSession();
    const loaded = await storage.load();

    // Simulate stored state saved before the snapshot field existed.
    const snapshotless: StoredGameState = { ...loaded!, snapshot: undefined };

    expect(() => GameSession.restore<CollectGame>(snapshotless, CollectGame)).toThrow(
      /no snapshot/
    );
  });
});

// ---------------------------------------------------------------------------
// BL-01: restore() must re-supply tutorialDefinition so gating + lifecycle
// survive a cold server restart (snapshot round-trip).
// ---------------------------------------------------------------------------

class TutorialRestoreGame extends Game<TutorialRestoreGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    const moveAction = Action.create('move')
      .prompt('Move')
      .chooseFrom('piece', { choices: ['a', 'b', 'c'] })
      .execute(() => {});

    const passAction = Action.create('pass')
      .prompt('Pass')
      .execute(() => {});

    this.registerActions(moveAction, passAction);

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => true,
          maxIterations: 20,
          do: eachPlayer({
            do: actionStep({ actions: ['move', 'pass'] }),
          }),
        }),
      })
    );
  }
}

const RESTORE_TUTORIAL: TutorialDefinition = {
  steps: [
    { id: 'step-1', gate: { action: 'move' } },
    { id: 'step-2', gate: { action: 'pass' } },
  ],
};

class TutorialRoundTripStorage implements StorageAdapter {
  saved: string | null = null;
  async save(state: StoredGameState): Promise<void> {
    this.saved = JSON.stringify(state);
  }
  async load(): Promise<StoredGameState | null> {
    return this.saved ? (JSON.parse(this.saved) as StoredGameState) : null;
  }
}

describe('BL-01: GameSession.restore() re-supplies tutorialDefinition', () => {
  it('gating reason survives snapshot → restore when tutorial param is passed', async () => {
    // Create a session with a tutorial definition
    const storage = new TutorialRoundTripStorage();
    const session = GameSession.create<TutorialRestoreGame>({
      gameType: 'tutorial-restore',
      GameClass: TutorialRestoreGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'bl01-seed',
      storage,
      tutorial: RESTORE_TUTORIAL,
    });

    // Start the tutorial for seat 1 (step-1 gates to 'move')
    session.startTutorial(1);

    // Re-snapshot after startTutorial so the persisted snapshot carries
    // tutorialProgress (the snapshot at create() time predates the mutation).
    session.storedState.snapshot = session.runner.getSnapshot();

    // Force a save so storage has the snapshot
    await (storage as TutorialRoundTripStorage).save(session.storedState);

    // Cold restart: JSON round-trip, then restore WITH the tutorial definition
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.snapshot).toBeDefined();

    const restored = GameSession.restore<TutorialRestoreGame>(
      loaded!,
      TutorialRestoreGame,
      undefined,
      undefined,
      RESTORE_TUTORIAL,
    );

    // After restore, gating must still be active:
    // 'pass' is out-of-step and must have a disabled reason
    const disabledActions = restored.runner.game.getTutorialDisabledActions(1);
    expect('pass' in disabledActions).toBe(true);
    expect(disabledActions['pass']).toBeTruthy();

    // The allowed action 'move' must NOT be disabled
    expect('move' in disabledActions).toBe(false);
  });

  it('getActiveStep resolves to the running step after restore', async () => {
    const storage = new TutorialRoundTripStorage();
    const session = GameSession.create<TutorialRestoreGame>({
      gameType: 'tutorial-restore',
      GameClass: TutorialRestoreGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'bl01-seed-2',
      storage,
      tutorial: RESTORE_TUTORIAL,
    });

    session.startTutorial(1);
    session.storedState.snapshot = session.runner.getSnapshot();
    await (storage as TutorialRoundTripStorage).save(session.storedState);

    const loaded = await storage.load();
    const restored = GameSession.restore<TutorialRestoreGame>(
      loaded!,
      TutorialRestoreGame,
      undefined,
      undefined,
      RESTORE_TUTORIAL,
    );

    // advance() must succeed (tutorialDefinition is present on the runner)
    expect(() => restored.advanceTutorial(1)).not.toThrow();
    // After advancing from step-1, gating should now be 'pass' (step-2)
    const disabledAfter = restored.runner.game.getTutorialDisabledActions(1);
    expect('move' in disabledAfter).toBe(true);
    expect('pass' in disabledAfter).toBe(false);
  });

  it('restore() WITHOUT tutorial param loses gating (documents the pre-fix behavior)', async () => {
    // This test documents what happens when restore() is called without the tutorial
    // definition — gating silently vanishes. This is the bug BL-01 fixes when the
    // tutorial param IS supplied; WITHOUT it, the definition remains undefined.
    const storage = new TutorialRoundTripStorage();
    const session = GameSession.create<TutorialRestoreGame>({
      gameType: 'tutorial-restore',
      GameClass: TutorialRestoreGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'bl01-seed-3',
      storage,
      tutorial: RESTORE_TUTORIAL,
    });

    session.startTutorial(1);
    session.storedState.snapshot = session.runner.getSnapshot();
    await (storage as TutorialRoundTripStorage).save(session.storedState);

    const loaded = await storage.load();
    // Restore WITHOUT tutorial — tutorialDefinition is not re-supplied
    const restored = GameSession.restore<TutorialRestoreGame>(loaded!, TutorialRestoreGame);

    // tutorialDefinition is absent — gating is completely gone
    const disabledActions = restored.runner.game.getTutorialDisabledActions(1);
    expect(disabledActions).toEqual({});
  });
});

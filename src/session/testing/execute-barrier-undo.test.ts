import { describe, it, expect } from 'vitest';
import { createHeadlessSession, type HeadlessOp } from '../headless-session.js';
import { GameSession } from '../game-session.js';
import { executeBarrierFixtureDefinition, ExecuteBarrierGame } from './fixtures/execute-barrier-fixture.js';
import { bookkeepingExecuteFixtureDefinition, BookkeepingExecuteGame } from './fixtures/bookkeeping-execute-fixture.js';
import type { Op } from '../stateless-ops.js';
import { ErrorCode } from '../../types/index.js';

/**
 * UNDO-02 regression: an undo/rewind must not cross a completed `execute()`
 * node -- `frame.completed` (`engine.ts` `executeExecute`) is transient and
 * cannot be the fence, since the STATELESS executor reconstructs a fresh
 * runner from the snapshot on every single op (`runnerFromSnapshot`). This
 * IS the durability proof the plan asks for: every assertion below runs
 * through `createHeadlessSession`, whose runner never survives an op with
 * any in-memory flow state intact -- only what's actually persisted in the
 * `GameStateSnapshot` (or, for the stateful executor, what
 * `GameRunner.fromCheckpoint` rehydrates) can possibly enforce the fence.
 *
 * Fixture: `sequence(actionStep(act1), execute(score += 1), actionStep(act2,
 * maxMoves: 2))`, single player (`execute-barrier-fixture.ts`). See that
 * file's doc comment for exactly why the "same-player, plain-action-step"
 * shape is what exposes the defect: FlowState.moveCount is only reported
 * while an action step declares minMoves/maxMoves, so once the two-move
 * `act2` step fully completes, the NEXT undo has no moveCount to key off and
 * `computeUndoInfo` falls back to a plain same-player backward scan -- which
 * knows nothing about the execute() barrier and walks straight past it.
 */

const gameOptions = { playerCount: 1, seed: 't' };

async function playThroughToBarrierCrossingPoint(
  // `HeadlessOp`, not `Op`: these ops are handed to `createHeadlessSession`'s
  // `send`, which stamps the host's CURRENT boundary key on an in-process
  // caller that composes and submits in the same tick.
  send: (op: HeadlessOp) => Promise<{ success: boolean; error?: string }>,
) {
  const act1 = await send({ type: 'action', actionName: 'act1', player: 1, args: {} });
  expect(act1.success).toBe(true);
  const act2a = await send({ type: 'action', actionName: 'act2', player: 1, args: {} });
  expect(act2a.success).toBe(true);
  const act2b = await send({ type: 'action', actionName: 'act2', player: 1, args: {} });
  expect(act2b.success).toBe(true);
}

describe('UNDO-02 execute-barrier (stateless)', () => {
  it('refuses an undo that would rewind past a completed execute() node', async () => {
    const session = createHeadlessSession(executeBarrierFixtureDefinition, gameOptions);
    await session.start();

    await playThroughToBarrierCrossingPoint((op) => session.send(1, op));

    // Both act2 moves are done: actionStep2 auto-completed, moveCount is no
    // longer reported, and the backward-scan fallback (same player
    // throughout) would rewind all the way to action index 0 -- crossing the
    // execute() barrier at index 1 and discarding both `act1` AND the
    // execute()'s committed `score` increment.
    const undo = await session.send(1, { type: 'undo', player: 1 } as Op);

    expect(undo.success).toBe(false);
  });

  it('the execute() side effect survives the refused undo attempt', async () => {
    const session = createHeadlessSession(executeBarrierFixtureDefinition, gameOptions);
    await session.start();

    await playThroughToBarrierCrossingPoint((op) => session.send(1, op));
    const undo = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(undo.success).toBe(false);

    // Read the score straight off a fresh snapshot-reconstructed view --
    // exactly what a client would see next -- proving the refusal didn't
    // roll the execute()'s committed side effect back anyway.
    const debugState = (await session.send(1, { type: 'debugFlowState', player: 1 } as Op)) as unknown as {
      success: boolean;
      snapshot: { state: { attributes?: { score?: number } } };
    };
    expect(debugState.success).toBe(true);
    expect(debugState.snapshot.state.attributes?.score).toBe(1);
  });

  it('negative control: an undo that stops short of the barrier (mid actionStep2) still succeeds', async () => {
    const session = createHeadlessSession(executeBarrierFixtureDefinition, gameOptions);
    await session.start();

    const act1 = await session.send(1, { type: 'action', actionName: 'act1', player: 1, args: {} });
    expect(act1.success).toBe(true);
    const act2a = await session.send(1, { type: 'action', actionName: 'act2', player: 1, args: {} });
    expect(act2a.success).toBe(true);

    // Only ONE of act2's two required moves has been made: actionStep2's
    // config still declares maxMoves, so moveCount is defined and bounds the
    // undo to no earlier than the barrier (turnStartActionIndex === barrier).
    // This must succeed -- the guard must not refuse a legitimate undo.
    const undo = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(undo.success).toBe(true);
  });

  it('debugRewind targeting an index before the barrier is refused', async () => {
    const session = createHeadlessSession(executeBarrierFixtureDefinition, gameOptions);
    await session.start();

    await playThroughToBarrierCrossingPoint((op) => session.send(1, op));

    // Explicitly target action index 0 -- before act1, before the execute()
    // barrier at index 1.
    const rewind = await session.send(1, { type: 'debugRewind', actionIndex: 0 } as Op);
    expect(rewind.success).toBe(false);
  });
});

describe('UNDO-02 execute-barrier (stateful)', () => {
  function newStatefulSession() {
    return GameSession.create<ExecuteBarrierGame>({
      gameType: 'execute-barrier',
      GameClass: ExecuteBarrierGame,
      playerCount: 1,
      playerNames: ['A'],
      seed: 't',
    });
  }

  async function playThroughToBarrierCrossingPointStateful(session: GameSession<ExecuteBarrierGame>) {
    const act1 = await session.performAction('act1', 1, {});
    expect(act1.success).toBe(true);
    const act2a = await session.performAction('act2', 1, {});
    expect(act2a.success).toBe(true);
    const act2b = await session.performAction('act2', 1, {});
    expect(act2b.success).toBe(true);
  }

  it('refuses an undo that would rewind past a completed execute() node', async () => {
    const session = newStatefulSession();
    await playThroughToBarrierCrossingPointStateful(session);

    const undo = await session.undoToTurnStart(1);
    expect(undo.success).toBe(false);
  });

  it('the execute() side effect survives the refused undo attempt', async () => {
    const session = newStatefulSession();
    await playThroughToBarrierCrossingPointStateful(session);
    await session.undoToTurnStart(1);

    const scoreAfter = (session.runner.getSnapshot().state as { attributes?: { score?: number } }).attributes?.score;
    expect(scoreAfter).toBe(1);
  });

  it('negative control: an undo that stops short of the barrier (mid actionStep2) still succeeds', async () => {
    const session = newStatefulSession();
    const act1 = await session.performAction('act1', 1, {});
    expect(act1.success).toBe(true);
    const act2a = await session.performAction('act2', 1, {});
    expect(act2a.success).toBe(true);

    const undo = await session.undoToTurnStart(1);
    expect(undo.success).toBe(true);
  });

  it('rewindToAction() targeting an index before the barrier is refused', async () => {
    const session = newStatefulSession();
    await playThroughToBarrierCrossingPointStateful(session);

    const rewind = await session.rewindToAction(0);
    expect(rewind.success).toBe(false);
  });
});

/**
 * The other half of the contract: an UNMARKED `execute()` fences NOTHING.
 *
 * Same flow shape as the fixture above, minus `{ irreversible: true }`. Both
 * executors must let undo and rewind cross it, because everything the node
 * touched is game state and the checkpoint restores state.
 *
 * This is the case the blanket fence got wrong. A bookkeeping node after an
 * action step is the ordinary way to write a turn (Checkers' move loop), and
 * while every `execute()` fenced undo, one such node parked the fence at the
 * current action count every turn — so undo and debug rewind could never reach
 * behind the current turn in almost any real game.
 */
describe('UNDO-02: a bookkeeping (unmarked) execute() does not fence undo', () => {
  it('stateless: undo is never refused BY THE FENCE (only by its own scope rules)', async () => {
    const session = createHeadlessSession(bookkeepingExecuteFixtureDefinition, gameOptions);
    await session.start();

    await playThroughToBarrierCrossingPoint((op) => session.send(1, op));

    // Undo may still decline here for an unrelated, pre-existing reason: once
    // both act2 moves land, the step auto-completes and `flowState.moveCount`
    // stops being reported, which UNDO-03 treats as "no action step is active,
    // so there is nothing in scope to undo". What must NEVER appear is the
    // commitment refusal — an unmarked execute() commits nothing.
    const undo = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(undo.error ?? '').not.toMatch(/irreversible/i);
    expect(undo.errorCode).not.toBe(ErrorCode.UNDO_NOT_ALLOWED);
  });

  it('stateless: debugRewind targeting an index before it is allowed', async () => {
    const session = createHeadlessSession(bookkeepingExecuteFixtureDefinition, gameOptions);
    await session.start();

    await playThroughToBarrierCrossingPoint((op) => session.send(1, op));

    const rewind = await session.send(1, { type: 'debugRewind', actionIndex: 0 } as Op);
    expect(rewind.success).toBe(true);
  });

  it('stateful: rewindToAction crosses it, and the state it wrote is restored', async () => {
    const session = GameSession.create<BookkeepingExecuteGame>({
      gameType: 'bookkeeping-execute',
      GameClass: BookkeepingExecuteGame,
      playerCount: 1,
      playerNames: ['A'],
      seed: 't',
    });

    await session.performAction('act1', 1, {});
    await session.performAction('act2', 1, {});
    await session.performAction('act2', 1, {});
    // The bookkeeping node ran: the flag it wrote is live.
    expect(session.runner.game.turnFlag).toBe(1);

    const rewind = await session.rewindToAction(0);
    expect(rewind.success).toBe(true);
    // Rewinding BEHIND the node restores the state as it stood before it —
    // which is exactly why crossing it is sound.
    expect(session.runner.game.turnFlag).toBe(0);
  });
});

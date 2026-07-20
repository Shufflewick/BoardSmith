import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { collectFixtureDefinition } from './fixtures/collect-fixture.js';
import { undoFenceFixtureDefinition, UndoFenceGame } from './fixtures/undo-fence-fixture.js';
import { executeBarrierFixtureDefinition, ExecuteBarrierGame } from './fixtures/execute-barrier-fixture.js';
import { GameSession } from '../game-session.js';
import type { Op } from '../stateless-ops.js';
import { ErrorCode } from '../../types/protocol.js';

/**
 * Parity contract: drives the SAME SnapshotSessionHost + executeOp snapshot
 * round-trip that production uses, through the collect-equipment flow that
 * mirrors MERC. Diagnoses whether the known prod bugs reproduce through the
 * shared stateless core.
 */

const gameOptions = { playerCount: 1, seed: 't' };

type ValidElement = { id: number; display?: string };

function newSession() {
  return createHeadlessSession(collectFixtureDefinition, gameOptions);
}

describe('collect-equipment parity contract', () => {
  // KNOWN BUG (reproduced): fixed in Phase 5 of
  // docs/superpowers/plans/2026-06-09-dev-prod-parity-harness.md; flip it.fails -> it when green.
  it('A. equipment collected via selectionStep persists across the snapshot round-trip', async () => {
    const session = newSession();
    await session.start();

    const explore = await session.send(1, { type: 'action', actionName: 'explore', player: 1, args: {} });
    expect(explore.success).toBe(true);
    const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

    // Read the stash items currently available to collect.
    const before = await session.send(1, {
      type: 'resolveChoices',
      actionName: 'collect',
      player: 1,
      selectionName: 'item',
      args: {},
    });
    expect(before.success).toBe(true);
    const itemsBefore = (before.validElements as ValidElement[]) ?? [];
    expect(itemsBefore.length).toBeGreaterThan(0);
    const firstId = itemsBefore[0].id;

    // Collect the first item via a pending selection step.
    const step = await session.send(1, {
      type: 'selectionStep',
      player: 1,
      selectionName: 'item',
      value: firstId,
      actionName: 'collect',
      initialArgs: followUpArgs,
    } as Op);
    expect(step.success).toBe(true);

    // After equipping, the same item must NOT still be in the stash.
    const after = await session.send(1, {
      type: 'resolveChoices',
      actionName: 'collect',
      player: 1,
      selectionName: 'item',
      args: {},
    });
    expect(after.success).toBe(true);
    const idsAfter = ((after.validElements as ValidElement[]) ?? []).map((e) => e.id);
    expect(idsAfter).not.toContain(firstId);
  });

  // KNOWN BUG (reproduced): fixed in Phase 5 of
  // docs/superpowers/plans/2026-06-09-dev-prod-parity-harness.md; flip it.fails -> it when green.
  it('B. skipping the optional selection (null) completes the action ("Done collecting")', async () => {
    const session = newSession();
    await session.start();

    const explore = await session.send(1, { type: 'action', actionName: 'explore', player: 1, args: {} });
    expect(explore.success).toBe(true);
    const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

    const res = await session.send(1, {
      type: 'selectionStep',
      player: 1,
      selectionName: 'item',
      value: null,
      actionName: 'collect',
      initialArgs: followUpArgs,
    } as Op);

    expect(res.success).toBe(true);
    expect(res.actionComplete).toBe(true);
  });

  it('C. the explore followUp is structured-cloneable (plain-id args)', async () => {
    const session = newSession();
    await session.start();

    const explore = await session.send(1, { type: 'action', actionName: 'explore', player: 1, args: {} });
    expect(explore.success).toBe(true);
    expect(() => structuredClone(explore.followUp)).not.toThrow();
  });
});

/**
 * UNDO-01/UNDO-02 drift detector + adversarial verification (D-01/D-09,
 * PROC-01, T-155-01/T-155-02). The stateless (SnapshotSessionHost) and
 * stateful (GameSession) undo/rewind executors must agree on the refusal
 * decision AND message for the same fixture scenario -- this is the locked
 * "two executors must not drift" invariant.
 *
 * Every adversarial case here deliberately bypasses the client's advisory
 * `canUndo` state -- it builds the raw op literal (or calls the session
 * method directly) without ever reading it, exactly as an attacker would.
 */
const undoFenceGameOptions = { playerCount: 2, seed: 't' };

async function statelessLockThenUndo() {
  const session = createHeadlessSession(undoFenceFixtureDefinition, undoFenceGameOptions);
  await session.start();
  const lock = await session.send(1, { type: 'action', actionName: 'lock', player: 1, args: {} });
  expect(lock.success).toBe(true);
  return session.send(1, { type: 'undo', player: 1 } as Op);
}

function newStatefulSession() {
  return GameSession.create<UndoFenceGame>({
    gameType: 'undo-fence',
    GameClass: UndoFenceGame,
    playerCount: 2,
    playerNames: ['A', 'B'],
    seed: 't',
  });
}

async function statefulLockThenUndo() {
  const session = newStatefulSession();
  const lock = await session.performAction('lock', 1, {});
  expect(lock.success).toBe(true);
  return session.undoToTurnStart(1);
}

describe('undo-fence parity: stateless and stateful executors agree', () => {
  it('non-undoable case: same refusal decision and message on both executors', async () => {
    const statelessResult = await statelessLockThenUndo();
    const statefulResult = await statefulLockThenUndo();

    expect(statelessResult.success).toBe(false);
    expect(statefulResult.success).toBe(false);
    expect(statelessResult.error).toBe(statefulResult.error);
  });

  it('finished-phase case: same refusal decision and message on both executors', async () => {
    const statelessSession = createHeadlessSession(undoFenceFixtureDefinition, undoFenceGameOptions);
    await statelessSession.start();
    const statelessEnd = await statelessSession.send(1, {
      type: 'action',
      actionName: 'endGame',
      player: 1,
      args: {},
    });
    expect(statelessEnd.success).toBe(true);
    const statelessUndo = await statelessSession.send(1, { type: 'undo', player: 1 } as Op);

    const statefulSession = newStatefulSession();
    const statefulEnd = await statefulSession.performAction('endGame', 1, {});
    expect(statefulEnd.success).toBe(true);
    const statefulUndo = await statefulSession.undoToTurnStart(1);

    expect(statelessUndo.success).toBe(false);
    expect(statefulUndo.success).toBe(false);
    expect(statelessUndo.error).toBe(statefulUndo.error);
  });

  // Review follow-up (155-REVIEW W1/W3): the two executors must not drift on
  // the machine-readable errorCode, only on the human message. A forward
  // rewind (target === history length) is the edge where the twins previously
  // disagreed -- one accepted it as a no-op, the other rejected it.
  it('forward-rewind edge: both executors reject target === history length with CANNOT_REWIND_FORWARD', async () => {
    const statelessSession = createHeadlessSession(undoFenceFixtureDefinition, undoFenceGameOptions);
    await statelessSession.start();
    await statelessSession.send(1, { type: 'action', actionName: 'lock', player: 1, args: {} });
    // One action in history -> index 1 is "forward" for both twins.
    const statelessRewind = await statelessSession.send(1, { type: 'debugRewind', player: 1, actionIndex: 1 } as Op);

    const statefulSession = newStatefulSession();
    await statefulSession.performAction('lock', 1, {});
    const statefulRewind = await statefulSession.rewindToAction(1);

    expect(statelessRewind.success).toBe(false);
    expect(statefulRewind.success).toBe(false);
    expect(statelessRewind.errorCode).toBe(ErrorCode.CANNOT_REWIND_FORWARD);
    expect(statefulRewind.errorCode).toBe(ErrorCode.CANNOT_REWIND_FORWARD);
  });

  it('turn/undo error codes are populated (not dropped) on the stateless path', async () => {
    const session = createHeadlessSession(undoFenceFixtureDefinition, undoFenceGameOptions);
    await session.start();
    // No actions taken yet -> "no actions to undo" on the current turn.
    const noActions = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(noActions.success).toBe(false);
    expect(noActions.errorCode).toBe(ErrorCode.NO_ACTIONS_TO_UNDO);

    // Out-of-range seat -> INVALID_PLAYER, matching the stateful twin.
    const badSeat = await session.send(1, { type: 'undo', player: 99 } as Op);
    expect(badSeat.success).toBe(false);
    expect(badSeat.errorCode).toBe(ErrorCode.INVALID_PLAYER);
  });
});

describe('undo-fence adversarial verification (bypassing canUndo)', () => {
  it('a hand-crafted raw {type: "undo"} op sent without ever consulting canUndo is refused', async () => {
    const session = createHeadlessSession(undoFenceFixtureDefinition, undoFenceGameOptions);
    await session.start();
    const lock = await session.send(1, { type: 'action', actionName: 'lock', player: 1, args: {} });
    expect(lock.success).toBe(true);

    // Never read state.canUndo -- attempt the raw op directly.
    const undoOp: Op = { type: 'undo', player: 1 };
    const result = await session.send(1, undoOp);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lock/i);
  });

  it('calling undoToTurnStart() directly on the stateful session, bypassing the UI, is refused', async () => {
    const session = newStatefulSession();
    const lock = await session.performAction('lock', 1, {});
    expect(lock.success).toBe(true);

    // Never read a UI-level canUndo flag -- call the session API directly.
    const result = await session.undoToTurnStart(1);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lock/i);
  });

  it('debugRewind op crossing a notUndoable action is refused', async () => {
    const session = createHeadlessSession(undoFenceFixtureDefinition, undoFenceGameOptions);
    await session.start();
    const lock = await session.send(1, { type: 'action', actionName: 'lock', player: 1, args: {} });
    expect(lock.success).toBe(true);

    // Rewind to action index 0 -- discarding the notUndoable `lock` action.
    const rewindOp: Op = { type: 'debugRewind', player: 1, actionIndex: 0 };
    const result = await session.send(1, rewindOp);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lock/i);
  });

  it('rewindToAction() called directly, crossing a notUndoable action, is refused', async () => {
    const session = newStatefulSession();
    const lock = await session.performAction('lock', 1, {});
    expect(lock.success).toBe(true);

    // Rewind to action index 0 -- discarding the notUndoable `lock` action.
    const result = await session.rewindToAction(0);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lock/i);
  });
});

/**
 * UNDO-02 execute-barrier drift detector + adversarial verification
 * (155-02, T-155-05..T-155-08). Same "stateless and stateful must not drift"
 * invariant as the undo-fence block above, extended to the durable
 * execute()-barrier fence. See `execute-barrier-fixture.ts` for exactly why
 * this flow shape (plain act1/act2 action steps, same player throughout)
 * exposes the defect.
 */
const executeBarrierGameOptions = { playerCount: 1, seed: 't' };

function newExecuteBarrierStatefulSession() {
  return GameSession.create<ExecuteBarrierGame>({
    gameType: 'execute-barrier',
    GameClass: ExecuteBarrierGame,
    playerCount: 1,
    playerNames: ['A'],
    seed: 't',
  });
}

async function playThroughExecuteBarrierStateless(send: (op: Op) => Promise<{ success: boolean }>) {
  expect((await send({ type: 'action', actionName: 'act1', player: 1, args: {} })).success).toBe(true);
  expect((await send({ type: 'action', actionName: 'act2', player: 1, args: {} })).success).toBe(true);
  expect((await send({ type: 'action', actionName: 'act2', player: 1, args: {} })).success).toBe(true);
}

async function playThroughExecuteBarrierStateful(session: GameSession<ExecuteBarrierGame>) {
  expect((await session.performAction('act1', 1, {})).success).toBe(true);
  expect((await session.performAction('act2', 1, {})).success).toBe(true);
  expect((await session.performAction('act2', 1, {})).success).toBe(true);
}

describe('execute-barrier parity: stateless and stateful executors agree', () => {
  it('crossing-the-barrier undo: same refusal decision and message on both executors', async () => {
    const statelessSession = createHeadlessSession(executeBarrierFixtureDefinition, executeBarrierGameOptions);
    await statelessSession.start();
    await playThroughExecuteBarrierStateless((op) => statelessSession.send(1, op));
    const statelessUndo = await statelessSession.send(1, { type: 'undo', player: 1 } as Op);

    const statefulSession = newExecuteBarrierStatefulSession();
    await playThroughExecuteBarrierStateful(statefulSession);
    const statefulUndo = await statefulSession.undoToTurnStart(1);

    expect(statelessUndo.success).toBe(false);
    expect(statefulUndo.success).toBe(false);
    expect(statelessUndo.error).toBe(statefulUndo.error);
  });

  it('crossing-the-barrier debugRewind/rewindToAction: same refusal decision and message on both executors', async () => {
    const statelessSession = createHeadlessSession(executeBarrierFixtureDefinition, executeBarrierGameOptions);
    await statelessSession.start();
    await playThroughExecuteBarrierStateless((op) => statelessSession.send(1, op));
    const statelessRewind = await statelessSession.send(1, { type: 'debugRewind', actionIndex: 0 } as Op);

    const statefulSession = newExecuteBarrierStatefulSession();
    await playThroughExecuteBarrierStateful(statefulSession);
    const statefulRewind = await statefulSession.rewindToAction(0);

    expect(statelessRewind.success).toBe(false);
    expect(statefulRewind.success).toBe(false);
    expect(statelessRewind.error).toBe(statefulRewind.error);
  });
});

describe('execute-barrier adversarial verification (bypassing canUndo)', () => {
  it('a hand-crafted raw {type: "undo"} op sent without ever consulting canUndo is refused', async () => {
    const session = createHeadlessSession(executeBarrierFixtureDefinition, executeBarrierGameOptions);
    await session.start();
    await playThroughExecuteBarrierStateless((op) => session.send(1, op));

    // Never read state.canUndo -- attempt the raw op directly.
    const undoOp: Op = { type: 'undo', player: 1 };
    const result = await session.send(1, undoOp);

    expect(result.success).toBe(false);
  });

  it('calling undoToTurnStart() directly on the stateful session, bypassing the UI, is refused', async () => {
    const session = newExecuteBarrierStatefulSession();
    await playThroughExecuteBarrierStateful(session);

    // Never read a UI-level canUndo flag -- call the session API directly.
    const result = await session.undoToTurnStart(1);

    expect(result.success).toBe(false);
  });

  it('a hand-crafted raw {type: "debugRewind"} op targeting index 0 is refused', async () => {
    const session = createHeadlessSession(executeBarrierFixtureDefinition, executeBarrierGameOptions);
    await session.start();
    await playThroughExecuteBarrierStateless((op) => session.send(1, op));

    const rewindOp: Op = { type: 'debugRewind', actionIndex: 0 };
    const result = await session.send(1, rewindOp);

    expect(result.success).toBe(false);
  });

  it('rewindToAction() called directly, bypassing the UI, is refused', async () => {
    const session = newExecuteBarrierStatefulSession();
    await playThroughExecuteBarrierStateful(session);

    const result = await session.rewindToAction(0);

    expect(result.success).toBe(false);
  });
});

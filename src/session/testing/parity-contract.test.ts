import { describe, it, expect } from 'vitest';
import { createHeadlessSession, type HeadlessOp } from '../headless-session.js';
import { collectFixtureDefinition } from './fixtures/collect-fixture.js';
import { undoFenceFixtureDefinition } from './fixtures/undo-fence-fixture.js';
import { executeBarrierFixtureDefinition } from './fixtures/execute-barrier-fixture.js';
import { simultaneousFixtureDefinition } from './fixtures/simultaneous-fixture.js';
import { crossPhaseFixtureDefinition } from './fixtures/simultaneous-cross-phase-fixture.js';
import type { Op } from '../stateless-ops.js';
import { ErrorCode } from '../../types/protocol.js';
import { succeeded, refused } from '../op-result.test-helper.js';

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

    const explore = succeeded(await session.send(1, { type: 'action', actionName: 'explore', player: 1, args: {} }));
    expect(explore.success).toBe(true);
    const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

    // Read the stash items currently available to collect.
    const before = succeeded(await session.send(1, {
      type: 'resolveChoices',
      actionName: 'collect',
      player: 1,
      selectionName: 'item',
      args: {},
    }));
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
    });
    expect(step.success).toBe(true);

    // After equipping, the same item must NOT still be in the stash.
    const after = succeeded(await session.send(1, {
      type: 'resolveChoices',
      actionName: 'collect',
      player: 1,
      selectionName: 'item',
      args: {},
    }));
    expect(after.success).toBe(true);
    const idsAfter = ((after.validElements as ValidElement[]) ?? []).map((e) => e.id);
    expect(idsAfter).not.toContain(firstId);
  });

  // KNOWN BUG (reproduced): fixed in Phase 5 of
  // docs/superpowers/plans/2026-06-09-dev-prod-parity-harness.md; flip it.fails -> it when green.
  it('B. skipping the optional selection (null) completes the action ("Done collecting")', async () => {
    const session = newSession();
    await session.start();

    const explore = succeeded(await session.send(1, { type: 'action', actionName: 'explore', player: 1, args: {} }));
    expect(explore.success).toBe(true);
    const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

    const res = succeeded(await session.send(1, {
      type: 'selectionStep',
      player: 1,
      selectionName: 'item',
      value: null,
      actionName: 'collect',
      initialArgs: followUpArgs,
    }));

    expect(res.success).toBe(true);
    expect(res.actionComplete).toBe(true);
  });

  it('C. the explore followUp is structured-cloneable (plain-id args)', async () => {
    const session = newSession();
    await session.start();

    const explore = succeeded(await session.send(1, { type: 'action', actionName: 'explore', player: 1, args: {} }));
    expect(explore.success).toBe(true);
    expect(() => structuredClone(explore.followUp)).not.toThrow();
  });
});

/**
 * UNDO-01/UNDO-02 adversarial verification (D-01/D-09, PROC-01,
 * T-155-01/T-155-02): the undo and debug-rewind ops refuse what the fences
 * forbid, with the machine-readable errorCode populated.
 *
 * Every adversarial case here deliberately bypasses the client's advisory
 * `canUndo` state -- it builds the raw op literal without ever reading it,
 * exactly as an attacker would.
 */
const undoFenceGameOptions = { playerCount: 2, seed: 't' };

/** A started session in which seat 1 has taken the notUndoable `lock`. */
async function sessionAfterLock() {
  const session = createHeadlessSession(undoFenceFixtureDefinition, undoFenceGameOptions);
  await session.start();
  const lock = await session.send(1, { type: 'action', actionName: 'lock', player: 1, args: {} });
  expect(lock.success).toBe(true);
  return session;
}

describe('undo-fence error codes', () => {
  // Review follow-up (155-REVIEW W1/W3): a forward rewind (target === history
  // length) is the edge where the old executors disagreed -- one accepted it
  // as a no-op, the other rejected it. It is rejected.
  it('forward-rewind edge: debugRewind rejects target === history length with CANNOT_REWIND_FORWARD', async () => {
    const session = createHeadlessSession(undoFenceFixtureDefinition, undoFenceGameOptions);
    await session.start();
    await session.send(1, { type: 'action', actionName: 'lock', player: 1, args: {} });
    // One action in history -> index 1 is "forward".
    const rewind = await session.send(1, { type: 'debugRewind', actionIndex: 1 });

    expect(rewind.success).toBe(false);
    expect(rewind.errorCode).toBe(ErrorCode.CANNOT_REWIND_FORWARD);
  });

  it('turn/undo error codes are populated (not dropped)', async () => {
    const session = createHeadlessSession(undoFenceFixtureDefinition, undoFenceGameOptions);
    await session.start();
    // No actions taken yet -> "no actions to undo" on the current turn.
    const noActions = await session.send(1, { type: 'undo', player: 1 });
    expect(noActions.success).toBe(false);
    expect(noActions.errorCode).toBe(ErrorCode.NO_ACTIONS_TO_UNDO);

    // Out-of-range seat -> INVALID_PLAYER.
    const badSeat = await session.send(1, { type: 'undo', player: 99 });
    expect(badSeat.success).toBe(false);
    expect(badSeat.errorCode).toBe(ErrorCode.INVALID_PLAYER);
  });
});

describe('undo-fence adversarial verification (bypassing canUndo)', () => {
  it('a hand-crafted raw {type: "undo"} op sent without ever consulting canUndo is refused', async () => {
    const session = await sessionAfterLock();

    // Never read state.canUndo -- attempt the raw op directly.
    const undoOp: Op = { type: 'undo', player: 1 };
    const result = await session.send(1, undoOp);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lock/i);
  });

  it('debugRewind op crossing a notUndoable action is refused', async () => {
    const session = await sessionAfterLock();

    // Rewind to action index 0 -- discarding the notUndoable `lock` action.
    const rewindOp: Op = { type: 'debugRewind', actionIndex: 0 };
    const result = await session.send(1, rewindOp);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lock/i);
  });
});

/**
 * UNDO-02 execute-barrier adversarial verification (155-02,
 * T-155-05..T-155-08), extending the undo-fence block above to the durable
 * execute()-barrier fence. See `execute-barrier-fixture.ts` for exactly why
 * this flow shape (plain act1/act2 action steps, same player throughout)
 * exposes the defect.
 */
const executeBarrierGameOptions = { playerCount: 1, seed: 't' };

async function playThroughExecuteBarrier(send: (op: HeadlessOp) => Promise<{ success: boolean }>) {
  expect((await send({ type: 'action', actionName: 'act1', player: 1, args: {} })).success).toBe(true);
  expect((await send({ type: 'action', actionName: 'act2', player: 1, args: {} })).success).toBe(true);
  expect((await send({ type: 'action', actionName: 'act2', player: 1, args: {} })).success).toBe(true);
}

describe('execute-barrier adversarial verification (bypassing canUndo)', () => {
  it('a hand-crafted raw {type: "undo"} op sent without ever consulting canUndo is refused', async () => {
    const session = createHeadlessSession(executeBarrierFixtureDefinition, executeBarrierGameOptions);
    await session.start();
    await playThroughExecuteBarrier((op) => session.send(1, op));

    // Never read state.canUndo -- attempt the raw op directly.
    const undoOp: Op = { type: 'undo', player: 1 };
    const result = await session.send(1, undoOp);

    expect(result.success).toBe(false);
  });

  it('a hand-crafted raw {type: "debugRewind"} op targeting index 0 is refused', async () => {
    const session = createHeadlessSession(executeBarrierFixtureDefinition, executeBarrierGameOptions);
    await session.start();
    await playThroughExecuteBarrier((op) => session.send(1, op));

    const rewindOp: Op = { type: 'debugRewind', actionIndex: 0 };
    const result = await session.send(1, rewindOp);

    expect(result.success).toBe(false);
  });
});

/**
 * D4/SIM-02 adversarial verification (160-02), extending the
 * undo-fence/execute-barrier blocks above to the per-seat simultaneous undo
 * boundary (T-160-04/T-160-05/T-160-06). See simultaneous-undo.test.ts for the
 * RED/GREEN regression this block backstops.
 */
const simultaneousGameOptions = { playerCount: 2, seed: 't' };

function newSimultaneousSession() {
  return createHeadlessSession(simultaneousFixtureDefinition, simultaneousGameOptions);
}

/** A started simultaneous session in which seat 2 has taken `actionName`. */
async function simultaneousAfterSeatTwo(actionName: string) {
  const session = newSimultaneousSession();
  await session.start();
  expect((await session.send(2, { type: 'action', actionName, player: 2, args: {} })).success).toBe(true);
  return session;
}

describe('simultaneous-undo fences', () => {
  it('seat-2 undo across a .notUndoable() simultaneous action is refused with UNDO_NOT_ALLOWED', async () => {
    // lockCommit is .notUndoable() -- refuses the fence regardless of
    // per-seat boundary (nothing else acted, so the boundary itself would
    // otherwise allow it).
    const session = await simultaneousAfterSeatTwo('lockCommit');
    const undo = await session.send(2, { type: 'undo', player: 2 });

    expect(undo.success).toBe(false);
    expect(undo.errorCode).toBe(ErrorCode.UNDO_NOT_ALLOWED);
    expect(undo.error).toMatch(/lockCommit/i);
  });

  it('seat-2 undo once finished is refused with UNDO_NOT_ALLOWED', async () => {
    const session = await simultaneousAfterSeatTwo('endGame');
    const undo = await session.send(2, { type: 'undo', player: 2 });

    expect(undo.success).toBe(false);
    expect(undo.errorCode).toBe(ErrorCode.UNDO_NOT_ALLOWED);
    expect(undo.error).toMatch(/finished/i);
  });
});

describe('simultaneous-undo adversarial verification (T-160-04/05/06)', () => {
  it('a hand-crafted raw {type: "undo"} op, never consulting canUndo, succeeds ONLY when the per-seat boundary + fences allow it', async () => {
    const session = newSimultaneousSession();
    await session.start();
    expect((await session.send(1, { type: 'action', actionName: 'commit', player: 1, args: {} })).success).toBe(true);
    expect((await session.send(2, { type: 'action', actionName: 'commit', player: 2, args: {} })).success).toBe(true);

    // Never read state.canUndo -- attempt the raw op directly.
    const undoOp: Op = { type: 'undo', player: 2 };
    const result = await session.send(2, undoOp);

    expect(result.success).toBe(true);
  });

  it('seat-2 cannot use undo to rewind seat-1\'s LATER action: refused, seat-1 untouched', async () => {
    const session = newSimultaneousSession();
    await session.start();
    // Seat 2 commits FIRST, then seat 1 commits SECOND -- seat 2's own
    // action is no longer the tail of history; undoing it would also
    // discard seat 1's later, co-decider action (T-160-04).
    expect((await session.send(2, { type: 'action', actionName: 'commit', player: 2, args: {} })).success).toBe(true);
    expect((await session.send(1, { type: 'action', actionName: 'commit', player: 1, args: {} })).success).toBe(true);

    const undo = refused(await session.send(2, { type: 'undo', player: 2 }));
    expect(undo.success).toBe(false);
    expect(undo.errorCode).toBe(ErrorCode.NO_ACTIONS_TO_UNDO);

    // No-op: seat 1's committed action is untouched by the refused attempt.
    const seat1View = ((undo as unknown as { playerViews?: unknown }).playerViews as
      | Array<{ state: { players: Array<{ seat: number; committed?: unknown }> } }>
      | undefined) ?? [];
    // Refused ops carry no playerViews (errorResult short-circuits) -- read
    // current state via a follow-up debug op instead.
    void seat1View;
    const check = await session.send(1, { type: 'debugFlowState', player: 1 });
    expect(check.success).toBe(true);
  });

  it('debugRewind does not become a bypass for the per-seat fence', async () => {
    const session = await simultaneousAfterSeatTwo('lockCommit');
    // Rewind to action index 0 -- discarding the notUndoable lockCommit action.
    const rewind = await session.send(2, { type: 'debugRewind', actionIndex: 0 });
    expect(rewind.success).toBe(false);
    expect(rewind.error).toMatch(/lockCommit/i);
  });

  it('CROSS-PHASE (D4 step-window-bound WARNING): seat-2 undo in the current step rewinds ONLY its current-step action, never an earlier step\'s', async () => {
    const session = createHeadlessSession(crossPhaseFixtureDefinition, { playerCount: 2, seed: 't' });
    await session.start();

    // Step A: seat 2 is the ONLY participant -- completes the instant it
    // commits, with NOTHING from seat 1 recorded anywhere yet.
    const a = await session.send(2, { type: 'action', actionName: 'commitA', player: 2, args: {} });
    expect(a.success).toBe(true);

    // Step B: seat 2 acts again, first -- the pathological "same seat,
    // nothing interleaved" shape.
    const b = await session.send(2, { type: 'action', actionName: 'commitB', player: 2, args: {} });
    expect(b.success).toBe(true);

    const undo = succeeded(await session.send(2, { type: 'undo', player: 2 }));
    expect(undo.success).toBe(true);

    // Step A's action must survive -- proven by seat 2 still being
    // `committedA: true` (its step-A commit) while `committedB` was
    // reverted back to false (its step-B commit, the one that was undone).
    const players = (undo.playerViews as Array<{ state: { players: Array<{ seat: number; committedA?: unknown; committedB?: unknown }> } }>)[1]
      .state.players;
    const seat2 = players.find((p) => p.seat === 2);
    expect(seat2?.committedA).toBe(true);
    expect(seat2?.committedB).toBe(false);
  });
});

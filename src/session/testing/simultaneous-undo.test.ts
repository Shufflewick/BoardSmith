import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { simultaneousFixtureDefinition, CommitGame } from './fixtures/simultaneous-fixture.js';
import { GameSession } from '../game-session.js';
import type { Op } from '../stateless-ops.js';
import { ErrorCode } from '../../types/protocol.js';

/**
 * D4/SIM-02 regression + parity: a simultaneous-step undo is pinned to
 * `flowState.currentPlayer` (which the engine's `game.currentPlayer` default
 * leaves resolved to seat 1, never advancing during a simultaneous step) so
 * any OTHER awaiting seat cannot undo its own committed action. This suite
 * drives the shared `simultaneous-fixture.ts` (Plan 01) through BOTH
 * executors and proves:
 *  - seat-2 can undo its own committed action even though it is not
 *    `flowState.currentPlayer`,
 *  - seat-1's committed action (and its `committed` flag) is untouched,
 *  - the stateful twin (`GameSession.undoToTurnStart`) agrees,
 *  - Phase 155's finished-phase fence still refuses per-seat,
 *  - seat-1's own simultaneous undo keeps working (negative control).
 */

const gameOptions = { playerCount: 2, seed: 't' };

function newStatelessSession() {
  return createHeadlessSession(simultaneousFixtureDefinition, gameOptions);
}

function newStatefulSession() {
  return GameSession.create<CommitGame>({
    gameType: 'simultaneous',
    GameClass: CommitGame,
    playerCount: 2,
    playerNames: ['A', 'B'],
    seed: 't',
  });
}

/** Read seat N's `committed` flag off a stateless op result's player view. */
function committedFlag(playerViews: unknown, seat: number): unknown {
  const view = (playerViews as Array<{ state: { players: Array<{ seat: number; committed?: unknown }> } }>)[seat - 1];
  return view.state.players.find((p) => p.seat === seat)?.committed;
}

describe('simultaneous undo (D4/SIM-02): non-currentPlayer seat can undo its own commit', () => {
  it('stateless: seat-2 can undo its own committed simultaneous action', async () => {
    const session = newStatelessSession();
    await session.start();

    const c1 = await session.send(1, { type: 'action', actionName: 'commit', player: 1, args: {} });
    expect(c1.success).toBe(true);
    const c2 = await session.send(2, { type: 'action', actionName: 'commit', player: 2, args: {} });
    expect(c2.success).toBe(true);

    // Pre-fix this is REFUSED: the currentPlayer pin (`flowState.currentPlayer`
    // resolves to seat 1, never seat 2, during a simultaneous step).
    const undo = await session.send(2, { type: 'undo', player: 2 } as Op);
    expect(undo.success).toBe(true);

    // Seat-2 is awaiting again (its own commit was reverted); seat-1's commit
    // is untouched.
    const flowState = undo.flowState as { awaitingPlayers?: Array<{ playerIndex: number; completed: boolean }> };
    const seat1Awaiting = flowState.awaitingPlayers?.find((p) => p.playerIndex === 1);
    const seat2Awaiting = flowState.awaitingPlayers?.find((p) => p.playerIndex === 2);
    expect(seat1Awaiting?.completed).toBe(true);
    expect(seat2Awaiting?.completed).toBe(false);

    expect(committedFlag(undo.playerViews, 1)).toBe(true);
    expect(committedFlag(undo.playerViews, 2)).toBe(false);
  });

  it('stateful: undoToTurnStart(2) can undo seat-2\'s own committed simultaneous action', async () => {
    const session = newStatefulSession();

    const c1 = await session.performAction('commit', 1, {});
    expect(c1.success).toBe(true);
    const c2 = await session.performAction('commit', 2, {});
    expect(c2.success).toBe(true);

    const undo = await session.undoToTurnStart(2);
    expect(undo.success).toBe(true);

    const flowState = undo.flowState as { awaitingPlayers?: Array<{ playerIndex: number; completed: boolean }> };
    const seat1Awaiting = flowState.awaitingPlayers?.find((p) => p.playerIndex === 1);
    const seat2Awaiting = flowState.awaitingPlayers?.find((p) => p.playerIndex === 2);
    expect(seat1Awaiting?.completed).toBe(true);
    expect(seat2Awaiting?.completed).toBe(false);
  });

  it('negative control: seat-1\'s own simultaneous undo still works', async () => {
    const session = newStatelessSession();
    await session.start();

    const c1 = await session.send(1, { type: 'action', actionName: 'commit', player: 1, args: {} });
    expect(c1.success).toBe(true);

    const undo = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(undo.success).toBe(true);

    const flowState = undo.flowState as { awaitingPlayers?: Array<{ playerIndex: number; completed: boolean }> };
    const seat1Awaiting = flowState.awaitingPlayers?.find((p) => p.playerIndex === 1);
    expect(seat1Awaiting?.completed).toBe(false);
  });

  it('fence still holds: undo is refused once the game is finished, per seat', async () => {
    const session = newStatelessSession();
    await session.start();

    const c1 = await session.send(1, { type: 'action', actionName: 'commit', player: 1, args: {} });
    expect(c1.success).toBe(true);
    // Seat-2 ends the game from within the same simultaneous step instead of
    // committing -- reaches game.isFinished() without ever hand-mutating
    // game.phase (mirrors undo-fence-fixture's endGame pattern).
    const end = await session.send(2, { type: 'action', actionName: 'endGame', player: 2, args: {} });
    expect(end.success).toBe(true);

    const undo = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(undo.success).toBe(false);
    expect(undo.errorCode).toBe(ErrorCode.UNDO_NOT_ALLOWED);
    expect(undo.error).toMatch(/finished/i);
  });
});

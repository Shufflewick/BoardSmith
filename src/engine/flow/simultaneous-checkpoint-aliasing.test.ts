import { describe, it, expect } from 'vitest';
import { CommitGame } from '../../session/testing/fixtures/simultaneous-fixture.js';

/**
 * SIM-01 / D3 regression: `FlowEngine.getState()` (`engine.ts:619`) returns
 * the private `awaitingPlayers` array BY REFERENCE. Per-seat `completed`
 * lives only on that transient array and is mutated in place by
 * `resumeSimultaneousAction` (`engine.ts:569/584`) — so any earlier
 * `FlowState` captured via `getState()` (including every `ActionCheckpoint`,
 * which stores `getState()`'s return un-cloned per `snapshot.ts:236`)
 * retroactively shows the LATER, flipped value instead of the value that
 * was actually live at capture time.
 *
 * Uses the shared `simultaneous-fixture.ts` (`CommitGame`, 2 seats) driven
 * directly via the public `Game` flow API (`startFlow`/`continueFlow`/
 * `getFlowState`/`restoreFlowState`) so the captured `FlowState` is exactly
 * what an `ActionCheckpoint` would store, and "undo" is exactly the
 * engine-layer restore an undo executor performs.
 */
describe('SIM-01 / D3: getState() awaitingPlayers checkpoint aliasing', () => {
  it('a checkpoint captured before seat 2 completes still reports seat 2 completed:false after the flip', () => {
    const game = new CommitGame({ playerCount: 2, seed: 't' });
    game.startFlow();

    // Seat 1 commits first -- seat 2 is still awaiting, not completed.
    game.continueFlow('commit', {}, 1);

    // Capture "the checkpoint" exactly as createActionCheckpoint would:
    // game.getFlowState() -> FlowEngine.getState().
    const capturedAfterSeat1 = game.getFlowState();
    const seat2AtCapture = capturedAfterSeat1?.awaitingPlayers?.find((p) => p.playerIndex === 2);
    expect(seat2AtCapture?.completed).toBe(false);

    // Seat 2 now commits, flipping ITS OWN completed flag on the live
    // private awaitingPlayers array.
    game.continueFlow('commit', {}, 2);

    // BUG (pre-fix): capturedAfterSeat1 is the SAME array object handed back
    // by getState() -- seat 2's flip retroactively rewrites the earlier
    // "checkpoint" to show completed:true, even though seat 2 had not yet
    // acted when this reference was captured.
    const seat2AfterLaterFlip = capturedAfterSeat1?.awaitingPlayers?.find((p) => p.playerIndex === 2);
    expect(seat2AfterLaterFlip?.completed).toBe(false);
  });

  it('undo (restoreFlowState) back across a flipped completed resolves to a well-formed awaiting state, not a stranded seat', () => {
    const game = new CommitGame({ playerCount: 2, seed: 't' });
    game.startFlow();

    // Seat 1 commits; capture the state right here as the "undo target".
    game.continueFlow('commit', {}, 1);
    const checkpoint = game.getFlowState();
    expect(checkpoint).toBeDefined();

    // Seat 2 commits too, flipping completed on the (aliased, pre-fix) array
    // that `checkpoint` still references.
    game.continueFlow('commit', {}, 2);

    // "Undo": restore the engine to the captured checkpoint.
    game.restoreFlowState(checkpoint!);

    // The restored state must show seat 2 awaiting again (completed:false)
    // -- not stranded showing seat 2 already completed (the aliasing
    // corruption: the checkpoint was never really "seat 1 only", it silently
    // became "both seats" by the time it was restored).
    const restoredSeat2 = game.getFlowState()?.awaitingPlayers?.find((p) => p.playerIndex === 2);
    expect(restoredSeat2?.completed).toBe(false);

    // And seat 2 must actually be able to act again post-restore -- proof
    // the restored awaiting state is genuinely usable, not just cosmetically
    // "false" while the engine still refuses the seat.
    const secondCommit = game.continueFlow('commit', {}, 2);
    expect(secondCommit.actionError).toBeUndefined();
  });

  it('negative control: an ordinary two-seat step where both seats act and allDone naturally becomes true still completes exactly once', () => {
    const game = new CommitGame({ playerCount: 2, seed: 't' });
    game.startFlow();

    game.continueFlow('commit', {}, 1);
    // The round-closing condition arrives once both seats have acted --
    // seat 2's own action is what naturally re-evaluates allDone to true.
    game.roundClosed = true;
    const result = game.continueFlow('commit', {}, 2);

    expect(result.actionError).toBeUndefined();
    expect(result.awaitingInput).toBe(false);
    expect(result.complete).toBe(true);
  });
});

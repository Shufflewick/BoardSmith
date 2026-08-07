import { describe, it, expect } from 'vitest';
import { GameSession } from '../game-session.js';
import { CollectTurnsGame } from './fixtures/collect-turns-fixture.js';

/**
 * Stateful-session time-travel/rewind contract (StateHistory.getStateAtAction,
 * getStateDiff, rewindToAction). Mirrors the authoritative-undo test but for the
 * debug-panel time-travel paths.
 *
 * Proves these paths restore state AUTHORITATIVELY from per-action checkpoints
 * (GameRunner.fromSnapshot) rather than replaying actionHistory. Replay re-runs
 * start() + recorded actions only; the `collect` pending-action mutation
 * (Piece.putInto, recorded in NEITHER command nor action history) is invisible to
 * replay, so the OLD replay-based time-travel silently showed a board where the
 * collected equipment was never picked up — a state that never existed. The
 * checkpoint at the matching action count captures that trailing mutation, so the
 * fixed paths show the true historical board.
 *
 * checkpoint[2] is the discriminator: `explore` is recorded (action count 1),
 * then the `collect` selection step runs — it puts the item into held-1 AND (per
 * audit fix F43) is itself recorded as action count 2. So checkpoint[2] reflects
 * the item in held-1, while checkpoint[1] (post-explore, pre-collect) does not.
 * The collect mutation (Piece.putInto) is still recorded in NEITHER command
 * history nor — for the element move — anywhere a pure replay could reconstruct
 * the exact prior-turn board, so the authoritative checkpoint remains the source
 * of truth for time-travel.
 */

/** Children ids of the first node named `nodeName`, walking a view tree. */
function viewChildIds(view: unknown, nodeName: string): number[] {
  const walk = (node: any): any => {
    if (node?.name === nodeName) return node;
    for (const c of node?.children ?? []) {
      const found = walk(c);
      if (found) return found;
    }
    return null;
  };
  const node = walk(view);
  return (node?.children ?? []).map((c: any) => c.id as number);
}

async function buildSessionWithCollectedItem() {
  const session = GameSession.create<CollectTurnsGame>({
    gameType: 'collect-turns',
    GameClass: CollectTurnsGame,
    playerCount: 2,
    playerNames: ['A', 'B'],
    seed: 't',
  });

  // Turn 1 (player 1): explore, then collect one item into held-1.
  const explore = await session.performAction('explore', 1, {});
  expect(explore.success).toBe(true);
  const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

  const choices = session.getPickChoices('collect', 'item', 1, followUpArgs);
  const collectedId = ((choices.validElements as Array<{ id: number }>) ?? [])[0].id;

  const collect = await session.processSelectionStep(1, 'item', collectedId, 'collect', followUpArgs);
  expect(collect.success).toBe(true);
  expect(collect.actionComplete).toBe(true);
  expect(viewChildIds(session.runner.getSnapshot().state, 'held-1')).toContain(collectedId);

  // Advance a few more recorded actions so there's history to time-travel within.
  expect((await session.performAction('pass', 1, {})).success).toBe(true);
  expect((await session.performAction('pass', 2, {})).success).toBe(true);
  expect((await session.performAction('pass', 2, {})).success).toBe(true);

  return { session, collectedId };
}

describe('stateful time-travel across a pending mutation', () => {
  it('getStateAtAction shows the collected equipment at the action count where it was picked up', async () => {
    const { session, collectedId } = await buildSessionWithCollectedItem();

    // Action count 1 is post-`explore`, pre-`collect`: held-1 is still empty.
    const before = session.getStateAtAction(1, 1);
    expect(before.success).toBe(true);
    expect(viewChildIds(before.state!.view, 'held-1')).not.toContain(collectedId);

    // Action count 2 is right after `collect` is recorded (F43): the checkpoint
    // captures the Piece.putInto, so the collected item is in held-1.
    const result = session.getStateAtAction(2, 1);
    expect(result.success).toBe(true);
    expect(viewChildIds(result.state!.view, 'held-1')).toContain(collectedId);
  });

  it('getStateDiff does not report the collected piece as added between two post-collect points', async () => {
    const { session, collectedId } = await buildSessionWithCollectedItem();

    // Between action counts 2 and 3 the item is already in held-1 at BOTH points
    // (collect recorded at count 2; a `pass` recorded at count 3 doesn't move it),
    // so it must not appear in the diff.
    const diff = session.getStateDiff(2, 3, 1);
    expect(diff.success).toBe(true);
    expect(diff.diff!.added).not.toContain(collectedId);
    expect(diff.diff!.removed).not.toContain(collectedId);

    // Sanity: at count 2 the piece is genuinely present in the view we diffed from.
    const at2 = session.getStateAtAction(2, 1);
    expect(viewChildIds(at2.state!.view, 'held-1')).toContain(collectedId);
  });

  // The turn-advance `execute()` in `collect-turns-fixture.ts` only flips
  // `activeSeat` -- pure flow bookkeeping, which a checkpoint restore
  // reproduces exactly. Under UNDO-02's opt-in commitment fence it is NOT
  // marked `{ irreversible: true }`, so it does not fence anything and this
  // rewind is ALLOWED.
  //
  // This assertion is the inverse of what it was while EVERY `execute()` node
  // fenced undo. That blanket rule made the fence fire on bookkeeping — a game
  // with one turn-advance execute() (i.e. most games) could never rewind past
  // the current turn, which is not what the fence is for. It exists for effects
  // a restore cannot honestly take back, above all information a human has
  // already seen. See `ExecuteConfig.irreversible`, and the marked fixture in
  // `execute-barrier-fixture.ts` for the fence's own coverage.
  it('rewindToAction crosses a bookkeeping (unmarked) execute() and restores authoritatively', async () => {
    const { session, collectedId } = await buildSessionWithCollectedItem();

    const rewind = await session.rewindToAction(2);
    expect(rewind.success).toBe(true);

    // Not just "allowed" — the restore is authoritative: the collected piece
    // is back in held-1 exactly as it stood at action count 2.
    const view = session.buildPlayerState(1).view;
    expect(viewChildIds(view, 'held-1')).toContain(collectedId);
  });

  it('rewindToAction restores the collected equipment when the target does not cross an execute() barrier', async () => {
    const session = GameSession.create<CollectTurnsGame>({
      gameType: 'collect-turns',
      GameClass: CollectTurnsGame,
      playerCount: 2,
      playerNames: ['A', 'B'],
      seed: 't',
    });

    // Turn 1 (player 1): explore, then collect one item into held-1 (action
    // counts 1 and 2).
    const explore = await session.performAction('explore', 1, {});
    expect(explore.success).toBe(true);
    const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;
    const choices = session.getPickChoices('collect', 'item', 1, followUpArgs);
    const collectedId = ((choices.validElements as Array<{ id: number }>) ?? [])[0].id;
    const collect = await session.processSelectionStep(1, 'item', collectedId, 'collect', followUpArgs);
    expect(collect.success).toBe(true);

    // Finish turn 1 (action count 3). This `pass` is the turn's ENDING move --
    // it's what triggers the fixture's turn-advance `execute()`, setting the
    // barrier to 3.
    const pass1 = await session.performAction('pass', 1, {});
    expect(pass1.success).toBe(true);

    // One more action so there's a later point to rewind FROM (rewindToAction
    // refuses to "rewind forward" to the current tip).
    const pass2 = await session.performAction('pass', 2, {});
    expect(pass2.success).toBe(true);

    // Rewind to action index 3 -- exactly AT the barrier, not before it: the
    // barrier was set by this SAME turn's ending action, and the collected
    // item was recorded earlier (index 2), well before the barrier. This must
    // succeed and the restored runner must still hold the collected item --
    // replay-based rewind would resurrect a runner with held-1 empty.
    const rewind = await session.rewindToAction(3);
    expect(rewind.success).toBe(true);
    expect(viewChildIds(session.runner.getSnapshot().state, 'held-1')).toContain(collectedId);
  });
});

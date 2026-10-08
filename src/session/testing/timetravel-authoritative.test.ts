import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { collectTurnsFixtureDefinition } from './fixtures/collect-turns-fixture.js';
import { succeeded } from '../op-result.test-helper.js';

/**
 * Time-travel/rewind contract for the debug panel's ops (`debugStateAt`,
 * `debugStateDiff`, `debugRewind`), driven through the SnapshotSessionHost +
 * executeOp round-trip every host uses.
 *
 * Proves these ops restore state AUTHORITATIVELY from per-action checkpoints
 * rather than replaying actionHistory. Replay re-runs start() + recorded
 * actions only; the `collect` pending-action mutation (Piece.putInto, recorded
 * in NEITHER command nor action history) is invisible to replay, so a
 * replay-based time-travel would show a board where the collected equipment
 * was never picked up, a state that never existed. The checkpoint at the
 * matching action count captures that trailing mutation, so these ops show the
 * true historical board.
 *
 * checkpoint[2] is the discriminator: `explore` is recorded (action count 1),
 * then the `collect` selection step runs. It puts the item into held-1 AND
 * (per audit fix F43) is itself recorded as action count 2. So checkpoint[2]
 * reflects the item in held-1, while checkpoint[1] (post-explore,
 * pre-collect) does not.
 */

type HeadlessTable = ReturnType<typeof createHeadlessSession>;

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

async function pass(session: HeadlessTable, seat: number): Promise<void> {
  succeeded(await session.send(seat, { type: 'action', actionName: 'pass', player: seat, args: {} }));
}

/** Player 1 explores, then collects one item into held-1 (action counts 1 and 2). */
async function startAndCollect(): Promise<{ session: HeadlessTable; collectedId: number }> {
  const session = createHeadlessSession(collectTurnsFixtureDefinition, {
    playerCount: 2,
    playerNames: ['A', 'B'],
    seed: 't',
  });
  await session.start();

  const explore = succeeded(await session.send(1, { type: 'action', actionName: 'explore', player: 1, args: {} }));
  const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

  const choices = succeeded(await session.send(1, {
    type: 'resolveChoices', actionName: 'collect', selectionName: 'item', player: 1, args: followUpArgs,
  }));
  const collectedId = ((choices.validElements as Array<{ id: number }>) ?? [])[0].id;

  const collect = succeeded(await session.send(1, {
    type: 'selectionStep', player: 1, selectionName: 'item', value: collectedId,
    actionName: 'collect', initialArgs: followUpArgs,
  }));
  expect(collect.actionComplete).toBe(true);
  expect(viewChildIds(session.playerState(1).view, 'held-1')).toContain(collectedId);

  return { session, collectedId };
}

async function buildSessionWithCollectedItem() {
  const built = await startAndCollect();
  // Advance a few more recorded actions so there's history to time-travel within.
  await pass(built.session, 1);
  await pass(built.session, 2);
  await pass(built.session, 2);
  return built;
}

describe('time-travel across a pending mutation', () => {
  it('debugStateAt shows the collected equipment at the action count where it was picked up', async () => {
    const { session, collectedId } = await buildSessionWithCollectedItem();

    // Action count 1 is post-`explore`, pre-`collect`: held-1 is still empty.
    const before = succeeded(await session.send(1, { type: 'debugStateAt', actionIndex: 1, player: 1 }));
    expect(viewChildIds((before.historicalState as { view: unknown }).view, 'held-1')).not.toContain(collectedId);

    // Action count 2 is right after `collect` is recorded (F43): the checkpoint
    // captures the Piece.putInto, so the collected item is in held-1.
    const after = succeeded(await session.send(1, { type: 'debugStateAt', actionIndex: 2, player: 1 }));
    expect(viewChildIds((after.historicalState as { view: unknown }).view, 'held-1')).toContain(collectedId);
  });

  it('debugStateDiff does not report the collected piece as added between two post-collect points', async () => {
    const { session, collectedId } = await buildSessionWithCollectedItem();

    // Between action counts 2 and 3 the item is already in held-1 at BOTH points
    // (collect recorded at count 2; a `pass` recorded at count 3 doesn't move it),
    // so it must not appear in the diff.
    const result = succeeded(await session.send(1, { type: 'debugStateDiff', fromIndex: 2, toIndex: 3, player: 1 }));
    const diff = result.diff as { added: number[]; removed: number[] };
    expect(diff.added).not.toContain(collectedId);
    expect(diff.removed).not.toContain(collectedId);

    // Sanity: at count 2 the piece is genuinely present in the view we diffed from.
    const at2 = succeeded(await session.send(1, { type: 'debugStateAt', actionIndex: 2, player: 1 }));
    expect(viewChildIds((at2.historicalState as { view: unknown }).view, 'held-1')).toContain(collectedId);
  });

  // The turn-advance `execute()` in `collect-turns-fixture.ts` only flips
  // `activeSeat` -- pure flow bookkeeping, which a checkpoint restore
  // reproduces exactly. Under UNDO-02's opt-in commitment fence it is NOT
  // marked `{ irreversible: true }`, so it does not fence anything and this
  // rewind is ALLOWED.
  //
  // The fence exists for effects a restore cannot honestly take back, above
  // all information a human has already seen. See `ExecuteConfig.irreversible`,
  // and the marked fixture in `execute-barrier-fixture.ts` for the fence's own
  // coverage.
  it('debugRewind crosses a bookkeeping (unmarked) execute() and restores authoritatively', async () => {
    const { session, collectedId } = await buildSessionWithCollectedItem();

    succeeded(await session.send(1, { type: 'debugRewind', actionIndex: 2 }));

    // Not just "allowed" -- the restore is authoritative: the collected piece
    // is back in held-1 exactly as it stood at action count 2.
    expect(viewChildIds(session.playerState(1).view, 'held-1')).toContain(collectedId);
  });

  it('debugRewind restores the collected equipment when the target is the turn-ending action', async () => {
    const { session, collectedId } = await startAndCollect();

    // Finish turn 1 (action count 3). This `pass` is the turn's ENDING move --
    // it's what triggers the fixture's turn-advance `execute()`.
    await pass(session, 1);

    // One more action so there's a later point to rewind FROM (a rewind to
    // the current tip is refused).
    await pass(session, 2);

    // Rewind to action index 3, the turn's ending action. The collected item
    // was recorded earlier (index 2), so the restored game must still hold it
    // -- a replay-based rewind would resurrect a game with held-1 empty.
    succeeded(await session.send(1, { type: 'debugRewind', actionIndex: 3 }));
    expect(viewChildIds(session.playerState(1).view, 'held-1')).toContain(collectedId);
  });
});

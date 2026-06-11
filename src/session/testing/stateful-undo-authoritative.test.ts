import { describe, it, expect } from 'vitest';
import { GameSession } from '../game-session.js';
import { CollectTurnsGame } from './fixtures/collect-turns-fixture.js';

/**
 * Stateful-session undo contract (StateHistory.undoToTurnStart). Mirrors the
 * stateless undo-authoritative test but exercises the in-memory GameSession path
 * (game-session.ts + state-history.ts) used by BoardSmith's standalone
 * server/worker. Proves undoing the current turn preserves a prior turn's
 * pending-action mutation (collect → Piece.putInto, recorded in neither command
 * nor action history) — which replay-based undo loses (and mis-positions the
 * flow, throwing "Not Player N's turn").
 */

function spaceChildIds(snapshot: unknown, spaceName: string): number[] {
  const walk = (node: any): any => {
    if (node?.name === spaceName) return node;
    for (const c of node?.children ?? []) {
      const found = walk(c);
      if (found) return found;
    }
    return null;
  };
  const space = walk((snapshot as { state?: unknown })?.state);
  return (space?.children ?? []).map((c: any) => c.id as number);
}

describe('stateful undo across a prior pending mutation', () => {
  it('undoToTurnStart preserves equipment collected on an earlier turn', async () => {
    const session = GameSession.create<CollectTurnsGame>({
      gameType: 'collect-turns',
      GameClass: CollectTurnsGame,
      playerCount: 2,
      playerNames: ['A', 'B'],
      seed: 't',
    });

    // ── Turn 1 (player 1): explore, then collect one item into held-1 ─────────
    const explore = await session.performAction('explore', 1, {});
    expect(explore.success).toBe(true);
    const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

    const choices = session.getPickChoices('collect', 'item', 1, followUpArgs);
    const collectedId = ((choices.validElements as Array<{ id: number }>) ?? [])[0].id;

    const collect = await session.processSelectionStep(1, 'item', collectedId, 'collect', followUpArgs);
    expect(collect.success).toBe(true);
    expect(collect.actionComplete).toBe(true);
    expect(spaceChildIds(session.runner.getSnapshot(), 'held-1')).toContain(collectedId);

    // Player 1's second action, then player 2's whole turn, back to player 1.
    expect((await session.performAction('pass', 1, {})).success).toBe(true);
    expect((await session.performAction('pass', 2, {})).success).toBe(true);
    expect((await session.performAction('pass', 2, {})).success).toBe(true);

    // ── Turn 3 (player 1): take the first action, then undo it ────────────────
    const p1turn3 = await session.performAction('pass', 1, {});
    expect(p1turn3.success).toBe(true);
    expect((p1turn3.flowState as any)?.currentPlayer).toBe(1);

    const undo = await session.undoToTurnStart(1);
    expect(undo.success).toBe(true);

    // The earlier-turn equipment MUST still be in held-1 after the undo.
    expect(spaceChildIds(session.runner.getSnapshot(), 'held-1')).toContain(collectedId);
  });
});

import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from './headless-harness.js';
import { collectTurnsFixtureDefinition } from './fixtures/collect-turns-fixture.js';
import type { Op } from '../stateless-ops.js';

/**
 * Authoritative-undo contract. Drives the SAME SnapshotSessionHost + executeOp
 * snapshot round-trip production uses, through real turn boundaries, and proves
 * that undoing the CURRENT turn does not destroy a PRIOR turn's pending-action
 * mutation (equipment collected via the selection-step path, moved with
 * Piece.putInto — recorded in neither command nor action history).
 *
 * Replay-based undo replays actionHistory[0:turnStart] from start(), which never
 * re-runs the pending collect, so the prior-turn equipment "drops back" to the
 * stash. Authoritative undo restores the turn-start checkpoint directly.
 */

const gameOptions = { playerCount: 2, seed: 't' };

type ValidElement = { id: number; display?: string };

/** Collect the ids of the pieces inside a named space, given a result snapshot
 *  envelope (the element tree lives at `snapshot.state`). */
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

function currentPlayer(result: { flowState: unknown }): number | undefined {
  return (result.flowState as { currentPlayer?: number } | undefined)?.currentPlayer;
}

describe('authoritative undo across a prior pending mutation', () => {
  it('undoing the current turn preserves equipment collected on an earlier turn', async () => {
    const session = createHeadlessSession(collectTurnsFixtureDefinition, gameOptions);
    await session.start();

    // ── Turn 1 (player 1): explore, then collect one item into held-1 ─────────
    const explore = await session.send(1, { type: 'action', actionName: 'explore', player: 1, args: {} });
    expect(explore.success).toBe(true);
    const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

    const choices = await session.send(1, {
      type: 'resolveChoices', actionName: 'collect', player: 1, selectionName: 'item', args: {},
    });
    expect(choices.success).toBe(true);
    const collectedId = ((choices.validElements as ValidElement[]) ?? [])[0].id;

    const collect = await session.send(1, {
      type: 'selectionStep', player: 1, selectionName: 'item', value: collectedId,
      actionName: 'collect', initialArgs: followUpArgs,
    } as Op);
    expect(collect.success).toBe(true);
    expect(collect.actionComplete).toBe(true);
    // Sanity: the item is now in held-1, not the stash.
    expect(spaceChildIds(collect.snapshot, 'held-1')).toContain(collectedId);

    // Player 1's second action of the turn, then play out player 2's whole turn,
    // returning control to player 1 for a fresh turn.
    const p1pass = await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });
    expect(p1pass.success).toBe(true);
    expect(currentPlayer(p1pass)).toBe(2);

    const p2a = await session.send(2, { type: 'action', actionName: 'pass', player: 2, args: {} });
    expect(p2a.success).toBe(true);
    const p2b = await session.send(2, { type: 'action', actionName: 'pass', player: 2, args: {} });
    expect(p2b.success).toBe(true);
    expect(currentPlayer(p2b)).toBe(1);

    // ── Turn 3 (player 1 again): take the first action, then undo it ──────────
    const p1turn3 = await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });
    expect(p1turn3.success).toBe(true);
    expect(currentPlayer(p1turn3)).toBe(1); // still player 1's turn (second actionStep pending)

    const undo = await session.send(1, { type: 'undo', player: 1 });
    expect(undo.success).toBe(true);

    // The earlier-turn equipment MUST still be in held-1 after the undo.
    expect(spaceChildIds(undo.snapshot, 'held-1')).toContain(collectedId);
  });
});

import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { collectTurnsFixtureDefinition } from './fixtures/collect-turns-fixture.js';
import {
  Game,
  Player,
  Action,
  defineFlow,
  sequence,
  actionStep,
  execute,
  loop,
  type GameOptions,
} from '../../engine/index.js';
import type { GameDefinitionLike, Op } from '../stateless-ops.js';

/**
 * Authoritative-undo contract. Drives the SAME SnapshotSessionHost + executeOp
 * snapshot round-trip production uses.
 *
 * 155-03 CONTRACT CHANGE (CONTEXT D-06, deliberate -- NOT a regression):
 * `moveCount` is scoped to the currently active action-STEP frame, not to a
 * logical player turn that may span several frames (155-RESEARCH.md §B).
 * `collect-turns-fixture.ts` structures each turn as TWO separate
 * single-move action-step frames (`sequence(actionStep, actionStep)`). Once
 * the first of the two commits, that frame closes and a FRESH frame opens
 * (`moveCount === 0`) -- so an undo attempted after only the first action of
 * a turn is now correctly REFUSED ("No actions to undo"), because it would
 * have to reach back across a frame boundary the fix no longer permits any
 * fallback for. The block below titled "the mid-turn cross-frame case is now
 * REFUSED" asserts exactly this -- it replaces this suite's old
 * `undo.success === true` expectation for that same scenario, which is
 * SUPERSEDED, not a bug to restore.
 *
 * The property this suite exists to protect -- undoing the CURRENT turn does
 * not destroy a PRIOR turn's pending-action mutation (equipment collected via
 * the selection-step path, moved with Piece.putInto -- recorded in neither
 * command nor action history) -- is preserved below, adapted to a target
 * that's still reachable under the new contract (the SAME turn's own first
 * actionStep, undone before advancing into its second).
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

describe('authoritative undo across a prior pending mutation (155-03 contract)', () => {
  it('the mid-turn cross-frame case is now REFUSED -- explore+collect (turn N-1) survives untouched', async () => {
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

    // ── Turn 3 (player 1 again): take the FIRST action of the turn ────────────
    const p1turn3 = await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });
    expect(p1turn3.success).toBe(true);
    expect(currentPlayer(p1turn3)).toBe(1); // still player 1's turn (second actionStep pending)

    // Pre-155-03 this succeeded (branch C's same-player backward scan bounded
    // by the phase/actionStep structure). Post-155-03, turn3's first
    // actionStep frame already closed the instant its one action committed --
    // moveCount is 0 for the SECOND (now-open) frame -- so this is correctly
    // REFUSED, not a bug.
    const undo = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(undo.success).toBe(false);
    expect(undo.error).toMatch(/no actions to undo/i);

    // Turn 1's equipment (a PRIOR turn's pending-action mutation) was never
    // at risk -- a refused undo is a no-op, so the state is unchanged from
    // right before the (rejected) undo attempt.
    expect(spaceChildIds(p1turn3.snapshot, 'held-1')).toContain(collectedId);
  });
});

// ── Positive case: undo of an action within the currently-active frame ─────
// collect-turns-fixture's two action-steps are BOTH single-move (auto-
// complete after one action), so there is no in-fixture moment where undo is
// offered mid-frame. `TwoMoveTurnGame` below is the minimal fixture that
// actually has one: a `repeatUntil`-kept-open actionStep requiring exactly
// two moves per turn (no minMoves/maxMoves declared -- repeatUntil is a
// third, independent completion signal), so undo is genuinely available
// after the FIRST of the two moves, proving the suite still covers a real
// successful undo, not merely refusals.

class TwoMoveTurnGame extends Game<TwoMoveTurnGame, Player> {
  activeSeat = 1;
  movesThisTurn = 0;
  score = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(Action.create('move').execute(() => {
      this.movesThisTurn++;
      this.score += 1;
      return { success: true };
    }));

    const activePlayer = (ctx: { game: Game }) =>
      ctx.game.getPlayer((ctx.game as TwoMoveTurnGame).activeSeat)!;

    this.setFlow(defineFlow({
      root: loop({
        maxIterations: 1000,
        do: sequence(
          actionStep({
            actions: ['move'],
            player: activePlayer,
            repeatUntil: (ctx) => (ctx.game as TwoMoveTurnGame).movesThisTurn >= 2,
          }),
          execute((ctx) => {
            const game = ctx.game as TwoMoveTurnGame;
            game.movesThisTurn = 0;
            game.activeSeat = game.activeSeat >= game.players.length ? 1 : game.activeSeat + 1;
          }),
        ),
      }),
    }));
  }
}

const twoMoveTurnFixtureDefinition: GameDefinitionLike = {
  gameClass: TwoMoveTurnGame as new (...args: unknown[]) => unknown,
  gameType: 'two-move-turn',
  minPlayers: 2,
  maxPlayers: 2,
};

describe('undo within the currently-active action-step frame (positive case, 155-03)', () => {
  it('one undo, mid-frame, removes exactly the pending move -- a prior turn is untouched', async () => {
    const session = createHeadlessSession(twoMoveTurnFixtureDefinition, { playerCount: 2, seed: 't' });
    await session.start();

    // Player 1's WHOLE turn (both required moves) -- history = [move, move], score = 2.
    expect((await session.send(1, { type: 'action', actionName: 'move', player: 1, args: {} } as Op)).success).toBe(true);
    const p1turnEnd = await session.send(1, { type: 'action', actionName: 'move', player: 1, args: {} } as Op);
    expect(p1turnEnd.success).toBe(true);
    expect(currentPlayer(p1turnEnd)).toBe(2);

    // Player 2's first move of their turn -- frame open, moveCount === 1.
    const p2move1 = await session.send(2, { type: 'action', actionName: 'move', player: 2, args: {} } as Op);
    expect(p2move1.success).toBe(true);
    expect(currentPlayer(p2move1)).toBe(2); // step still open, repeatUntil not yet true
    expect((p2move1.snapshot as { state?: { attributes?: { score?: number } } }).state?.attributes?.score).toBe(3);

    const undo = await session.send(2, { type: 'undo', player: 2 } as Op);
    expect(undo.success).toBe(true);

    // Exactly player 2's one pending move was undone -- player 1's whole,
    // already-closed turn is untouched.
    expect((undo.snapshot as { state?: { attributes?: { score?: number } } }).state?.attributes?.score).toBe(2);
  });
});

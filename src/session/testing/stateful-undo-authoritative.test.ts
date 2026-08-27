import { describe, it, expect } from 'vitest';
import { GameSession } from '../game-session.js';
import { CollectTurnsGame } from './fixtures/collect-turns-fixture.js';
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
import type { GameDefinitionLike } from '../stateless-ops.js';

/**
 * Stateful-session undo contract (StateHistory.undoToTurnStart). Mirrors
 * `undo-authoritative.test.ts` but exercises the in-memory GameSession path
 * (game-session.ts + state-history.ts) used by BoardSmith's standalone
 * server/worker.
 *
 * MID-TURN CROSS-FRAME UNDO (issues 144/145): see
 * `undo-authoritative.test.ts`'s header comment for the full rationale.
 * `moveCount` is frame-scoped, and `collect-turns-fixture.ts` spends a turn
 * over two action-step frames; its second step declares
 * `turnScope: 'continue'`, so the run carries across that boundary and an undo
 * after the turn's FIRST action is granted, rewinding only that turn.
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

describe('stateful undo across a prior pending mutation (155-03 contract)', () => {
  it("the mid-turn cross-frame undo is granted and stops at this turn's start -- explore+collect (turn N-1) survives untouched", async () => {
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

    // ── Turn 3 (player 1): take the FIRST action of the turn ──────────────────
    const p1turn3 = await session.performAction('pass', 1, {});
    expect(p1turn3.success).toBe(true);
    expect((p1turn3.flowState as any)?.currentPlayer).toBe(1);

    // `turnScope: 'continue'` carries turn 3's run across the frame boundary
    // its first action closed, so the undo is granted and rewinds that action.
    const undo = await session.undoToTurnStart(1);
    expect(undo.success).toBe(true);

    // The rewind stopped at THIS turn's start: turn 1's equipment (a PRIOR
    // turn's pending-action mutation, recoverable by no replay) survives.
    expect(spaceChildIds(session.runner.getSnapshot(), 'held-1')).toContain(collectedId);
  });
});

// ── Positive case: undo of an action within the currently-active frame ─────
// See undo-authoritative.test.ts for why collect-turns-fixture (both
// actionSteps single-move) cannot itself demonstrate a mid-frame undo.

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
  gameClass: TwoMoveTurnGame,
  gameType: 'two-move-turn',
  minPlayers: 2,
  maxPlayers: 2,
};

describe('undo within the currently-active action-step frame (positive case, 155-03)', () => {
  it('one undo, mid-frame, removes exactly the pending move -- a prior turn is untouched', async () => {
    const session = GameSession.create<TwoMoveTurnGame>({
      gameType: 'two-move-turn',
      GameClass: TwoMoveTurnGame,
      playerCount: 2,
      playerNames: ['A', 'B'],
      seed: 't',
    });

    // Player 1's WHOLE turn -- history = [move, move], score = 2.
    expect((await session.performAction('move', 1, {})).success).toBe(true);
    const p1turnEnd = await session.performAction('move', 1, {});
    expect(p1turnEnd.success).toBe(true);
    expect((p1turnEnd.flowState as any)?.currentPlayer).toBe(2);

    // Player 2's first move -- frame open, moveCount === 1.
    const p2move1 = await session.performAction('move', 2, {});
    expect(p2move1.success).toBe(true);
    expect((session.runner.getSnapshot().state as { attributes?: { score?: number } }).attributes?.score).toBe(3);

    const undo = await session.undoToTurnStart(2);
    expect(undo.success).toBe(true);

    // Exactly player 2's one pending move was undone -- player 1's whole,
    // already-closed turn is untouched.
    expect((session.runner.getSnapshot().state as { attributes?: { score?: number } }).attributes?.score).toBe(2);
  });
});

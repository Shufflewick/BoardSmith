/**
 * #1759: a sequential action step declared `undo: 'action'` takes back one
 * action per Undo, and the seat can keep taking back the action before it,
 * back to its turn start, `.notUndoable()` or a fenced random draw.
 */
import { describe, expect, it } from 'vitest';

import {
  Game,
  Player,
  Action,
  sequence,
  actionStep,
  loop,
  type GameOptions,
  type FlowNode,
} from '../../engine/index.js';
import type { GameDefinitionLike } from '../stateless-ops.js';
import { createHeadlessSession } from '../../testing/headless-session.js';
import type { PlayerGameState } from '../types.js';
import { snapshotTree } from '../../engine/utils/index.js';
import { succeeded } from '../op-result.test-helper.js';

type Shape = 'held-open' | 'continuing-loop' | 'whole-turn';

function placementDefinition(shape: Shape): GameDefinitionLike {
  class PlacementGame extends Game<PlacementGame, Player> {
    placed = 0;
    drawn = 0;

    constructor(options: GameOptions) {
      super(options);
      this.registerAction(Action.create('pass').execute(() => ({ success: true })));
      this.registerAction(Action.create('place').execute(() => {
        this.placed += 1;
        return { success: true };
      }));
      this.registerAction(Action.create('draw').execute(() => {
        this.drawn += 1 + Math.floor(this.random() * 6);
        return { success: true };
      }));
      this.registerAction(Action.create('lock').notUndoable().execute(() => ({ success: true })));

      const p1 = (ctx: { game: Game }) => ctx.game.getPlayer(1)!;
      const actions = ['place', 'draw', 'lock'];
      const placements: Record<Shape, () => FlowNode> = {
        'held-open': () => actionStep({ actions, player: p1, repeatUntil: () => false, turnScope: 'restart', undo: 'action' }),
        'continuing-loop': () => loop({
          maxIterations: 20,
          while: () => true,
          do: actionStep({ actions, player: p1, turnScope: 'continue', undo: 'action' }),
        }),
        'whole-turn': () => actionStep({ actions, player: p1, repeatUntil: () => false, turnScope: 'restart' }),
      };
      // A `'continue'` loop would carry a leading `pass` into its turn, so only the held-open shapes start with one.
      this.setFlow({
        root: shape === 'continuing-loop' ? placements[shape]() : sequence(actionStep({ actions: ['pass'], player: p1 }), placements[shape]()),
      });
    }
  }
  return { gameClass: PlacementGame, gameType: `per-action-undo-${shape}`, minPlayers: 1, maxPlayers: 1, undo: { fenceRandomRewind: true } };
}

async function started(shape: Shape) {
  const session = createHeadlessSession(placementDefinition(shape), { playerCount: 1, seed: 'per-action' });
  await session.start();
  const act = async (actionName: string) => {
    const res = await session.send(1, { type: 'action', actionName, player: 1, args: {} });
    expect(res.success, `${actionName}: ${res.error}`).toBe(true);
  };
  const state = () => (session.broadcasts.at(-1) as Array<{ state: PlayerGameState }>)[0].state;
  const undo = () => session.send(1, { type: 'undo', player: 1 });
  /** Undoes, requires it to succeed, and answers how many placements remain. */
  const undoPlaced = async () => snapshotTree(succeeded(await undo()).snapshot).attributes.placed;
  if (shape !== 'continuing-loop') await act('pass');
  return { act, state, undo, undoPlaced };
}

describe("actionStep({ undo: 'action' }) (#1759)", () => {
  for (const shape of ['held-open', 'continuing-loop'] as const) {
    it(`${shape}: each Undo takes back one action, back to the turn start`, async () => {
      const s = await started(shape);
      await s.act('place');
      await s.act('place');
      await s.act('place');

      for (const remaining of [2, 1, 0]) {
        expect(s.state().canUndo).toBe(true);
        expect(await s.undoPlaced()).toBe(remaining);
      }
      expect(s.state().canUndo).toBe(false);
      const refused = await s.undo();
      expect(refused.success).toBe(false);
      expect(refused.error).toBe('No actions to undo');
    });
  }

  it('stops at a .notUndoable() action', async () => {
    const s = await started('held-open');
    await s.act('place');
    await s.act('lock');
    await s.act('place');

    expect(await s.undoPlaced()).toBe(1);
    expect(s.state().canUndo).toBe(false);
    expect((await s.undo()).error).toMatch(/lock/);
  });

  it('takes back actions after a random draw but not the draw itself', async () => {
    const s = await started('held-open');
    await s.act('place');
    await s.act('draw');
    await s.act('place');

    expect(await s.undoPlaced()).toBe(1);
    expect(s.state().canUndo).toBe(false);
    expect((await s.undo()).error).toMatch(/random draw was consumed/);
  });

  it('without it, one Undo takes back the whole turn', async () => {
    const s = await started('whole-turn');
    await s.act('place');
    await s.act('place');

    expect(await s.undoPlaced()).toBe(0);
  });
});

/**
 * #1796: undo puts the game back as it was before the action, even when the
 * action was taken pick by pick and a pick's `onSelect` changed the game. The
 * checkpoint undo restores is the state before the action's first pick, not
 * the state after it.
 */
import { describe, expect, it } from 'vitest';

import {
  Action,
  Game,
  Player,
  actionStep,
  loop,
  sequence,
  simultaneousActionStep,
  type FlowNode,
  type GameOptions,
} from '../../engine/index.js';
import type { GameDefinitionLike } from '../stateless-ops.js';
import { createHeadlessSession } from '../../testing/headless-session.js';
import { snapshotTree } from '../../engine/utils/index.js';
import { succeeded } from '../op-result.test-helper.js';

type Shape = 'turn' | 'each-action' | 'handoff' | 'simultaneous';

function spendDefinition(shape: Shape): GameDefinitionLike {
  class SpendGame extends Game<SpendGame, Player> {
    counter = 10;
    moved = 0;

    constructor(options: GameOptions) {
      super(options);
      this.registerActions(
        Action.create<SpendGame>('spend')
          .chooseFrom('first', { choices: ['a', 'b'], onSelect: () => { this.counter -= 1; } })
          .chooseFrom('second', { choices: ['c', 'd'] })
          .execute(() => {}),
        Action.create<SpendGame>('move').execute(() => { this.moved += 1; })
      );
      const seat = (n: number) => (ctx: { game: Game }) => ctx.game.getPlayer(n)!;
      const actions = ['spend', 'move'];
      const flows: Record<Shape, () => FlowNode> = {
        turn: () => actionStep({ actions, player: seat(1), repeatUntil: () => false, turnScope: 'restart' }),
        'each-action': () => actionStep({ actions, player: seat(1), repeatUntil: () => false, turnScope: 'restart', undo: 'action' }),
        handoff: () => sequence(
          actionStep({ actions: ['spend'], player: seat(1) }),
          actionStep({ actions: ['move'], player: seat(2), repeatUntil: () => false, handoffUndo: true }),
        ),
        simultaneous: () => simultaneousActionStep({
          players: () => this.players,
          actions,
          playerDone: () => false,
          allDone: () => false,
        }),
      };
      this.setFlow({ root: loop({ maxIterations: 1000, while: () => true, do: flows[shape]() }) });
    }
  }
  return { gameClass: SpendGame, gameType: `undo-before-picks-${shape}`, minPlayers: 2, maxPlayers: 2 };
}

async function started(shape: Shape) {
  const session = createHeadlessSession(spendDefinition(shape), { playerCount: 2, seed: 'i1796' });
  await session.start();
  const pick = async (seat: number, selectionName: string, value: string) => {
    const res = await session.send(seat, { type: 'selectionStep', actionName: 'spend', selectionName, value, player: seat });
    expect(res.success, `${selectionName}: ${res.error}`).toBe(true);
  };
  const spend = async (seat = 1) => {
    await pick(seat, 'first', 'a');
    await pick(seat, 'second', 'c');
  };
  const move = async (seat = 1) => {
    const res = await session.send(seat, { type: 'action', actionName: 'move', player: seat, args: {} });
    expect(res.success, `move: ${res.error}`).toBe(true);
  };
  const undo = async (seat = 1) => snapshotTree(succeeded(await session.send(seat, { type: 'undo', player: seat })).snapshot).attributes;
  return { pick, spend, move, undo };
}

describe('undo restores the state before a pick-by-pick action (#1796)', () => {
  it("turn undo, when the action was the turn's first", async () => {
    const s = await started('turn');
    await s.spend();
    expect((await s.undo()).counter).toBe(10);
    await s.spend();
    expect((await s.undo()).counter).toBe(10);
  });

  it("an undo: 'action' step", async () => {
    const s = await started('each-action');
    await s.move();
    await s.spend();
    const undone = await s.undo();
    expect(undone.counter).toBe(10);
    expect(undone.moved).toBe(1);
  });

  it('a handoffUndo step', async () => {
    const s = await started('handoff');
    await s.spend();
    expect((await s.undo()).counter).toBe(10);
  });

  it('a simultaneous step, keeping what another seat committed before the first pick', async () => {
    const s = await started('simultaneous');
    await s.move(2);
    await s.spend(1);
    const undone = await s.undo(1);
    expect(undone.counter).toBe(10);
    expect(undone.moved).toBe(1);
  });

  it("a simultaneous step, dropping another seat's open picks when a seat undoes its action", async () => {
    const s = await started('simultaneous');
    await s.pick(1, 'first', 'a');
    await s.move(2);
    const undone = await s.undo(2);
    expect(undone.counter).toBe(10);
    expect(undone.moved).toBe(0);
  });

  it('a later pick-by-pick action, keeping the earlier one', async () => {
    const s = await started('each-action');
    await s.spend();
    await s.move();
    await s.spend();
    const undone = await s.undo();
    expect(undone.counter).toBe(9);
    expect(undone.moved).toBe(1);
  });
});

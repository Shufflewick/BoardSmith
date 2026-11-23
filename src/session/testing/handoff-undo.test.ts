/**
 * #1788: an action step declared `handoffUndo: true` lets the seat that acted
 * last take back its last action while the step waits on another seat that
 * has not yet picked or acted. The undo puts the flow back in the step the
 * action was taken in.
 */
import { describe, expect, it } from 'vitest';

import {
  Action,
  Game,
  Player,
  actionStep,
  sequence,
  type GameOptions,
} from '../../engine/index.js';
import type { GameDefinitionLike } from '../stateless-ops.js';
import { createHeadlessSession } from '../../testing/headless-session.js';
import type { PlayerGameState } from '../types.js';
import { snapshotTree } from '../../engine/utils/index.js';
import { succeeded } from '../op-result.test-helper.js';

interface Options {
  handoffUndo?: boolean;
  checkpoints?: GameDefinitionLike['checkpoints'];
  fenceRandomRewind?: boolean;
}

function handoffDefinition(options: Options = {}): GameDefinitionLike {
  class HandoffGame extends Game<HandoffGame, Player> {
    moved = 0;
    rolled = 0;

    constructor(gameOptions: GameOptions) {
      super(gameOptions);
      this.registerActions(
        Action.create<HandoffGame>('move').execute((_args, ctx) => { ctx.game.moved += 1; }),
        Action.create<HandoffGame>('lock').notUndoable().execute((_args, ctx) => { ctx.game.moved += 1; }),
        Action.create<HandoffGame>('roll').execute((_args, ctx) => { ctx.game.rolled = 1 + Math.floor(ctx.game.random() * 6); }),
        Action.create<HandoffGame>('answer')
          .chooseFrom('first', { choices: ['a', 'b'] })
          .chooseFrom('second', { choices: ['c', 'd'] })
          .execute(() => {}),
      );
      this.setFlow({
        root: sequence(
          actionStep({ name: 'mover', player: (ctx) => ctx.game.getPlayer(1)!, actions: ['move', 'lock', 'roll'] }),
          actionStep({ name: 'waiter', player: (ctx) => ctx.game.getPlayer(2)!, actions: ['answer'], repeatUntil: () => false, handoffUndo: options.handoffUndo }),
        ),
      });
    }
  }
  return {
    gameClass: HandoffGame,
    gameType: 'handoff-undo',
    minPlayers: 2,
    maxPlayers: 2,
    checkpoints: options.checkpoints,
    undo: { fenceRandomRewind: options.fenceRandomRewind ?? false },
  };
}

async function started(options: Options = { handoffUndo: true }) {
  const session = createHeadlessSession(handoffDefinition(options), { playerCount: 2, seed: 'handoff', playerNames: ['A', 'B'] });
  await session.start();
  const act = async (seat: number, actionName: string) => {
    const res = await session.send(seat, { type: 'action', actionName, player: seat, args: {} });
    expect(res.success, `${actionName}: ${res.error}`).toBe(true);
  };
  const pick = async (selectionName: string, value: string) => {
    const res = await session.send(2, { type: 'selectionStep', actionName: 'answer', selectionName, value, player: 2 });
    expect(res.success, `${selectionName}: ${res.error}`).toBe(true);
  };
  const state = (seat: number) => (session.broadcasts.at(-1) as Array<{ state: PlayerGameState }>)[seat - 1].state;
  const undo = (seat: number) => session.send(seat, { type: 'undo', player: seat });
  return { act, pick, state, undo };
}

describe('actionStep({ handoffUndo: true }) (#1788)', () => {
  it('lets the seat that acted last undo before the waiting seat acts, back in the step it acted in', async () => {
    const s = await started();
    await s.act(1, 'move');

    expect(s.state(1).canUndo).toBe(true);
    expect(s.state(2).canUndo).toBe(false);
    const undone = succeeded(await s.undo(1));
    expect(snapshotTree(undone.snapshot).attributes.moved).toBe(0);
    expect(s.state(1).isMyTurn).toBe(true);
    expect(s.state(2).isMyTurn).toBe(false);
    expect(s.state(1).availableActions).toContain('move');
  });

  it('closes once the waiting seat acts', async () => {
    const s = await started();
    await s.act(1, 'move');
    await s.pick('first', 'a');
    await s.pick('second', 'c');

    expect(s.state(1).canUndo).toBe(false);
    expect((await s.undo(1)).errorCode).toBe('NOT_YOUR_TURN');
  });

  it("closes at the waiting seat's first pick, even before its action completes", async () => {
    const s = await started();
    await s.act(1, 'move');
    await s.pick('first', 'a');

    expect(s.state(1).canUndo).toBe(false);
    expect((await s.undo(1)).errorCode).toBe('NOT_YOUR_TURN');
  });

  it('still refuses an action marked .notUndoable()', async () => {
    const s = await started();
    await s.act(1, 'lock');

    expect(s.state(1).canUndo).toBe(false);
    expect((await s.undo(1)).error).toMatch(/lock/);
  });

  it('still refuses across a random draw when the game fences it', async () => {
    const s = await started({ handoffUndo: true, fenceRandomRewind: true });
    await s.act(1, 'roll');

    expect(s.state(1).canUndo).toBe(false);
    expect((await s.undo(1)).error).toMatch(/random draw was consumed/);
  });

  it('still refuses when the game keeps no checkpoints', async () => {
    const s = await started({ handoffUndo: true, checkpoints: { enabled: false } });
    await s.act(1, 'move');

    expect(s.state(1).canUndo).toBe(false);
    expect((await s.undo(1)).errorCode).toBe('UNDO_NOT_ALLOWED');
  });

  it('without it, the seat that handed off cannot undo', async () => {
    const s = await started({});
    await s.act(1, 'move');

    expect(s.state(1).canUndo).toBe(false);
    expect((await s.undo(1)).errorCode).toBe('NOT_YOUR_TURN');
  });
});

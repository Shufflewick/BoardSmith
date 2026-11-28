import { expect, it } from 'vitest';
import { Action, Game, Player, simultaneousActionStep, type GameOptions } from '../../engine/index.js';
import { createHeadlessSession } from '../../testing/headless-session.js';
import type { GameDefinitionLike } from '../stateless-ops.js';

class MoveTwicePlayer extends Player<MoveTwice, MoveTwicePlayer> {
  moves = 0;
}

class MoveTwice extends Game<MoveTwice, MoveTwicePlayer> {
  static override PlayerClass = MoveTwicePlayer;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create<MoveTwice>('move').execute((_args, { player }) => {
      player.moves++;
    }));
    this.setFlow({
      root: simultaneousActionStep<MoveTwice>({
        actions: ['move'],
        seatUndo: true,
        allDone: ({ game }) => game.getPlayer(2)?.moves === 2,
      }),
    });
  }
}

const definition = {
  gameClass: MoveTwice,
  gameType: 'move-twice',
  minPlayers: 2,
  maxPlayers: 2,
  checkpoints: { actionHistory: 'undo' },
  bot: { candidateMoves: (_game, _seat, listMoves) => listMoves() },
} satisfies GameDefinitionLike;

it.each([false, true])('finishes both bot moves after the human moves in a per-seat undo step (fullHistory=%s)', async (fullHistory) => {
  const session = createHeadlessSession(definition, { playerCount: 2, seed: 'move-twice', fullHistory }, [{ seat: 2, level: 'easy' }]);
  try {
    await session.start();
    await session.host.runBotTurns();
    expect(session.readGame().players.map((player) => player.moves)).toEqual([0, 0]);
    const result = await session.send(1, { type: 'action', actionName: 'move', player: 1, args: {} });
    expect(result.success).toBe(true);
    await session.host.runBotTurns();

    expect(session.readGame().players.map((player) => player.moves)).toEqual([1, 2]);
    expect(session.host.isComplete).toBe(true);
  } finally {
    session.host.dispose();
  }
});

it('holds the bot again when the human undoes their only move in the step', async () => {
  const session = createHeadlessSession(definition, { playerCount: 2, seed: 'move-twice' });
  const move = () => session.send(1, { type: 'action', actionName: 'move', player: 1, args: {} });
  try {
    await session.start();
    expect((await move()).success).toBe(true);
    expect((await session.send(1, { type: 'undo', player: 1 })).success).toBe(true);
    session.makeSeatBot(2);
    await session.host.runBotTurns();
    expect(session.readGame().players.map((player) => player.moves)).toEqual([0, 0]);

    expect((await move()).success).toBe(true);
    await session.host.runBotTurns();
    expect(session.readGame().players.map((player) => player.moves)).toEqual([1, 2]);
  } finally {
    session.host.dispose();
  }
});

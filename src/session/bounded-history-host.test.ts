import { describe, it, expect, afterEach, vi } from 'vitest';
import { Action, Game, Player, actionStep, eachPlayer, loop, type GameOptions } from '../engine/index.js';
import { createHeadlessSession } from '../testing/headless-session.js';
import type { GameDefinitionLike } from './stateless-ops.js';

// #997: a game keeping only the history undo reads, run by the session host a
// hosted table uses. Every action index the host and the debug ops hand out
// counts the dropped actions too.

class TurnsGame extends Game<TurnsGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({ maxIterations: 1000, do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }) }),
    });
  }
}

const def: GameDefinitionLike = {
  gameClass: TurnsGame,
  gameType: 'bounded-history-host',
  minPlayers: 2,
  maxPlayers: 2,
  checkpoints: { actionHistory: 'undo' },
};

/** Seats 1 and 2 pass in turn, `moves` times; move `n` (from 1) reaches the host at time `n * 1000`. */
async function played(moves: number) {
  const session = createHeadlessSession(def, { playerCount: 2, seed: 'bounded-history-host' });
  await session.start();
  const now = vi.spyOn(Date, 'now');
  for (let n = 1; n <= moves; n++) {
    now.mockReturnValue(n * 1000);
    const seat = ((n - 1) % 2) + 1;
    const moved = await session.send(seat, { type: 'action', actionName: 'pass', player: seat, args: {} });
    if (!moved.success) throw new Error(moved.error);
  }
  now.mockRestore();
  return session;
}

afterEach(() => vi.restoreAllMocks());

describe('the session host with a kept history (#997)', () => {
  it('saves only the kept history, and reports when its kept entries arrived', async () => {
    const session = await played(5);
    expect(session.host.snapshot).toMatchObject({ actionHistory: [{ name: 'pass', player: 1 }], actionHistoryBase: 4 });

    const history = await session.send(1, { type: 'debugHistory' });
    expect(history).toMatchObject({
      success: true,
      actionHistoryBase: 4,
      actionHistory: [{ name: 'pass', player: 1, timestamp: 5000 }],
    });
  });

  it('checks a debug index against the whole game, not the kept entries', async () => {
    const session = await played(5);
    const past = await session.send(1, { type: 'debugStateAt', actionIndex: 6, player: 1 });
    expect(past).toMatchObject({ success: false, error: 'Invalid action index: 6. History has 5 actions.' });
  });
});

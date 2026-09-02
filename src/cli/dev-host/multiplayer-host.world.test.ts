import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, Space, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/index.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';

/**
 * Issue #158: `boardsmith dev` had no way to stand up a resident world.
 *
 * A world is declared at CONSTRUCTION (`GameOptions.worldMode`), not selected
 * as a session kind, so the dev host has to reach that option. The manifest's
 * `world` block is the single declaration -- there is no flag, because two
 * ways to say "this is a world" is one too many.
 */

class Room extends Space<WorldGame> {}

class WorldGame extends Game<WorldGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.create(Room, 'hall');
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }),
        }),
      }),
    );
  }
}

const def: GameDefinitionLike = {
  gameClass: WorldGame,
  gameType: 'world-game',
  minPlayers: 1,
  maxPlayers: 4,
};

function makeHost(worldMode: boolean | undefined) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let startOptions: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let startSnapshot: any = null;
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 1,
    maxPlayers: def.maxPlayers,
    makeSeed: () => 'world-seed',
    worldMode,
    executeOp: async (gameOptions, snap, pend, op, hostOptions) => {
      if (op.type === 'start') startOptions = gameOptions;
      const result = await executeOp(def, gameOptions, snap, pend, op, hostOptions);
      if (op.type === 'start') startSnapshot = (result as { snapshot?: unknown }).snapshot;
      return result;
    },
    send: (clientId, msg) => sent.push({ clientId, msg }),
  });
  return { host, getStartOptions: () => startOptions, getStartSnapshot: () => startSnapshot };
}

describe('MultiplayerHost — a world runs resident locally (#158)', () => {
  it('constructs the game with worldMode when the host is hosting a world', async () => {
    const { host, getStartOptions } = makeHost(true);
    await host.handleMessage('A', { type: 'hello' });
    expect(getStartOptions().worldMode).toBe(true);
  });

  it('leaves an ordinary game in snapshot mode', async () => {
    const { host, getStartOptions } = makeHost(undefined);
    await host.handleMessage('A', { type: 'hello' });
    expect(getStartOptions().worldMode).toBeUndefined();
  });

  it('carries world mode into the snapshot, so a restore comes back resident', async () => {
    const { host, getStartSnapshot } = makeHost(true);
    await host.handleMessage('A', { type: 'hello' });
    expect(getStartSnapshot().gameOptions.worldMode).toBe(true);
  });

  it('keeps the game in world mode across a restart', async () => {
    const { host, getStartOptions } = makeHost(true);
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'configure', gameOptions: {} });
    expect(getStartOptions().worldMode).toBe(true);
  });
});

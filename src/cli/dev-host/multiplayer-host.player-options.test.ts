/**
 * #1323, #1325: `boardsmith dev` sets each seat's player options, as the
 * platform's lobby does. A table starts with every declared default on every
 * seat and each exclusive option on the one seat its default names; a
 * `setPlayerOptions` message replaces the table's choices, refused as the
 * platform refuses a value, and deals a new game with them.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike, type PlayerOptionDefinition } from '../../session/index.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';

class PassGame extends Game<PassGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({
        maxIterations: 1000,
        do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }),
      }),
    });
  }
}

const def = { gameClass: PassGame, gameType: 'pass', minPlayers: 1, maxPlayers: 4 } satisfies GameDefinitionLike;

const playerOptions: Record<string, PlayerOptionDefinition> = {
  handicap: { type: 'number', label: 'Handicap', default: 2, min: 0, max: 5 },
  ready: { type: 'boolean', label: 'Ready', default: false },
  dictator: { type: 'exclusive', label: 'Dictator', default: 'last', choices: [{ value: 'dictator', label: 'Dictator' }] },
};
const personal = { handicap: 2, ready: false };

function table(playerCount = 3) {
  const starts: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const sent: HostOutbound[] = [];
  const host = new MultiplayerHost({
    playerCount,
    minPlayers: 1,
    maxPlayers: def.maxPlayers,
    makeSeed: () => 'seat-options',
    playerOptions,
    executeOp: (gameOptions, snap, pend, op, hostOptions) => {
      if (op.type === 'start') starts.push(gameOptions);
      return executeOp(def, gameOptions, snap, pend, op, hostOptions);
    },
    send: (_clientId, msg) => sent.push(msg),
  });
  const lastLobby = () => sent.filter((m) => m.type === 'lobby').at(-1) as Extract<HostOutbound, { type: 'lobby' }>;
  return { host, starts, sent, lastLobby };
}

describe('MultiplayerHost — each seat\'s player options (#1323, #1325)', () => {
  it('starts with every default on every seat and each exclusive option on the seat its default names', async () => {
    const { host, starts, lastLobby } = table();
    await host.handleMessage('A', { type: 'hello' });

    const start = starts[0];
    expect(start.playerOptions).toEqual([personal, personal, { ...personal, dictator: 'dictator' }]);
    expect(start.playerOptions.filter((seat: Record<string, unknown>) => 'dictator' in seat)).toHaveLength(1);
    expect(start.exclusiveSeats).toEqual({ dictator: 3 });
    expect(start.playerConfigs[2]).toMatchObject({ dictator: 'dictator' });
    expect(lastLobby().seats.map((s) => s.playerOptions)).toEqual(start.playerOptions);
  });

  it('deals a new game with the options each seat was given', async () => {
    const { host, starts, lastLobby } = table();
    await host.handleMessage('A', { type: 'hello' });
    const chosen = [{ handicap: 0, ready: true, dictator: 'dictator' }, { handicap: 5, ready: false }, personal];

    await host.handleMessage('A', { type: 'setPlayerOptions', playerOptions: chosen });

    expect(starts).toHaveLength(2);
    expect(starts[1].playerOptions).toEqual(chosen);
    expect(starts[1].exclusiveSeats).toEqual({ dictator: 1 });
    expect(starts[1].playerConfigs[1]).toMatchObject({ handicap: 5, ready: false });
    expect(lastLobby().seats.map((s) => s.playerOptions)).toEqual(chosen);

    // A restart keeps them, as it keeps the game options.
    await host.handleMessage('A', { type: 'restart' });
    expect(starts[2].playerOptions).toEqual(chosen);
  });

  it('refuses a value the platform would refuse, and deals nothing', async () => {
    const { host, starts, sent } = table();
    await host.handleMessage('A', { type: 'hello' });

    await host.handleMessage('A', {
      type: 'setPlayerOptions',
      playerOptions: [{ ...personal, handicap: 9, dictator: 'dictator' }, personal, personal],
    });

    expect(sent.at(-1)).toEqual({ type: 'error', message: 'Seat 1: Handicap is 9, above its max of 5.' });
    expect(starts).toHaveLength(1);
  });

  it('starts a resized table from the defaults, the exclusive option on its new last seat', async () => {
    const { host, starts } = table();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', {
      type: 'setPlayerOptions',
      playerOptions: [{ ...personal, dictator: 'dictator' }, personal, personal],
    });

    await host.handleMessage('A', { type: 'configure', gameOptions: { playerCount: 2 } });

    expect(starts.at(-1)!.playerOptions).toEqual([personal, { ...personal, dictator: 'dictator' }]);
    expect(starts.at(-1)!.exclusiveSeats).toEqual({ dictator: 2 });
  });
});

/**
 * #1323, #1325: `boardsmith dev` sets each seat's player options, as the
 * platform's lobby does. A table starts with every declared default on every
 * seat and each exclusive option on the one seat its default names; a
 * `setPlayerOptions` message replaces the table's choices, refused as the
 * platform refuses a value, and deals a new game with them.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike, type GamePreset, type PlayerOptionDefinition } from '../../session/index.js';
import { MultiplayerHost, type HostOutbound, type MultiplayerHostOptions } from './multiplayer-host.js';
import { manualGraceTimer } from './reconnect-grace.test-helper.js';

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
const colorPalette = [
  { value: '#e74c3c', label: 'Red' },
  { value: '#3498db', label: 'Blue' },
  { value: '#95a5a6', label: 'Grey' },
  { value: '#27ae60', label: 'Green' },
];
const presets = [
  {
    name: 'Play as Dictator',
    players: [
      { color: '#95a5a6', playerOptions: { dictator: 'dictator' } },
      { color: '#e74c3c', isBot: true, botLevel: 'hard', playerOptions: { handicap: 4 } },
    ],
  },
  { name: 'Two people and a bot', players: [{}, { isBot: true }, {}] },
  // A game written in plain JavaScript, or cast, can still hand the host a field a seat does not take.
  { name: 'Unknown field', players: [{ dictator: true }, {}] } as unknown as GamePreset,
];

function table(playerCount = 3, seating: Pick<MultiplayerHostOptions, 'colorPalette' | 'presets' | 'reconnectTimer'> = {}) {
  const starts: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const sent: HostOutbound[] = [];
  const host = new MultiplayerHost({
    playerCount,
    minPlayers: 1,
    maxPlayers: def.maxPlayers,
    makeSeed: () => 'seat-options',
    playerOptions,
    ...seating,
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

    expect(sent.at(-1)).toEqual({ type: 'error', message: 'Seat 1: Handicap must be between 0 and 5, not 9.' });
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

describe('MultiplayerHost — a preset sets up each seat (#1544)', () => {
  it('gives each seat the preset\'s player options, colour and bot, filling the rest from the defaults', async () => {
    const { host, starts, sent } = table(3, { colorPalette, presets });
    await host.handleMessage('A', { type: 'hello' });

    await host.handleMessage('A', { type: 'configure', preset: 'Play as Dictator' });

    expect(sent.filter((m) => m.type === 'error')).toEqual([]);
    const start = starts.at(-1)!;
    expect(start.playerOptions).toEqual([
      { ...personal, dictator: 'dictator', color: '#95a5a6' },
      { ...personal, handicap: 4, color: '#e74c3c' },
    ]);
    expect(start.exclusiveSeats).toEqual({ dictator: 1 });
    expect(start.colors).toEqual(['#95a5a6', '#e74c3c']);
    expect(start.playerIsBot).toEqual([false, true]);
    expect(start.playerConfigs[1]).toMatchObject({ isBot: true, botLevel: 'hard' });
  });

  it('moves a person out of a seat the preset gives a bot, into a seat it gives a person', async () => {
    const { host, starts, sent } = table(3, { colorPalette, presets });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'join', seat: 2 });

    await host.handleMessage('A', { type: 'configure', preset: 'Two people and a bot' });

    expect(sent.filter((m) => m.type === 'joined').at(-1)).toEqual({ type: 'joined', seat: 3 });
    expect(starts.at(-1)!.playerIsBot).toEqual([false, true, false]);
    // They keep their colour, and the bot seat they left is dealt one no seat has (#1569).
    expect(starts.at(-1)!.colors).toEqual(['#e74c3c', '#95a5a6', '#3498db']);
  });

  it('moves a person whose page is away, within its grace, as it moves one who is here', async () => {
    const grace = manualGraceTimer();
    const { host, lastLobby } = table(3, { colorPalette, presets, reconnectTimer: grace.timer });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'join', seat: 2 });
    host.disconnect('A');

    await host.handleMessage('B', { type: 'configure', preset: 'Two people and a bot' });

    expect(lastLobby().seats.map((s) => [s.seat, s.held, s.connected])).toEqual([[1, true, true], [2, false, false], [3, true, false]]);
    expect(grace.armed()).toHaveLength(1);
  });

  it('starts the first game with the seats the run was started with', async () => {
    const starts: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const host = new MultiplayerHost({
      playerCount: 3,
      minPlayers: 1,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'seat-setup',
      playerOptions,
      colorPalette,
      seatSetup: [
        { playerOptions: personal, isBot: false },
        { playerOptions: { ...personal, dictator: 'dictator' }, color: '#27ae60', isBot: true, botLevel: 'easy' },
        { playerOptions: personal, isBot: false },
      ],
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start') starts.push(gameOptions);
        return executeOp(def, gameOptions, snap, pend, op, hostOptions);
      },
      send: () => {},
    });

    await host.handleMessage('A', { type: 'hello' });

    expect(starts[0].exclusiveSeats).toEqual({ dictator: 2 });
    // Seat 3 names no colour, so it is dealt the first one no seat takes (#1569).
    expect(starts[0].colors).toEqual(['#e74c3c', '#27ae60', '#3498db']);
    expect(starts[0].playerIsBot).toEqual([false, true, true]);
    expect(starts[0].playerConfigs[1]).toMatchObject({ botLevel: 'easy' });
  });

  it('refuses a preset seat that sets a field a seat does not take, and deals nothing', async () => {
    const { host, starts, sent } = table(2, { colorPalette, presets });
    await host.handleMessage('A', { type: 'hello' });

    await host.handleMessage('A', { type: 'configure', preset: 'Unknown field' });

    expect(sent.at(-1)).toEqual({
      type: 'error',
      message:
        'This game\'s preset "Unknown field" cannot be used: seat 1 sets "dictator", which a preset seat does not take. ' +
        'A seat takes color, isBot, botLevel and playerOptions, and a player option goes in playerOptions, ' +
        'e.g. { playerOptions: { "dictator": ... } }. Correct the preset.',
    });
    expect(starts).toHaveLength(1);
  });
});

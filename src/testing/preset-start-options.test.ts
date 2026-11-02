/**
 * #1565: a game's tests start a game as `boardsmith dev --preset` starts it,
 * so "this preset seats the human where its name says" is tested through the
 * real seat setup, not options a test builds by hand.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import { executeOp, type GamePreset } from '../session/index.js';
import { MultiplayerHost } from '../cli/dev-host/multiplayer-host.js';
import { DEV_BOT_LEVEL, resolveDevPlayerOptions } from '../cli/lib/player-options.js';
import { createTestGame, presetStartOptions } from './index.js';
import { projectGameOptions } from '#testing/project-game-options';
import { tempTree } from './temp-tree.test-helper.js';

class RoleGame extends Game<RoleGame, Player> {
  started: Record<string, unknown>;
  constructor(options: GameOptions) {
    super(options);
    this.started = options as unknown as Record<string, unknown>;
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({ root: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }
}

const config = {
  gameOptions: [
    { id: 'rounds', type: 'number', label: 'Rounds', default: 3 },
    { id: 'peek', type: 'boolean', label: 'Peek', default: false, designerOnly: true },
  ],
  playerOptions: [
    { id: 'role', type: 'exclusive', label: 'Role', default: 'last', choices: [{ value: 'dictator', label: 'Dictator' }] },
    { id: 'handicap', type: 'number', label: 'Handicap', default: 0 },
  ],
  colorPalette: [
    { id: 'red', hex: '#E74C3C', label: 'Red' },
    { id: 'blue', hex: '#3498DB', label: 'Blue' },
    { id: 'green', hex: '#27AE60', label: 'Green' },
  ],
};

const presets: GamePreset[] = [
  {
    name: 'Play as Dictator',
    options: { rounds: 5 },
    players: [{ playerOptions: { role: 'dictator' } }, { isBot: true, botLevel: 'hard', color: '#27AE60' }],
  },
  { name: 'Long game', options: { rounds: 9 } },
  { name: 'Peeking', options: { peek: true }, players: [{}, {}] },
  { name: 'Crowd', players: [{}, {}, {}, {}] },
];
const def = { gameClass: RoleGame, gameType: 'role', minPlayers: 2, maxPlayers: 3, presets };

const home = process.cwd();
afterEach(() => process.chdir(home));

function inProject(): void {
  const dir = tempTree('bs-preset-start-');
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'role', backend: 'table', ...config }));
  process.chdir(dir);
}

describe('presetStartOptions starts a test game as a preset starts it (#1565)', () => {
  it('seats each player as the preset says, with its game options', () => {
    inProject();
    const { game } = createTestGame(RoleGame, presetStartOptions(def, 'Play as Dictator'));

    expect(game.players.length).toBe(2);
    expect(game.started).toMatchObject({
      rounds: 5,
      exclusiveSeats: { role: 1 },
      playerOptions: [
        { role: 'dictator', handicap: 0, color: '#E74C3C' },
        { handicap: 0, color: '#27AE60' },
      ],
      playerIsBot: [false, true],
      colors: ['#E74C3C', '#27AE60'],
    });
    expect(game.started.playerConfigs).toEqual([
      { role: 'dictator', handicap: 0, color: '#E74C3C', name: 'Player 1', isBot: false, botLevel: DEV_BOT_LEVEL },
      { handicap: 0, color: '#27AE60', name: 'Player 2', isBot: true, botLevel: 'hard' },
    ]);
  });

  it('gives the seats the start op the dev host sends for the same preset', async () => {
    inProject();
    const playerOptions = resolveDevPlayerOptions({}, config);
    const starts: Array<Record<string, unknown>> = [];
    const errors: unknown[] = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: def.minPlayers,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'preset-start',
      playerOptions,
      colorPalette: playerOptions.color.choices,
      presets,
      botLevel: DEV_BOT_LEVEL,
      declaredGameOptions: projectGameOptions(),
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start') starts.push(gameOptions);
        return executeOp(def, gameOptions, snap, pend, op, hostOptions);
      },
      send: (_clientId, msg) => {
        if (msg.type === 'error') errors.push(msg);
      },
    });
    await host.handleMessage('A', { type: 'hello' });

    await host.handleMessage('A', { type: 'configure', preset: 'Play as Dictator' });

    expect(errors).toEqual([]);
    const options = presetStartOptions(def, 'Play as Dictator');
    const { rounds: _rounds, ...seatFields } = options;
    expect(Object.fromEntries(Object.keys(seatFields).map((key) => [key, starts.at(-1)![key]]))).toEqual(seatFields);
  });

  it('deals a seat the preset gives no colour the first colour no other seat takes (#1569)', () => {
    inProject();
    const redSecond = { ...def, presets: [{ name: 'Red second', options: {}, players: [{}, { color: '#E74C3C' }] }] };
    expect(presetStartOptions(redSecond, 'Red second').colors).toEqual(['#3498DB', '#E74C3C']);
  });

  it('takes an as-const gameDefinition, as boardsmith init scaffolds it (#1572)', () => {
    inProject();
    const scaffolded = {
      ...def,
      presets: [{ name: 'Play as Dictator', players: [{ playerOptions: { role: 'dictator' } }, { isBot: true }] }],
    } as const;
    expect(presetStartOptions(scaffolded, 'Play as Dictator').playerCount).toBe(2);
  });

  it('refuses a preset the game does not declare, naming the ones it does', () => {
    inProject();
    expect(() => presetStartOptions(def, 'Play as Rebel')).toThrow(
      'This game declares no preset "Play as Rebel"; its presets are Play as Dictator, Long game, Peeking, Crowd.',
    );
  });

  it('refuses a preset that sets up no seats, since it gives no player count', () => {
    inProject();
    expect(() => presetStartOptions(def, 'Long game')).toThrow(
      'Preset "Long game" sets up no seats, so it cannot say how to seat a game. ' +
        'Give it players, or start the game with createTestGame(GameClass, { playerCount, ...preset.options }).',
    );
  });

  it('refuses a preset that sets a designer-only option, as dev refuses it when the game loads', () => {
    inProject();
    expect(() => presetStartOptions(def, 'Peeking')).toThrow(/^This game's preset "Peeking" cannot be used: .*peek.* Correct the preset\.$/);
  });

  it('refuses a preset with more seats than the game takes', () => {
    inProject();
    expect(() => presetStartOptions(def, 'Crowd')).toThrow(
      'Preset "Crowd" sets up 4 seats, but this game seats 2 to 3 players. Correct the preset.',
    );
  });
});

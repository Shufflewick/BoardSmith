/**
 * A lobby host chooses game options for everyone, but only among the options
 * the game declared, and never the fields the engine or the session mints:
 * `seed` decides every shuffle and `elementIdKey` decodes every element id
 * (#447), and the lobby sends its options to every member. These tests hold
 * that the lobby refuses such a key, that what reaches the game constructor
 * is the session's own seed and a key the engine minted, and that a declared
 * option arrives typed.
 */
import { describe, it, expect } from 'vitest';
import { Action, Game, Player, actionStep, defineFlow, loop, type GameOptions } from '../engine/index.js';
import { GameSession } from './game-session.js';
import { selectGameOptions, type GameOptionSelection } from './game-option-selection.js';
import type { GameOptionDefinition } from '../types/protocol.js';

class OptionsGame extends Game<OptionsGame, Player> {
  readonly options: GameOptions & Record<string, unknown>;
  constructor(options: GameOptions) {
    super(options);
    this.options = options;
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 100,
          do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }),
        }),
      }),
    );
  }
}

const gameOptionsDefinitions: Record<string, GameOptionDefinition> = {
  rounds: { type: 'number', label: 'Rounds', default: 3 },
  hardMode: { type: 'boolean', label: 'Hard mode', default: false },
};

function lobby(extra: { gameOptions?: GameOptionSelection; elementIdKey?: string } = {}) {
  return GameSession.create<OptionsGame>({
    gameType: 'options',
    GameClass: OptionsGame,
    playerCount: 2,
    playerNames: ['Ann', 'Bo'],
    seed: 'host-seed',
    useLobby: true,
    creatorId: 'host',
    playerConfigs: [{ name: 'Ann' }, { name: 'Bo' }],
    gameOptionsDefinitions,
    minPlayers: 2,
    maxPlayers: 2,
    ...extra,
  });
}

async function startedGame(session: GameSession<OptionsGame>): Promise<OptionsGame> {
  await session.claimSeat(1, 'host', 'Ann');
  await session.claimSeat(2, 'guest', 'Bo');
  await session.setReady('host', true);
  await session.setReady('guest', true);
  return session.runner.game;
}

describe('the lobby host cannot reach an engine-owned option (#447 review)', () => {
  it.each(['seed', 'elementIdKey'])('refuses %s by name and keeps the stored options as they were', async (key) => {
    const session = lobby({ gameOptions: selectGameOptions(gameOptionsDefinitions, { rounds: 5 }) });
    await session.claimSeat(1, 'host', 'Ann');

    const result = await session.updateGameOptions('host', { [key]: '0000000000000447' });

    expect(result.success).toBe(false);
    expect(result.error).toContain(`"${key}"`);
    expect(session.getLobbyInfo('host')?.gameOptions).toEqual({ rounds: 5 });
  });

  it('refuses an option the game did not declare, naming the declared ones', async () => {
    const session = lobby();
    await session.claimSeat(1, 'host', 'Ann');

    const result = await session.updateGameOptions('host', { notDeclared: 1 });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/"notDeclared".*rounds, hardMode/);
  });

  it('starts the game on the session seed and an engine-minted key whatever the host sent', async () => {
    const session = lobby();
    await session.claimSeat(1, 'host', 'Ann');
    await session.updateGameOptions('host', { seed: 'chosen', elementIdKey: '0000000000000447' });

    const game = await startedGame(session);
    const built = game.getConstructorOptions();

    expect(built.seed).toBe('host-seed');
    expect(built.elementIdKey).toMatch(/^[0-9a-f]{16}$/);
    expect(built.elementIdKey).not.toBe('0000000000000447');
  });

  it('a declared option reaches the game typed, and the lobby shows it', async () => {
    const session = lobby();
    await session.claimSeat(1, 'host', 'Ann');

    const result = await session.updateGameOptions('host', { rounds: '7', hardMode: 'true' });

    expect(result.success).toBe(true);
    expect(result.lobby?.gameOptions).toEqual({ rounds: 7, hardMode: true });
    const game = await startedGame(session);
    expect(game.options.rounds).toBe(7);
    expect(game.options.hardMode).toBe(true);
  });
});

describe('GameSession.create keeps its own fields above the selection', () => {
  it('a selection smuggled past the type cannot set seed, elementIdKey or playerCount', async () => {
    // The brand makes this a compile error for honest code; the cast stands in
    // for a host that spread a client's object (ShufflewickPub #553).
    const smuggled = { seed: 'chosen', elementIdKey: '0000000000000447', playerCount: 9, rounds: 2 } as unknown as GameOptionSelection;
    const session = lobby({ gameOptions: smuggled });

    const before = session.runner.game.getConstructorOptions();
    expect(before.seed).toBe('host-seed');
    expect(before.elementIdKey).not.toBe('0000000000000447');
    expect(before.playerCount).toBe(2);

    const game = await startedGame(session);
    const built = game.getConstructorOptions();
    expect(built.seed).toBe('host-seed');
    expect(built.elementIdKey).not.toBe('0000000000000447');
    expect(built.playerCount).toBe(2);
    expect(game.options.rounds).toBe(2);
  });

  it('refuses a game whose declarations name a host-owned field', () => {
    expect(() =>
      GameSession.create<OptionsGame>({
        gameType: 'options',
        GameClass: OptionsGame,
        playerCount: 2,
        playerNames: ['Ann', 'Bo'],
        gameOptionsDefinitions: { seed: { type: 'number', label: 'Seed' } },
      }),
    ).toThrow(/"seed"/);
  });

  it('a host-held elementIdKey is the one the game and its lobby restart are built with', async () => {
    const session = lobby({ elementIdKey: '0123456789abcdef' });
    expect(session.runner.game.getConstructorOptions().elementIdKey).toBe('0123456789abcdef');

    const game = await startedGame(session);
    expect(game.getConstructorOptions().elementIdKey).toBe('0123456789abcdef');
  });
});

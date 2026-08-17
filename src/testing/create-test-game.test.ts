/**
 * `createTestGame` is the function the docs tell game authors to start their
 * test suites with. Several test files in this repo define a LOCAL helper of
 * the same name, which is why the exported one went unexercised — a same-named
 * local satisfies a name search but not the API.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type FlowContext,
} from '../engine/index.js';
import { createTestGame } from './test-game.js';
import { TestGame } from './test-game.js';

class CountPlayer extends Player {
  claimed = 0;
}

class CountGame extends Game<CountGame, CountPlayer> {
  static PlayerClass = CountPlayer;
  total = 0;
  variant: string;

  constructor(options: GameOptions & { variant?: string }) {
    super(options);
    this.variant = options.variant ?? 'standard';

    this.registerAction(
      Action.create<CountGame>('claim')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          const game = ctx.game as CountGame;
          game.total += args.value as number;
          (ctx.player as CountPlayer).claimed += 1;
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx: FlowContext) => (ctx.game as CountGame).total < 6,
          maxIterations: 50,
          do: eachPlayer({ do: actionStep({ actions: ['claim'] }) }),
        }),
      }),
    );
  }
}

describe('createTestGame', () => {
  it('returns a TestGame wrapping the game class', () => {
    const testGame = createTestGame(CountGame, { playerCount: 2 });
    expect(testGame).toBeInstanceOf(TestGame);
    expect(testGame.game).toBeInstanceOf(CountGame);
  });

  it('creates the requested number of players', () => {
    expect(createTestGame(CountGame, { playerCount: 3 }).game.players).toHaveLength(3);
  });

  it('names the players by default', () => {
    expect(createTestGame(CountGame, { playerCount: 2 }).game.players.map((p) => p.name))
      .toEqual(['Player 1', 'Player 2']);
  });

  it('honours explicit player names', () => {
    const testGame = createTestGame(CountGame, {
      playerCount: 2,
      playerNames: ['Ada', 'Grace'],
    });
    expect(testGame.game.players.map((p) => p.name)).toEqual(['Ada', 'Grace']);
  });

  it('starts the game by default, so an action can be taken immediately', () => {
    const testGame = createTestGame(CountGame, { playerCount: 2 });
    expect(testGame.getFlowState()?.awaitingInput).toBe(true);
    expect(() => testGame.doAction(1, 'claim', { value: 1 })).not.toThrow();
  });

  it('leaves the game unstarted when asked', () => {
    const testGame = createTestGame(CountGame, { playerCount: 2, autoStart: false });
    expect(testGame.getFlowState()?.awaitingInput ?? false).toBe(false);
  });

  it('is deterministic by default — two games share a seed', () => {
    expect(createTestGame(CountGame, { playerCount: 2 }).seed)
      .toBe(createTestGame(CountGame, { playerCount: 2 }).seed);
  });

  it('records the seed it used, so a failure is reproducible', () => {
    expect(createTestGame(CountGame, { playerCount: 2, seed: 'my-seed' }).seed).toBe('my-seed');
  });

  it('produces the same random draws for the same seed', () => {
    const first = createTestGame(CountGame, { playerCount: 2, seed: 'shared' });
    const second = createTestGame(CountGame, { playerCount: 2, seed: 'shared' });
    expect(first.game.random()).toBe(second.game.random());
  });

  it('forwards game-specific options to the game constructor', () => {
    const testGame = createTestGame(CountGame, { playerCount: 2, variant: 'quick' } as never);
    expect(testGame.game.variant).toBe('quick');
  });

  it('uses the custom player class the game declares', () => {
    const testGame = createTestGame(CountGame, { playerCount: 2 });
    expect(testGame.game.players[0]).toBeInstanceOf(CountPlayer);
  });

  it('is exactly TestGame.create — one construction path, not two', () => {
    const viaFunction = createTestGame(CountGame, { playerCount: 2, seed: 'parity' });
    const viaStatic = TestGame.create(CountGame, { playerCount: 2, seed: 'parity' });
    expect(viaFunction.seed).toBe(viaStatic.seed);
    expect(viaFunction.game.players).toHaveLength(viaStatic.game.players.length);
    expect(viaFunction.constructor).toBe(viaStatic.constructor);
  });

  it('drives a real game through to completion', () => {
    const testGame = createTestGame(CountGame, { playerCount: 2 });
    testGame.doAction(1, 'claim', { value: 3 });
    testGame.doAction(2, 'claim', { value: 3 });
    expect(testGame.game.total).toBe(6);
    expect(testGame.isComplete()).toBe(true);
  });

  it('gives each created game independent state', () => {
    const first = createTestGame(CountGame, { playerCount: 2 });
    const second = createTestGame(CountGame, { playerCount: 2 });
    first.doAction(1, 'claim', { value: 2 });
    expect(first.game.total).toBe(2);
    expect(second.game.total).toBe(0);
  });
});

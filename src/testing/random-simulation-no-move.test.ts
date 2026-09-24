import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { simulateRandomGames, replayRandomGame } from './random-simulation.js';

/**
 * Both seats spend coins in one simultaneous step that never ends on its own,
 * and `spend` is `.disabled()` once a seat is out of coins. So the game has no
 * ending: once every seat is broke no move exists. That is the shape of a game
 * built chunk by chunk before the chunk that ends it (#317), and the shape of
 * an action the panel greys out rather than hides (#318).
 *
 * `coins` is a game option listing each seat's starting coins, seat 1 first.
 */
class CoinGame extends Game<CoinGame, Player> {
  readonly coins: number[];
  spent = 0;

  constructor(options: GameOptions) {
    super(options);
    this.coins = [...((options as { coins?: number[] }).coins ?? [3, 3])];

    this.registerAction(
      Action.create<CoinGame>('spend')
        .disabled((ctx) => (ctx.game.coins[ctx.player.seat - 1] < 1 ? 'You have no coins.' : false))
        .execute((_args, ctx) => {
          ctx.game.coins[ctx.player.seat - 1] -= 1;
          ctx.game.spent += 1;
        }),
    );

    this.setFlow(
      defineFlow({
        root: simultaneousActionStep({ actions: ['spend'], playerDone: () => false }),
      }),
    );
  }
}

const NO_ENABLED_ACTION = /^Game is awaiting input but no player has an enabled action to take\./;

describe('#318: a .disabled() action is not a playable move', () => {
  it('stops a game on "no enabled action" once every seat is refused, not on repeated rejections', async () => {
    const results = await simulateRandomGames(CoinGame, {
      count: 4,
      playerCounts: [2],
      seed: 'disabled-318',
      gameOptions: { coins: [3, 3] },
    });

    expect(results.crashed).toBe(0);
    for (const game of results.games) {
      expect(game.stuck).toBe(true);
      expect(game.error).toMatch(NO_ENABLED_ACTION);
      expect(game.error).not.toMatch(/consecutive actions/);
      expect(game.actionCount).toBe(6);
      expect(game.error).toContain("Refused: player 1's 'spend' (You have no coins); player 2's 'spend' (You have no coins).");
    }
  });

  it('keeps playing the seat that still has an enabled action while the other is refused', async () => {
    const results = await simulateRandomGames(CoinGame, {
      count: 4,
      playerCounts: [2],
      seed: 'disabled-318-lopsided',
      gameOptions: { coins: [0, 25] },
    });

    for (const game of results.games) {
      expect(game.error).toMatch(NO_ENABLED_ACTION);
      expect(game.actionCount).toBe(25);
    }
  });
});

/** The rest CoinGame is built to reach: nobody can spend, because nobody has a coin. */
const broke = (game: CoinGame): string | false =>
  game.coins.every((c) => c === 0) ? 'every seat has spent its coins; the ending is not built yet' : false;

describe('#317: a game can declare where it is meant to rest', () => {
  it('reports a game stopped at its declared rest as resting, with the reason, and not as stuck', async () => {
    const results = await simulateRandomGames(CoinGame, {
      count: 4,
      playerCounts: [2],
      seed: 'rest-317',
      gameOptions: { coins: [2, 3] },
      isResting: broke,
    });

    expect(results.resting).toBe(4);
    expect(results.stuck).toBe(0);
    expect(results.completed).toBe(0);
    expect(results.errors).toEqual([]);
    for (const game of results.games) {
      expect(game.resting).toBe(true);
      expect(game.stuck).toBe(false);
      expect(game.restReason).toBe('every seat has spent its coins; the ending is not built yet');
      expect(game.error).toBeUndefined();
      expect(game.actionCount).toBe(5);
    }
  });

  it('hands isResting the stopped game itself, so a test can check its final state', async () => {
    const finals: CoinGame[] = [];
    await simulateRandomGames(CoinGame, {
      count: 2,
      playerCounts: [2],
      seed: 'rest-317-state',
      gameOptions: { coins: [1, 2] },
      isResting: (game) => {
        finals.push(game);
        return broke(game);
      },
    });

    expect(finals).toHaveLength(2);
    for (const game of finals) {
      expect(game).toBeInstanceOf(CoinGame);
      expect(game.spent).toBe(3);
    }
  });

  it('still reports a stop the game did not declare as stuck, and says how to declare one', async () => {
    const results = await simulateRandomGames(CoinGame, {
      count: 2,
      playerCounts: [2],
      seed: 'rest-317-undeclared',
      gameOptions: { coins: [1, 1] },
      isResting: () => false,
    });

    expect(results.resting).toBe(0);
    expect(results.stuck).toBe(2);
    for (const game of results.games) {
      expect(game.resting).toBe(false);
      expect(game.restReason).toBeUndefined();
      expect(game.error).toMatch(NO_ENABLED_ACTION);
      expect(game.error).toContain('isResting');
    }
  });

  it('is not asked about a game the simulator could not play, so it cannot hide a real failure', async () => {
    class TextGame extends CoinGame {
      constructor(options: GameOptions) {
        super(options);
        this.registerAction(Action.create<TextGame>('name').enterText('label').execute(() => {}));
        this.setFlow(defineFlow({ root: simultaneousActionStep({ actions: ['name'], playerDone: () => false }) }));
      }
    }
    let asked = 0;
    const results = await simulateRandomGames(TextGame, {
      count: 1,
      playerCounts: [2],
      seed: 'rest-317-text',
      isResting: () => {
        asked++;
        return 'never';
      },
    });

    expect(asked).toBe(0);
    expect(results.stuck).toBe(1);
    expect(results.resting).toBe(0);
    expect(results.games[0].error).toMatch(/requires text input 'label'/);
  });

  it('replayRandomGame takes the same isResting, so a replay gives the same verdict', async () => {
    const results = await simulateRandomGames(CoinGame, {
      count: 1,
      playerCounts: [2],
      seed: 'rest-317-replay',
      gameOptions: { coins: [2, 2] },
      isResting: broke,
    });
    const [played] = results.games;

    const replay = await replayRandomGame(CoinGame, {
      seed: played.seed,
      playerCount: played.playerCount,
      gameOptions: { coins: [2, 2] },
      isResting: broke,
    });

    expect(replay.resting).toBe(true);
    expect(replay.restReason).toBe(played.restReason);
    expect(replay.actionCount).toBe(played.actionCount);
  });
});

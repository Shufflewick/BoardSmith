import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { simulateRandomGames } from './random-simulation.js';

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

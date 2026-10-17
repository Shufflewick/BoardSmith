import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action, actionStep, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { DeterminizeSampler, MCTSNode } from './types.js';

// #876: a move that picks an element is the same move in every sampled world.
// Its key used to be the JSON of the element's whole subtree, so a sampler
// re-rolling a hidden card inside it gave the move a new key per world and the
// root's move list grew by one on most iterations.

class Card extends Piece<HandGame> {
  rank = 0;
}

class HandGame extends Game<HandGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Space]);
    for (const player of this.players) {
      const hand = this.create(Space<HandGame>, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      hand.create(Card, `card-${player.seat}`, { rank: player.seat });
    }

    this.registerAction(
      Action.create('pick')
        .chooseFrom('hand', { choices: () => [...this.all(Space)] })
        .execute((_args, ctx) => {
          this.finish([ctx.player]);
          return { success: true };
        }),
    );
    this.setFlow({ root: actionStep({ actions: ['pick'], player: () => this.getPlayer(1)! }) });
  }
}

/** Every hidden card gets a fresh rank from a wide pool, so worlds rarely repeat. */
const sampler: DeterminizeSampler = (sandbox, _seat, rng) => {
  for (const card of (sandbox as HandGame).all(Card)) {
    if (card.isAttributeRedacted('rank')) card.rank = Math.floor(rng() * 1000);
  }
};

describe('MCTSBot: element moves keep one key across worlds (#876)', () => {
  it('lists each root move once however many worlds the search samples', async () => {
    const game = new HandGame({ playerCount: 2, seed: 'bs876' });
    game.startFlow();
    const bot = new MCTSBot(
      game, HandGame, 'hand', 1, [],
      { iterations: 60, playoutDepth: 1, seed: 'bs876', async: false, timeout: Infinity, usePNS: false },
      { determinize: sampler },
    ) as unknown as { runSearch(): Promise<{ root: MCTSNode }> };

    const { root } = await bot.runSearch();

    expect(root.allMoves).toHaveLength(2);
  });
});

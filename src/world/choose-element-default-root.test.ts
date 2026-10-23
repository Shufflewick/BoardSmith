/**
 * A chooseElement with no `from` searches the game its callbacks are handed
 * (#771): a world offer's read-only projection, not the live game.
 */
import { describe, it, expect } from 'vitest';
import { Action, Game, Piece, Space, type GameOptions } from '../engine/index.js';
import { readOnlyScope } from './readonly.js';

class Token extends Piece<SeenGame> {
  seen = 0;
}
class Hand extends Space<SeenGame> {}

class SeenGame extends Game<SeenGame> {
  hand = this.create(Hand, 'hand');

  constructor(options: GameOptions) {
    super(options);
    this.hand.createMany(2, Token, 'token');
    this.registerAction(
      Action.create<SeenGame>('omitted')
        .chooseElement('token', { elementClass: Token, filter: (el) => (++(el as Token).seen, true) })
        .execute(() => {}),
    );
    this.registerAction(
      Action.create<SeenGame>('named')
        .chooseElement('token', { elementClass: Token, from: (ctx) => ctx.game.hand, filter: (el) => (++(el as Token).seen, true) })
        .execute(() => {}),
    );
  }
}

function offer(game: SeenGame, name: string, reading?: SeenGame) {
  const pick = game.getAction(name)!.selections[0];
  return game.getActionExecutor().getChoices(pick, game.getPlayer(1)!, {}, name, reading);
}

describe('chooseElement default root (#771)', () => {
  const fresh = () => new SeenGame({ playerCount: 1, seed: 'bs771' });
  const seenOf = (game: SeenGame) => game.hand.all(Token).map((t) => t.seen);

  it('refuses a filter write in a world offer with `from` omitted, as with `from` named, and leaves the live game alone', () => {
    for (const name of ['named', 'omitted']) {
      const game = fresh();
      expect(() => offer(game, name, readOnlyScope()(game))).toThrow();
      expect(seenOf(game)).toEqual([0, 0]);
    }
  });

  it('still finds the same elements in a table game', () => {
    const game = fresh();
    const ids = game.hand.all(Token).map((t) => t.id);
    expect(offer(game, 'omitted').map((c) => (c.value as Token).id)).toEqual(ids);
    expect(offer(game, 'named').map((c) => (c.value as Token).id)).toEqual(ids);
  });
});

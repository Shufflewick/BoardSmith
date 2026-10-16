/**
 * BOARDSMITH #770: availability binds an array where the earlier pick is an array.
 *
 * A pick that takes several values (chooseElements, multiSelect, orderedList)
 * answers with an array, so a dependent pick's callback must see an array while
 * availability walks it, not one bare candidate.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, Piece } from '../index.js';
import { ActionExecutor } from './action.js';

class Card extends Piece {}
class CardGame extends Game<CardGame, Player> {}

function setup() {
  const game = new CardGame({ playerCount: 2 });
  game.create(Card, 'ace');
  game.create(Card, 'king');
  return { game, executor: new ActionExecutor(game), player: game.getPlayer(1)! };
}

// Throws on a non-array, as the issue's callback does.
const namesOf = (picked: unknown) => (picked ? (picked as { name: string }[]).map((c) => c.name) : []);

describe('#770 availability with a dependent pick after an array pick', () => {
  it('chooseElements then a dependent chooseFrom', () => {
    const { game, executor, player } = setup();
    const action = Action.create('play')
      .chooseElements('cards', { elements: () => [...game.all(Card)] })
      .chooseFrom('target', { dependsOn: 'cards', choices: (ctx: any) => namesOf(ctx.args.cards) })
      .execute(() => {});
    expect(executor.isActionAvailable(action, player)).toBe(true);
  });

  it('multiSelect then a dependent chooseFrom', () => {
    const { executor, player } = setup();
    const action = Action.create('play')
      .chooseFrom('picks', { choices: ['a', 'b'], multiSelect: 2 })
      .chooseFrom('target', {
        dependsOn: 'picks',
        choices: (ctx: any) => (ctx.args.picks ? (ctx.args.picks as string[]).map((p) => p + '!') : []),
      })
      .execute(() => {});
    expect(executor.isActionAvailable(action, player)).toBe(true);
  });

  it('orderedList then a dependent chooseFrom', () => {
    const { executor, player } = setup();
    const action = Action.create('play')
      .chooseFrom('order', { choices: ['a', 'b'], orderedList: { min: 1, max: 2 } })
      .chooseFrom('target', {
        dependsOn: 'order',
        choices: (ctx: any) => (ctx.args.order ? (ctx.args.order as string[]).map((p) => p + '!') : []),
      })
      .execute(() => {});
    expect(executor.isActionAvailable(action, player)).toBe(true);
  });

  it('is unavailable when the dependent pick has nothing for any array', () => {
    const { executor, player } = setup();
    const action = Action.create('play')
      .chooseFrom('picks', { choices: ['a', 'b'], multiSelect: 2 })
      .chooseFrom('target', {
        dependsOn: 'picks',
        choices: (ctx: any) => ((ctx.args.picks as string[] | undefined)?.length ? [] : ['x']),
      })
      .execute(() => {});
    expect(executor.isActionAvailable(action, player)).toBe(false);
  });
});

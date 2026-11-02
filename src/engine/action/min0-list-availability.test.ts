/**
 * BOARDSMITH #1558: a min-0 multiSelect or orderedList with no enabled choice
 * still has an answer, `[]`, so availability offers the action as
 * validateAction and enumerateLegalMoves do.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, Piece, actionStep, type GameOptions } from '../index.js';
import { ActionExecutor } from './action.js';

class Card extends Piece {}

const shapes = {
  'a multiSelect whose choices are all disabled': { choices: () => ['A'], disabled: () => 'not allowed', multiSelect: { min: 0, max: 1 } },
  'a multiSelect with no choices': { choices: () => [] as string[], multiSelect: { min: 0, max: 1 } },
  'an orderedList whose choices are all disabled': { choices: () => ['A'], disabled: () => 'not allowed', orderedList: { min: 0, max: 1 } },
};

describe('a min-0 list pick with no enabled choice keeps its action offered (#1558)', () => {
  for (const [name, options] of Object.entries(shapes)) {
    it(`${name}, asked first, is offered by an actionStep`, () => {
      class HireGame extends Game<HireGame, Player> {
        constructor(gameOptions: GameOptions) {
          super(gameOptions);
          this.registerAction(Action.create<HireGame>('hire').chooseFrom('picked', options).execute(() => ({ success: true })));
          this.setFlow({ root: actionStep({ actions: ['hire'] }) });
        }
      }
      const game = new HireGame({ playerCount: 1, playerNames: ['A'], seed: 'bs1558' });
      game.startFlow();
      const player = game.getPlayer(1)!;
      const hire = game.getAction('hire')!;

      expect(game.getFlowState()!.complete).toBe(false);
      expect(game.getActionExecutor().isActionAvailable(hire, player)).toBe(true);
      expect(game.getActionExecutor().hasFollowUpChoices(hire, player, {})).toBe(true);
      expect(game.getActionExecutor().validateAction(hire, player, { picked: [] }).valid).toBe(true);
    });

    it(`${name}, depending on an earlier pick, is offered`, () => {
      const game = new Game({ playerCount: 1 });
      const action = Action.create('hire')
        .chooseFrom('who', { choices: ['x'] })
        .chooseFrom('picked', { ...options, dependsOn: 'who' })
        .execute(() => {});
      expect(new ActionExecutor(game).isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
    });
  }

  it('a chooseElements multiSelect with no elements, asked first, is offered', () => {
    const game = new Game({ playerCount: 1 });
    const action = Action.create('hire')
      .chooseElements('cards', { elements: () => [...game.all(Card)], multiSelect: { min: 0, max: 1 } })
      .execute(() => {});
    const executor = new ActionExecutor(game);
    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
    expect(executor.validateAction(action, game.getPlayer(1)!, { cards: [] }).valid).toBe(true);
  });

  it('binds the empty answer for a pick that depends on a min-0 list pick', () => {
    const game = new Game({ playerCount: 1 });
    const action = Action.create('hire')
      .chooseFrom('picked', { choices: ['A'], multiSelect: { min: 0, max: 1 } })
      .chooseFrom('target', {
        dependsOn: 'picked',
        choices: (ctx: { args: { picked?: string[] } }) => (ctx.args.picked?.length === 0 ? ['solo'] : []),
      })
      .execute(() => {});
    expect(new ActionExecutor(game).isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
  });

  it('a min-1 multiSelect with no enabled choice is still not offered', () => {
    const game = new Game({ playerCount: 1 });
    const action = Action.create('hire')
      .chooseFrom('picked', { choices: ['A'], disabled: () => 'not allowed', multiSelect: { min: 1, max: 1 } })
      .execute(() => {});
    expect(new ActionExecutor(game).isActionAvailable(action, game.getPlayer(1)!)).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  ActionExecutor,
} from '../src/index.js';
import type { ActionContext, ActionDefinition } from '../src/index.js';

// Test classes
class TestGame extends Game<TestGame, Player> {}

class Card extends Piece<TestGame> {
  suit!: string;
  rank!: string;
  value!: number;
}

class Hand extends Space<TestGame> {}
class Deck extends Space<TestGame> {}

describe('Action Builder', () => {
  it('should create a basic action', () => {
    const action = Action.create('test')
      .prompt('Test action')
      .execute(() => {});

    expect(action.name).toBe('test');
    expect(action.prompt).toBe('Test action');
    expect(action.selections).toHaveLength(0);
  });

  it('should add choice selection', () => {
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue', 'green'],
        prompt: 'Pick a color',
      })
      .execute(() => {});

    expect(action.selections).toHaveLength(1);
    expect(action.selections[0].type).toBe('choice');
    expect(action.selections[0].name).toBe('color');
  });

  it('should add player selection', () => {
    const action = Action.create('test')
      .choosePlayer('target', {
        prompt: 'Choose a player',
      })
      .execute(() => {});

    expect(action.selections).toHaveLength(1);
    expect(action.selections[0].type).toBe('player');
  });

  it('should add element selection', () => {
    const action = Action.create('test')
      .chooseElement('card', {
        prompt: 'Choose a card',
        elementClass: Card,
      })
      .execute(() => {});

    expect(action.selections).toHaveLength(1);
    expect(action.selections[0].type).toBe('element');
  });

  it('should add text selection', () => {
    const action = Action.create('test')
      .enterText('name', {
        prompt: 'Enter name',
        minLength: 1,
        maxLength: 20,
      })
      .execute(() => {});

    expect(action.selections).toHaveLength(1);
    expect(action.selections[0].type).toBe('text');
  });

  it('should add number selection', () => {
    const action = Action.create('test')
      .enterNumber('amount', {
        prompt: 'Enter amount',
        min: 1,
        max: 10,
        integer: true,
      })
      .execute(() => {});

    expect(action.selections).toHaveLength(1);
    expect(action.selections[0].type).toBe('number');
  });

  it('should chain multiple selections', () => {
    const action = Action.create('ask')
      .prompt('Ask for cards')
      .choosePlayer('target', { prompt: 'Who?' })
      .chooseFrom('rank', {
        choices: ['A', 'K', 'Q', 'J'],
        prompt: 'What rank?',
      })
      .execute(() => {});

    expect(action.selections).toHaveLength(2);
  });

  it('should set condition', () => {
    const action = Action.create('test')
      .condition((ctx) => ctx.player.position === 0)
      .execute(() => {});

    expect(action.condition).toBeDefined();
  });
});

describe('Action Executor', () => {
  let game: TestGame;
  let executor: ActionExecutor;

  beforeEach(() => {
    game = new TestGame({ playerCount: 3 });
    executor = new ActionExecutor(game);
  });

  describe('getChoices', () => {
    it('should return static choices', () => {
      const action = Action.create('test')
        .chooseFrom('color', { choices: ['red', 'blue', 'green'] })
        .execute(() => {});

      const choices = executor.getChoices(
        action.selections[0],
        game.players[0],
        {}
      );

      expect(choices).toEqual(['red', 'blue', 'green']);
    });

    it('should return dynamic choices', () => {
      const action = Action.create('test')
        .chooseFrom('double', {
          choices: (ctx) => [ctx.player.position * 2],
        })
        .execute(() => {});

      const choices = executor.getChoices(
        action.selections[0],
        game.players[1],
        {}
      );

      expect(choices).toEqual([2]);
    });

    it('should filter players', () => {
      const action = Action.create('test')
        .choosePlayer('target', {
          filter: (p, ctx) => p !== ctx.player,
        })
        .execute(() => {});

      const choices = executor.getChoices(
        action.selections[0],
        game.players[0],
        {}
      );

      expect(choices).toHaveLength(2);
      expect(choices).not.toContain(game.players[0]);
    });

    it('should filter elements by class', () => {
      const deck = game.create(Deck, 'deck');
      deck.createMany(5, Card, 'card', (i) => ({
        suit: 'H',
        rank: String(i + 1),
        value: i + 1,
      }));

      const action = Action.create('test')
        .chooseElement('card', {
          elementClass: Card,
        })
        .execute(() => {});

      const choices = executor.getChoices(
        action.selections[0],
        game.players[0],
        {}
      );

      expect(choices).toHaveLength(5);
    });

    it('should filter elements with custom filter', () => {
      const deck = game.create(Deck, 'deck');
      deck.createMany(5, Card, 'card', (i) => ({
        suit: 'H',
        rank: String(i + 1),
        value: i + 1,
      }));

      const action = Action.create('test')
        .chooseElement('card', {
          elementClass: Card,
          filter: (e) => (e as Card).value >= 3,
        })
        .execute(() => {});

      const choices = executor.getChoices(
        action.selections[0],
        game.players[0],
        {}
      );

      expect(choices).toHaveLength(3); // 3, 4, 5
    });
  });

  describe('shouldSkip', () => {
    it('should skip when only one choice and skipIfOnlyOne is true', () => {
      const action = Action.create('test')
        .chooseFrom('choice', {
          choices: ['only'],
          skipIfOnlyOne: true,
        })
        .execute(() => {});

      const result = executor.shouldSkip(
        action.selections[0],
        game.players[0],
        {}
      );

      expect(result.skip).toBe(true);
      expect(result.value).toBe('only');
    });

    it('should not skip when multiple choices', () => {
      const action = Action.create('test')
        .chooseFrom('choice', {
          choices: ['a', 'b'],
          skipIfOnlyOne: true,
        })
        .execute(() => {});

      const result = executor.shouldSkip(
        action.selections[0],
        game.players[0],
        {}
      );

      expect(result.skip).toBe(false);
    });
  });

  describe('validateSelection', () => {
    it('should validate choice is in valid choices', () => {
      const action = Action.create('test')
        .chooseFrom('color', { choices: ['red', 'blue'] })
        .execute(() => {});

      const valid = executor.validateSelection(
        action.selections[0],
        'red',
        game.players[0],
        {}
      );

      const invalid = executor.validateSelection(
        action.selections[0],
        'green',
        game.players[0],
        {}
      );

      expect(valid.valid).toBe(true);
      expect(invalid.valid).toBe(false);
    });

    it('should validate text min/max length', () => {
      const action = Action.create('test')
        .enterText('name', { minLength: 2, maxLength: 5 })
        .execute(() => {});

      const tooShort = executor.validateSelection(
        action.selections[0],
        'a',
        game.players[0],
        {}
      );

      const tooLong = executor.validateSelection(
        action.selections[0],
        'abcdef',
        game.players[0],
        {}
      );

      const justRight = executor.validateSelection(
        action.selections[0],
        'abc',
        game.players[0],
        {}
      );

      expect(tooShort.valid).toBe(false);
      expect(tooLong.valid).toBe(false);
      expect(justRight.valid).toBe(true);
    });

    it('should validate number min/max', () => {
      const action = Action.create('test')
        .enterNumber('amount', { min: 1, max: 10 })
        .execute(() => {});

      const tooSmall = executor.validateSelection(
        action.selections[0],
        0,
        game.players[0],
        {}
      );

      const tooBig = executor.validateSelection(
        action.selections[0],
        11,
        game.players[0],
        {}
      );

      const justRight = executor.validateSelection(
        action.selections[0],
        5,
        game.players[0],
        {}
      );

      expect(tooSmall.valid).toBe(false);
      expect(tooBig.valid).toBe(false);
      expect(justRight.valid).toBe(true);
    });

    it('should validate integer requirement', () => {
      const action = Action.create('test')
        .enterNumber('amount', { integer: true })
        .execute(() => {});

      const notInt = executor.validateSelection(
        action.selections[0],
        3.5,
        game.players[0],
        {}
      );

      const isInt = executor.validateSelection(
        action.selections[0],
        3,
        game.players[0],
        {}
      );

      expect(notInt.valid).toBe(false);
      expect(isInt.valid).toBe(true);
    });

    it('should run custom validation', () => {
      const action = Action.create('test')
        .enterText('name', {
          validate: (value) => value !== 'forbidden' || 'That name is forbidden',
        })
        .execute(() => {});

      const forbidden = executor.validateSelection(
        action.selections[0],
        'forbidden',
        game.players[0],
        {}
      );

      const allowed = executor.validateSelection(
        action.selections[0],
        'allowed',
        game.players[0],
        {}
      );

      expect(forbidden.valid).toBe(false);
      expect(forbidden.errors[0]).toBe('That name is forbidden');
      expect(allowed.valid).toBe(true);
    });
  });

  describe('validateAction', () => {
    it('should validate complete action args', () => {
      const action = Action.create('ask')
        .choosePlayer('target', {
          filter: (p, ctx) => p !== ctx.player,
        })
        .chooseFrom('rank', { choices: ['A', 'K', 'Q'] })
        .execute(() => {});

      const result = executor.validateAction(action, game.players[0], {
        target: game.players[1],
        rank: 'A',
      });

      expect(result.valid).toBe(true);
    });

    it('should fail on missing required selection', () => {
      const action = Action.create('test')
        .chooseFrom('required', { choices: ['a', 'b'] })
        .execute(() => {});

      const result = executor.validateAction(action, game.players[0], {});

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Missing required');
    });

    it('should pass on missing optional selection', () => {
      const action = Action.create('test')
        .chooseFrom('optional', {
          choices: ['a', 'b'],
          optional: true,
        })
        .execute(() => {});

      const result = executor.validateAction(action, game.players[0], {});

      expect(result.valid).toBe(true);
    });

    it('should fail if condition not met', () => {
      const action = Action.create('test')
        .condition(() => false)
        .execute(() => {});

      const result = executor.validateAction(action, game.players[0], {});

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not available');
    });
  });

  describe('executeAction', () => {
    it('should execute action and return success', () => {
      let executed = false;
      const action = Action.create('test').execute(() => {
        executed = true;
        return { success: true, message: 'Done!' };
      });

      const result = executor.executeAction(action, game.players[0], {});

      expect(result.success).toBe(true);
      expect(result.message).toBe('Done!');
      expect(executed).toBe(true);
    });

    it('should pass args to execute handler', () => {
      let receivedArgs: Record<string, unknown> = {};
      const action = Action.create('test')
        .chooseFrom('choice', { choices: ['a', 'b'] })
        .execute((args) => {
          receivedArgs = args;
        });

      executor.executeAction(action, game.players[0], { choice: 'a' });

      expect(receivedArgs.choice).toBe('a');
    });

    it('should pass context to execute handler', () => {
      let receivedContext: ActionContext | null = null;
      const action = Action.create('test').execute((args, ctx) => {
        receivedContext = ctx;
      });

      executor.executeAction(action, game.players[1], {});

      expect(receivedContext?.player).toBe(game.players[1]);
      expect(receivedContext?.game).toBe(game);
    });

    it('should fail if validation fails', () => {
      const action = Action.create('test')
        .chooseFrom('choice', { choices: ['a', 'b'] })
        .execute(() => {});

      const result = executor.executeAction(action, game.players[0], {
        choice: 'invalid',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid selection');
    });

    it('should catch execution errors', () => {
      const action = Action.create('test').execute(() => {
        throw new Error('Something went wrong');
      });

      const result = executor.executeAction(action, game.players[0], {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
    });
  });

  describe('isActionAvailable', () => {
    it('should return true when condition passes', () => {
      const action = Action.create('test')
        .condition(() => true)
        .execute(() => {});

      expect(executor.isActionAvailable(action, game.players[0])).toBe(true);
    });

    it('should return false when condition fails', () => {
      const action = Action.create('test')
        .condition(() => false)
        .execute(() => {});

      expect(executor.isActionAvailable(action, game.players[0])).toBe(false);
    });

    it('should return false when no valid choices for required selection', () => {
      const action = Action.create('test')
        .chooseElement('card', { elementClass: Card })
        .execute(() => {});

      // No cards in game
      expect(executor.isActionAvailable(action, game.players[0])).toBe(false);
    });

    it('should return true when optional selection has no choices', () => {
      const action = Action.create('test')
        .chooseElement('card', {
          elementClass: Card,
          optional: true,
        })
        .execute(() => {});

      expect(executor.isActionAvailable(action, game.players[0])).toBe(true);
    });
  });
});

describe('Game Action Integration', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    game.create(Hand, 'hand', { player: game.players[0] });
    game.create(Hand, 'hand', { player: game.players[1] });
    const deck = game.create(Deck, 'deck');
    deck.createMany(10, Card, 'card', (i) => ({
      suit: i < 5 ? 'H' : 'S',
      rank: String((i % 5) + 1),
      value: (i % 5) + 1,
    }));
  });

  it('should register and retrieve actions', () => {
    const action = Action.create('draw')
      .prompt('Draw a card')
      .execute(() => {});

    game.registerAction(action);

    expect(game.getAction('draw')).toBe(action);
    expect(game.getActionNames()).toContain('draw');
  });

  it('should register multiple actions', () => {
    const action1 = Action.create('one').execute(() => {});
    const action2 = Action.create('two').execute(() => {});

    game.registerActions(action1, action2);

    expect(game.getActionNames()).toContain('one');
    expect(game.getActionNames()).toContain('two');
  });

  it('should get available actions for player', () => {
    const always = Action.create('always')
      .condition(() => true)
      .execute(() => {});

    const never = Action.create('never')
      .condition(() => false)
      .execute(() => {});

    game.registerActions(always, never);

    const available = game.getAvailableActions(game.players[0]);

    expect(available).toContain(always);
    expect(available).not.toContain(never);
  });

  it('should get selection choices', () => {
    const action = Action.create('choose')
      .chooseFrom('color', { choices: ['red', 'blue'] })
      .execute(() => {});

    game.registerAction(action);

    const choices = game.getSelectionChoices(
      'choose',
      'color',
      game.players[0]
    );

    expect(choices).toEqual(['red', 'blue']);
  });

  it('should perform action successfully', () => {
    let moved = false;
    const action = Action.create('draw')
      .chooseElement('card', { elementClass: Card })
      .execute((args) => {
        moved = true;
        const card = args.card as Card;
        return { success: true, message: `Drew ${card.rank}` };
      });

    game.registerAction(action);

    const card = game.first(Card)!;
    const result = game.performAction('draw', game.players[0], { card });

    expect(result.success).toBe(true);
    expect(moved).toBe(true);
  });

  it('should fail for unknown action', () => {
    const result = game.performAction('unknown', game.players[0], {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown action');
  });

  it('should perform serialized action', () => {
    let executed = false;
    const action = Action.create('test').execute(() => {
      executed = true;
    });

    game.registerAction(action);

    const result = game.performSerializedAction({
      name: 'test',
      player: 0,
      args: {},
    });

    expect(result.success).toBe(true);
    expect(executed).toBe(true);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  ActionExecutor,
  actionTempState,
} from '../index.js';
import type { ActionContext, ActionDefinition } from '../index.js';

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

  it('should add player selection using chooseFrom with playerChoices', () => {
    // Players are now selected using chooseFrom with the playerChoices() helper
    const action = Action.create('test')
      .chooseFrom('target', {
        prompt: 'Choose a player',
        choices: [{ value: 0, display: 'Player 1' }, { value: 1, display: 'Player 2' }],
      })
      .execute(() => {});

    expect(action.selections).toHaveLength(1);
    expect(action.selections[0].type).toBe('choice');
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
      .chooseFrom('target', {
        prompt: 'Who?',
        choices: [{ value: 0, display: 'Player 1' }, { value: 1, display: 'Player 2' }],
      })
      .chooseFrom('rank', {
        choices: ['A', 'K', 'Q', 'J'],
        prompt: 'What rank?',
      })
      .execute(() => {});

    expect(action.selections).toHaveLength(2);
  });

  it('should set condition', () => {
    const action = Action.create('test')
      .condition({
        'player is first': (ctx) => ctx.player.seat === 1,
      })
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
        game.getPlayer(1)!,
        {}
      );

      expect(choices).toEqual([
        { value: 'red', disabled: false },
        { value: 'blue', disabled: false },
        { value: 'green', disabled: false },
      ]);
    });

    it('should return dynamic choices', () => {
      const action = Action.create('test')
        .chooseFrom('double', {
          choices: (ctx) => [ctx.player.seat * 2],
        })
        .execute(() => {});

      // Player at seat 2, so seat * 2 = 4
      const choices = executor.getChoices(
        action.selections[0],
        game.getPlayer(2)!,
        {}
      );

      expect(choices).toEqual([{ value: 4, disabled: false }]);
    });

    it('should get player choices from playerChoices helper', () => {
      // With playerChoices helper, players are just choice objects
      const playerChoices = game.playerChoices({ excludeSelf: true, currentPlayer: game.getPlayer(1)! });

      expect(playerChoices).toHaveLength(2);
      expect(playerChoices.map(p => p.value)).not.toContain(1); // excludeSelf excludes player 1
      expect(playerChoices.map(p => p.value)).toContain(2);
      expect(playerChoices.map(p => p.value)).toContain(3);
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
        game.getPlayer(1)!,
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
        game.getPlayer(1)!,
        {}
      );

      expect(choices).toHaveLength(3); // 3, 4, 5
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
        game.getPlayer(1)!,
        {}
      );

      const invalid = executor.validateSelection(
        action.selections[0],
        'green',
        game.getPlayer(1)!,
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
        game.getPlayer(1)!,
        {}
      );

      const tooLong = executor.validateSelection(
        action.selections[0],
        'abcdef',
        game.getPlayer(1)!,
        {}
      );

      const justRight = executor.validateSelection(
        action.selections[0],
        'abc',
        game.getPlayer(1)!,
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
        game.getPlayer(1)!,
        {}
      );

      const tooBig = executor.validateSelection(
        action.selections[0],
        11,
        game.getPlayer(1)!,
        {}
      );

      const justRight = executor.validateSelection(
        action.selections[0],
        5,
        game.getPlayer(1)!,
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
        game.getPlayer(1)!,
        {}
      );

      const isInt = executor.validateSelection(
        action.selections[0],
        3,
        game.getPlayer(1)!,
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
        game.getPlayer(1)!,
        {}
      );

      const allowed = executor.validateSelection(
        action.selections[0],
        'allowed',
        game.getPlayer(1)!,
        {}
      );

      expect(forbidden.valid).toBe(false);
      expect(forbidden.errors[0]).toBe('That name is forbidden');
      expect(allowed.valid).toBe(true);
    });
  });

  describe('validateAction', () => {
    it('should validate complete action args', () => {
      // Using playerChoices helper pattern
      const playerChoices = game.playerChoices({ excludeSelf: true, currentPlayer: game.getPlayer(1)! });
      const action = Action.create('ask')
        .chooseFrom('target', {
          choices: playerChoices,
        })
        .chooseFrom('rank', { choices: ['A', 'K', 'Q'] })
        .execute(() => {});

      const result = executor.validateAction(action, game.getPlayer(1)!, {
        target: playerChoices[0], // First player choice (position 1)
        rank: 'A',
      });

      expect(result.valid).toBe(true);
    });

    it('should fail on missing required selection', () => {
      const action = Action.create('test')
        .chooseFrom('required', { choices: ['a', 'b'] })
        .execute(() => {});

      const result = executor.validateAction(action, game.getPlayer(1)!, {});

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

      const result = executor.validateAction(action, game.getPlayer(1)!, {});

      expect(result.valid).toBe(true);
    });

    it('should fail if condition not met', () => {
      const action = Action.create('test')
        .condition({
          'never available': () => false,
        })
        .execute(() => {});

      const result = executor.validateAction(action, game.getPlayer(1)!, {});

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

      const result = executor.executeAction(action, game.getPlayer(1)!, {});

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

      executor.executeAction(action, game.getPlayer(1)!, { choice: 'a' });

      expect(receivedArgs.choice).toBe('a');
    });

    it('should extract value from {value, label} choice objects', () => {
      let receivedArgs: Record<string, unknown> = {};
      const action = Action.create('test')
        .chooseFrom('option', {
          choices: [
            { value: 'skip', label: 'Skip this step' },
            { value: 'continue', label: 'Continue' },
          ],
        })
        .execute((args) => {
          receivedArgs = args;
        });

      // UI sends just the value string
      executor.executeAction(action, game.getPlayer(1)!, { option: 'skip' });

      // Execute handler should receive just the value, not the full object
      expect(receivedArgs.option).toBe('skip');
    });

    it('should extract value from {value, display} choice objects', () => {
      let receivedArgs: Record<string, unknown> = {};
      const action = Action.create('test')
        .chooseFrom('action', {
          choices: [
            { value: 'attack', display: 'Attack the enemy' },
            { value: 'defend', display: 'Defend position' },
          ],
        })
        .execute((args) => {
          receivedArgs = args;
        });

      executor.executeAction(action, game.getPlayer(1)!, { action: 'attack' });

      expect(receivedArgs.action).toBe('attack');
    });

    it('should NOT extract value from element-like objects (preserve element)', () => {
      const deck = game.create(Deck, 'deck');
      const card = deck.create(Card, 'card', { rank: 'A', suit: 'spades', value: 10 });

      let receivedArgs: Record<string, unknown> = {};
      const action = Action.create('test')
        .chooseFrom('card', {
          choices: (ctx) => [...ctx.game.all(Card)],
        })
        .execute((args) => {
          receivedArgs = args;
        });

      // UI sends element ID
      executor.executeAction(action, game.getPlayer(1)!, { card: card.id });

      // Execute handler should receive the full element (not just its 'value' attribute)
      expect(receivedArgs.card).toBe(card);
    });

    it('should pass context to execute handler', () => {
      let receivedContext: ActionContext | undefined;
      const action = Action.create('test').execute((_args, ctx) => {
        receivedContext = ctx;
      });

      executor.executeAction(action, game.getPlayer(2)!, {});

      expect(receivedContext!.player).toBe(game.getPlayer(2)!);
      expect(receivedContext!.game).toBe(game);
    });

    it('should fail if validation fails', () => {
      const action = Action.create('test')
        .chooseFrom('choice', { choices: ['a', 'b'] })
        .execute(() => {});

      const result = executor.executeAction(action, game.getPlayer(1)!, {
        choice: 'invalid',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid selection');
    });

    it('should catch execution errors', () => {
      const action = Action.create('test').execute(() => {
        throw new Error('Something went wrong');
      });

      const result = executor.executeAction(action, game.getPlayer(1)!, {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
    });
  });

  describe('isActionAvailable', () => {
    it('should return true when condition passes', () => {
      const action = Action.create('test')
        .condition({
          'always available': () => true,
        })
        .execute(() => {});

      expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
    });

    it('should return false when condition fails', () => {
      const action = Action.create('test')
        .condition({
          'blocked': () => false,
        })
        .execute(() => {});

      expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(false);
    });

    it('should return false when no valid choices for required selection', () => {
      const action = Action.create('test')
        .chooseElement('card', { elementClass: Card })
        .execute(() => {});

      // No cards in game
      expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(false);
    });

    it('should return true when optional selection has no choices', () => {
      const action = Action.create('test')
        .chooseElement('card', {
          elementClass: Card,
          optional: true,
        })
        .execute(() => {});

      expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
    });
  });
});

describe('Dependent Selection Filtering (filterBy)', () => {
  let game: TestGame;
  let executor: ActionExecutor;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    executor = new ActionExecutor(game);
  });

  it('should filter choices based on previous selection value', () => {
    // Create an action where destination depends on piece selection
    // Note: the 'key' in filterBy is used for BOTH:
    // 1. Extracting the value from the previous selection (if object)
    // 2. Matching against the choice property
    const action = Action.create('move')
      .chooseFrom<{ pieceId: number }>('piece', {
        choices: [{ pieceId: 1 }, { pieceId: 2 }, { pieceId: 3 }],
      })
      .chooseFrom<{ pieceId: number; dest: string }>('destination', {
        choices: [
          { pieceId: 1, dest: 'A' },
          { pieceId: 1, dest: 'B' },
          { pieceId: 2, dest: 'C' },
          { pieceId: 3, dest: 'D' },
        ],
        filterBy: { key: 'pieceId', selectionName: 'piece' },
      })
      .execute(() => {});

    // Without previous selection, all destinations available
    const allDests = executor.getChoices(
      action.selections[1],
      game.getPlayer(1)!,
      {}
    );
    expect(allDests).toHaveLength(4);

    // With piece 1 selected, only A and B should be available
    const destsForPiece1 = executor.getChoices(
      action.selections[1],
      game.getPlayer(1)!,
      { piece: { pieceId: 1 } }
    );
    expect(destsForPiece1).toHaveLength(2);
    expect(destsForPiece1).toEqual([
      { value: { pieceId: 1, dest: 'A' }, disabled: false },
      { value: { pieceId: 1, dest: 'B' }, disabled: false },
    ]);

    // With piece 2 selected, only C should be available
    const destsForPiece2 = executor.getChoices(
      action.selections[1],
      game.getPlayer(1)!,
      { piece: { pieceId: 2 } }
    );
    expect(destsForPiece2).toHaveLength(1);
    expect(destsForPiece2[0]).toEqual({ value: { pieceId: 2, dest: 'C' }, disabled: false });
  });

  it('should handle primitive filter values', () => {
    const action = Action.create('select')
      .chooseFrom('category', { choices: ['A', 'B'] })
      .chooseFrom('item', {
        choices: [
          { category: 'A', name: 'Apple' },
          { category: 'A', name: 'Apricot' },
          { category: 'B', name: 'Banana' },
        ],
        filterBy: { key: 'category', selectionName: 'category' },
      })
      .execute(() => {});

    const itemsForA = executor.getChoices(
      action.selections[1],
      game.getPlayer(1)!,
      { category: 'A' }
    );
    expect(itemsForA).toHaveLength(2);
    expect(itemsForA.map((i: any) => i.value.name)).toEqual(['Apple', 'Apricot']);
  });

  it('should hide action when no valid selection path exists', () => {
    // Piece 3 has no valid destinations
    const action = Action.create('move')
      .chooseFrom<{ pieceId: number }>('piece', {
        choices: [{ pieceId: 3 }],
      })
      .chooseFrom<{ pieceId: number; dest: string }>('destination', {
        choices: [
          { pieceId: 1, dest: 'A' },
          { pieceId: 2, dest: 'B' },
        ],
        filterBy: { key: 'pieceId', selectionName: 'piece' },
      })
      .execute(() => {});

    // Action should not be available because piece 3 has no destinations
    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(false);
  });

  it('should show action when at least one valid path exists', () => {
    const action = Action.create('move')
      .chooseFrom<{ pieceId: number }>('piece', {
        choices: [{ pieceId: 1 }, { pieceId: 3 }], // 1 has destinations, 3 doesn't
      })
      .chooseFrom<{ pieceId: number; dest: string }>('destination', {
        choices: [
          { pieceId: 1, dest: 'A' },
          { pieceId: 1, dest: 'B' },
        ],
        filterBy: { key: 'pieceId', selectionName: 'piece' },
      })
      .execute(() => {});

    // Action should be available because piece 1 has valid destinations
    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
  });

  it('should handle multiple levels of dependent selections', () => {
    const action = Action.create('complex')
      .chooseFrom<{ categoryId: number }>('category', {
        choices: [{ categoryId: 1 }, { categoryId: 2 }],
      })
      .chooseFrom<{ categoryId: number; itemId: number }>('item', {
        choices: [
          { categoryId: 1, itemId: 10 },
          { categoryId: 1, itemId: 11 },
          { categoryId: 2, itemId: 20 },
        ],
        filterBy: { key: 'categoryId', selectionName: 'category' },
      })
      .chooseFrom<{ itemId: number; action: string }>('action', {
        choices: [
          { itemId: 10, action: 'buy' },
          { itemId: 10, action: 'sell' },
          { itemId: 20, action: 'trade' },
        ],
        filterBy: { key: 'itemId', selectionName: 'item' },
      })
      .execute(() => {});

    // Get actions for item 10 (which belongs to category 1)
    const actionsForItem10 = executor.getChoices(
      action.selections[2],
      game.getPlayer(1)!,
      { category: { categoryId: 1 }, item: { categoryId: 1, itemId: 10 } }
    );
    expect(actionsForItem10).toHaveLength(2);
    expect(actionsForItem10.map((a: any) => a.value.action)).toEqual(['buy', 'sell']);
  });
});

describe('Dependent Selection with dependsOn', () => {
  let game: TestGame;
  let executor: ActionExecutor;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    executor = new ActionExecutor(game);

    // Create mercs with equipment
    const merc1 = game.create(Space, 'merc1');
    merc1.createMany(2, Card, 'equipment', (i) => ({
      suit: 'H',
      rank: String(i + 1),
      value: i + 1,
    }));

    const merc2 = game.create(Space, 'merc2');
    merc2.createMany(3, Card, 'equipment', (i) => ({
      suit: 'S',
      rank: String(i + 1),
      value: i + 1,
    }));

    // Create a merc with no equipment
    game.create(Space, 'merc3');
  });

  it('should make action available when dependsOn is used and upstream choices exist', () => {
    // This is the MERC team pattern: select merc, then select equipment from that merc
    const mercs = [...game.all(Space)];

    const action = Action.create('dropEquipment')
      .fromElements('merc', {
        elements: () => mercs,
      })
      .fromElements('equipment', {
        dependsOn: 'merc',
        elements: (ctx) => {
          const merc = ctx.args.merc as Space;
          return [...merc.all(Card)];
        },
      })
      .execute(() => {});

    // Action should be available because merc1 and merc2 have equipment
    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
  });

  it('should make action unavailable when no upstream choice leads to valid downstream choices', () => {
    // Only merc3 (no equipment) is available
    const merc3 = game.first(Space, (s) => s.name === 'merc3')!;

    const action = Action.create('dropEquipment')
      .fromElements('merc', {
        elements: () => [merc3],
      })
      .fromElements('equipment', {
        dependsOn: 'merc',
        elements: (ctx) => {
          const merc = ctx.args.merc as Space;
          return [...merc.all(Card)];
        },
      })
      .execute(() => {});

    // Action should NOT be available because merc3 has no equipment
    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(false);
  });

  it('should be available when at least one upstream choice leads to valid path', () => {
    // Mix of mercs with and without equipment
    const mercs = [...game.all(Space)]; // merc1, merc2 have equipment; merc3 doesn't

    const action = Action.create('dropEquipment')
      .fromElements('merc', {
        elements: () => mercs,
      })
      .fromElements('equipment', {
        dependsOn: 'merc',
        elements: (ctx) => {
          const merc = ctx.args.merc as Space;
          return [...merc.all(Card)];
        },
      })
      .execute(() => {});

    // Action should be available because merc1 and merc2 have equipment
    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
  });

  it('should work with chooseElement selections', () => {
    const mercs = [...game.all(Space)];

    const action = Action.create('dropEquipment')
      .chooseElement('merc', {
        from: game,
        elementClass: Space,
      })
      .chooseElement('equipment', {
        dependsOn: 'merc',
        from: (ctx) => ctx.args.merc as Space,
        elementClass: Card,
      })
      .execute(() => {});

    // Action should be available
    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
  });

  it('should work with dynamic choice selections', () => {
    const mercs = [...game.all(Space)];

    const action = Action.create('dropEquipment')
      .chooseFrom('merc', {
        choices: () => mercs.map((m) => m.name),
      })
      .chooseFrom('equipment', {
        dependsOn: 'merc',
        choices: (ctx) => {
          const mercName = ctx.args.merc as string;
          const merc = game.first(Space, (s) => s.name === mercName)!;
          return [...merc.all(Card)].map((c) => c.name);
        },
      })
      .execute(() => {});

    // Action should be available
    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
  });

  it('should handle multiple levels of dependencies', () => {
    // Category -> Item -> Action
    const action = Action.create('complex')
      .chooseFrom('category', {
        choices: ['weapons', 'armor'],
      })
      .chooseFrom('item', {
        dependsOn: 'category',
        choices: (ctx) => {
          const cat = ctx.args.category as string;
          if (cat === 'weapons') return ['sword', 'bow'];
          if (cat === 'armor') return ['shield', 'helmet'];
          return [];
        },
      })
      .chooseFrom('action', {
        dependsOn: 'item',
        choices: (ctx) => {
          const item = ctx.args.item as string;
          if (item === 'sword') return ['equip', 'sell'];
          if (item === 'bow') return ['equip'];
          if (item === 'shield') return ['equip', 'polish'];
          return [];
        },
      })
      .execute(() => {});

    // Action should be available (weapons->sword->equip is a valid path)
    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
  });

  it('should be unavailable when multi-level path has no valid terminus', () => {
    const action = Action.create('complex')
      .chooseFrom('category', {
        choices: ['empty'],
      })
      .chooseFrom('item', {
        dependsOn: 'category',
        choices: (ctx) => {
          const cat = ctx.args.category as string;
          if (cat === 'empty') return ['nothing'];
          return [];
        },
      })
      .chooseFrom('action', {
        dependsOn: 'item',
        choices: (ctx) => {
          const item = ctx.args.item as string;
          // 'nothing' has no valid actions
          return [];
        },
      })
      .execute(() => {});

    // Action should NOT be available (empty->nothing->[] has no valid path)
    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(false);
  });
});

describe('Better Filter Error Messages', () => {
  let game: TestGame;
  let executor: ActionExecutor;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    executor = new ActionExecutor(game);

    // Create some cards to select from
    const deck = game.create(Deck, 'deck');
    deck.createMany(5, Card, 'card', (i) => ({
      suit: 'H',
      rank: String(i + 1),
      value: i + 1,
    }));
  });

  it('should provide helpful error when filter accesses undefined args property', () => {
    // This is the bug-prone pattern: filter tries to access ctx.args.piece.value
    // without checking if piece is defined first
    const action = Action.create('move')
      .chooseElement('piece', {
        elementClass: Card,
      })
      .chooseElement('destination', {
        elementClass: Card,
        // Bug: accessing piece.value without null check - crashes during availability check
        filter: (element, ctx) => {
          const piece = ctx.args.piece as Card;
          return (element as Card).value > piece.value; // crashes when piece is undefined
        },
      })
      .execute(() => {});

    // When checking availability, the filter runs with ctx.args.piece = undefined
    // This should throw a helpful error instead of generic "Cannot read properties of undefined"
    expect(() => {
      executor.getChoices(action.selections[1], game.getPlayer(1)!, {});
    }).toThrowError(/Filter for selection 'destination' crashed/);
  });

  it('should include fix suggestions in error message', () => {
    const action = Action.create('move')
      .chooseElement('piece', { elementClass: Card })
      .chooseElement('destination', {
        elementClass: Card,
        filter: (element, ctx) => {
          const piece = ctx.args.piece as Card;
          return (element as Card).value > piece.value;
        },
      })
      .execute(() => {});

    try {
      executor.getChoices(action.selections[1], game.getPlayer(1)!, {});
      expect.fail('Should have thrown');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('dependentFilter');
      expect(message).toContain('null check');
      expect(message).toContain('availability check');
    }
  });

  it('should preserve original error if not undefined access pattern', () => {
    const action = Action.create('test')
      .chooseElement('card', {
        elementClass: Card,
        filter: () => {
          throw new Error('Custom error');
        },
      })
      .execute(() => {});

    expect(() => {
      executor.getChoices(action.selections[0], game.getPlayer(1)!, {});
    }).toThrowError('Custom error');
  });

  it('should work correctly when filter handles undefined properly', () => {
    const action = Action.create('move')
      .chooseElement('piece', { elementClass: Card })
      .chooseElement('destination', {
        elementClass: Card,
        // Correct pattern: check for undefined first
        filter: (element, ctx) => {
          const piece = ctx.args?.piece as Card | undefined;
          if (!piece) return true; // Allow all during availability check
          return (element as Card).value > piece.value;
        },
      })
      .execute(() => {});

    // Should not throw
    const choices = executor.getChoices(action.selections[1], game.getPlayer(1)!, {});
    expect(choices.length).toBe(5); // All cards available during availability check
  });
});

describe('Game Action Integration', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    game.create(Hand, 'hand', { player: game.getPlayer(1)! });
    game.create(Hand, 'hand', { player: game.getPlayer(2)! });
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
      .condition({
        'enabled': () => true,
      })
      .execute(() => {});

    const never = Action.create('never')
      .condition({
        'disabled': () => false,
      })
      .execute(() => {});

    game.registerActions(always, never);

    const available = game.getAvailableActions(game.getPlayer(1)!);

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
      game.getPlayer(1)!
    );

    expect(choices).toEqual([
      { value: 'red', disabled: false },
      { value: 'blue', disabled: false },
    ]);
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
    const result = game.performAction('draw', game.getPlayer(1)!, { card });

    expect(result.success).toBe(true);
    expect(moved).toBe(true);
  });

  it('should fail for unknown action', () => {
    const result = game.performAction('unknown', game.getPlayer(1)!, {});

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
      player: 1,
      args: {},
    });

    expect(result.success).toBe(true);
    expect(executed).toBe(true);
  });
});

describe('Action Chaining with followUp', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    const deck = game.create(Deck, 'deck');
    deck.createMany(5, Card, 'card', (i) => ({
      suit: 'H',
      rank: String(i + 1),
      value: i + 1,
    }));
  });

  it('should return followUp from action result', () => {
    const action = Action.create('explore')
      .execute(() => ({
        success: true,
        followUp: {
          action: 'collect',
          args: { mercId: 42 },
        },
      }));

    game.registerAction(action);

    const result = game.performAction('explore', game.getPlayer(1)!, {});

    expect(result.success).toBe(true);
    expect(result.followUp).toBeDefined();
    expect(result.followUp?.action).toBe('collect');
    expect(result.followUp?.args).toEqual({ mercId: 42 });
  });

  it('should not include followUp when action returns undefined for it', () => {
    const action = Action.create('simple')
      .execute(() => ({
        success: true,
      }));

    game.registerAction(action);

    const result = game.performAction('simple', game.getPlayer(1)!, {});

    expect(result.success).toBe(true);
    expect(result.followUp).toBeUndefined();
  });

  it('should support conditional followUp based on game state', () => {
    // Setup: Add a stash zone and some cards
    const stash = game.create(Space, 'stash');

    const explore = Action.create('explore')
      .execute((args, ctx) => {
        // Draw cards to stash
        const deck = ctx.game.first(Deck)!;
        const card = deck.first(Card);
        if (card) {
          card.putInto(stash);
        }

        // Only return followUp if stash has cards
        return {
          success: true,
          followUp: stash.count(Card) > 0
            ? { action: 'collect', args: { stashId: stash.id } }
            : undefined,
        };
      });

    game.registerAction(explore);

    // Execute explore - should have followUp since we drew a card
    const result = game.performAction('explore', game.getPlayer(1)!, {});

    expect(result.success).toBe(true);
    expect(result.followUp).toBeDefined();
    expect(result.followUp?.action).toBe('collect');
    expect(result.followUp?.args).toEqual({ stashId: stash.id });
  });

  it('should pass through followUp with no args', () => {
    const action = Action.create('trigger')
      .execute(() => ({
        success: true,
        followUp: {
          action: 'nextAction',
          // No args provided
        },
      }));

    game.registerAction(action);

    const result = game.performAction('trigger', game.getPlayer(1)!, {});

    expect(result.success).toBe(true);
    expect(result.followUp?.action).toBe('nextAction');
    expect(result.followUp?.args).toBeUndefined();
  });

  it('should work with selections before followUp', () => {
    const action = Action.create('selectAndChain')
      .chooseElement('card', { elementClass: Card })
      .execute((args) => {
        const card = args.card as Card;
        return {
          success: true,
          followUp: {
            action: 'processCard',
            args: { cardId: card.id, value: card.value },
          },
        };
      });

    game.registerAction(action);

    const card = game.first(Card)!;
    const result = game.performAction('selectAndChain', game.getPlayer(1)!, { card });

    expect(result.success).toBe(true);
    expect(result.followUp?.action).toBe('processCard');
    expect(result.followUp?.args?.cardId).toBe(card.id);
    expect(result.followUp?.args?.value).toBe(card.value);
  });
});

describe('actionTempState helper', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('should store and retrieve values', () => {
    const player = game.getPlayer(1)!;
    const temp = actionTempState(game, player, 'testAction');

    temp.set('key1', 'value1');
    temp.set('key2', 42);

    expect(temp.get<string>('key1')).toBe('value1');
    expect(temp.get<number>('key2')).toBe(42);
    expect(temp.get<string>('nonexistent')).toBeUndefined();
  });

  it('should clear all values for the action', () => {
    const player = game.getPlayer(1)!;
    const temp = actionTempState(game, player, 'testAction');

    temp.set('key1', 'value1');
    temp.set('key2', 'value2');
    temp.clear();

    expect(temp.get<string>('key1')).toBeUndefined();
    expect(temp.get<string>('key2')).toBeUndefined();
  });

  it('should namespace by action and player', () => {
    const player0 = game.getPlayer(1)!;
    const player1 = game.getPlayer(2)!;

    const temp0Action1 = actionTempState(game, player0, 'action1');
    const temp0Action2 = actionTempState(game, player0, 'action2');
    const temp1Action1 = actionTempState(game, player1, 'action1');

    temp0Action1.set('key', 'player0-action1');
    temp0Action2.set('key', 'player0-action2');
    temp1Action1.set('key', 'player1-action1');

    expect(temp0Action1.get<string>('key')).toBe('player0-action1');
    expect(temp0Action2.get<string>('key')).toBe('player0-action2');
    expect(temp1Action1.get<string>('key')).toBe('player1-action1');

    // Clearing one doesn't affect others
    temp0Action1.clear();
    expect(temp0Action1.get<string>('key')).toBeUndefined();
    expect(temp0Action2.get<string>('key')).toBe('player0-action2');
    expect(temp1Action1.get<string>('key')).toBe('player1-action1');
  });

  it('should work with ActionContext overload', () => {
    const ctx: ActionContext = {
      game,
      player: game.getPlayer(1)!,
      args: {},
    };

    const temp = actionTempState(ctx, 'testAction');
    temp.set('data', { nested: true });

    expect(temp.get<{ nested: boolean }>('data')).toEqual({ nested: true });
  });
});

describe('Disabled Selections', () => {
  let game: TestGame;
  let executor: ActionExecutor;

  beforeEach(() => {
    game = new TestGame({ playerCount: 3 });
    executor = new ActionExecutor(game);

    // Create cards for element selection tests
    const deck = game.create(Deck, 'deck');
    deck.createMany(5, Card, 'card', (i) => ({
      suit: 'H',
      rank: String(i + 1),
      value: i + 1,
    }));
  });

  it('should mark choices as disabled via disabled callback in getChoices', () => {
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue', 'green'],
        disabled: (choice) => choice === 'red' ? 'Red is unavailable' : false,
      })
      .execute(() => {});

    const choices = executor.getChoices(action.selections[0], game.getPlayer(1)!, {});
    expect(choices).toEqual([
      { value: 'red', disabled: 'Red is unavailable' },
      { value: 'blue', disabled: false },
      { value: 'green', disabled: false },
    ]);
  });

  it('should mark disabled elements in getChoices but keep them in list', () => {
    const action = Action.create('test')
      .chooseElement('card', {
        elementClass: Card,
        disabled: (el) => (el as Card).value < 3 ? 'Too weak' : false,
      })
      .execute(() => {});

    const choices = executor.getChoices(action.selections[0], game.getPlayer(1)!, {});
    // All 5 cards present, low-value ones marked disabled
    expect(choices).toHaveLength(5);
    const disabledCount = choices.filter(c => c.disabled !== false).length;
    expect(disabledCount).toBe(2); // values 1 and 2
    const enabledCount = choices.filter(c => c.disabled === false).length;
    expect(enabledCount).toBe(3); // values 3, 4, 5
  });

  it('should mark disabled fromElements in getChoices but keep them in list', () => {
    const cards = [...game.all(Card)];
    const action = Action.create('test')
      .fromElements('card', {
        elements: () => cards,
        disabled: (el) => (el as Card).suit === 'H' ? 'Hearts blocked' : false,
      })
      .execute(() => {});

    const choices = executor.getChoices(action.selections[0], game.getPlayer(1)!, {});
    expect(choices).toHaveLength(cards.length);
    // All cards are hearts, so all should be disabled
    const disabled = choices.filter(c => c.disabled !== false);
    expect(disabled).toHaveLength(cards.length);
    for (const d of disabled) {
      expect(d.disabled).toBe('Hearts blocked');
    }
  });

  it('should reject disabled choice in validateSelection with reason', () => {
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        disabled: (c) => c === 'red' ? 'Red is banned' : false,
      })
      .execute(() => {});

    const result = executor.validateSelection(action.selections[0], 'red', game.getPlayer(1)!, {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toBe('Selection disabled: Red is banned');
  });

  it('should accept enabled choice in validateSelection', () => {
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        disabled: (c) => c === 'red' ? 'Red is banned' : false,
      })
      .execute(() => {});

    const result = executor.validateSelection(action.selections[0], 'blue', game.getPlayer(1)!, {});
    expect(result.valid).toBe(true);
  });

  it('should return false from isActionAvailable when all choices disabled (required)', () => {
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        disabled: () => 'All disabled',
      })
      .execute(() => {});

    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(false);
  });

  it('should return true from isActionAvailable when at least one choice enabled', () => {
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        disabled: (c) => c === 'red' ? 'Disabled' : false,
      })
      .execute(() => {});

    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
  });

  it('should keep optional selection available when all items disabled', () => {
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        disabled: () => 'All disabled',
        optional: true,
      })
      .execute(() => {});

    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(true);
  });

  it('should use context for dynamic disabled evaluation', () => {
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        disabled: (choice, ctx) => ctx.player.seat === 1 && choice === 'red'
          ? 'Player 1 cannot pick red'
          : false,
      })
      .execute(() => {});

    const player1Choices = executor.getChoices(action.selections[0], game.getPlayer(1)!, {});
    expect(player1Choices[0].disabled).toBe('Player 1 cannot pick red');

    const player2Choices = executor.getChoices(action.selections[0], game.getPlayer(2)!, {});
    expect(player2Choices[0].disabled).toBe(false);
  });

  it('should treat all items as enabled when no disabled callback provided', () => {
    const action = Action.create('test')
      .chooseFrom('color', { choices: ['red', 'blue'] })
      .execute(() => {});

    const choices = executor.getChoices(action.selections[0], game.getPlayer(1)!, {});
    expect(choices.every(c => c.disabled === false)).toBe(true);
  });
});

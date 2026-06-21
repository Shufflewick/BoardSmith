import { describe, test, expect, beforeEach } from 'vitest';
import { Game, Player, Space, Piece, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import { GameSession } from './game-session.js';

// Custom element class for test game
class Item extends Piece<TestPickGame> {
  locked!: boolean;
}

class Container extends Space<TestPickGame> {}

// Test game with actions that have disabled callbacks
class TestPickGame extends Game<TestPickGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    // Create elements for element selection tests
    const container = this.create(Container, 'container');
    container.create(Item, 'Sword', { locked: false });
    container.create(Item, 'Shield', { locked: true });
    container.create(Item, 'Potion', { locked: false });

    // Action with disabled choices
    this.registerAction(
      Action.create('pickFruit')
        .chooseFrom('fruit', {
          prompt: 'Choose a fruit',
          choices: ['apple', 'banana', 'cherry'],
          disabled: (choice) => choice === 'banana' ? 'Out of stock' : false,
        })
        .execute(() => ({ success: true }))
    );

    // Action with disabled elements (chooseElement)
    this.registerAction(
      Action.create('pickItem')
        .chooseElement('item', {
          prompt: 'Choose an item',
          elements: (ctx) => [...ctx.game.all(Item)],
          disabled: (element) => (element as Item).locked ? 'Item is locked' : false,
        })
        .execute(() => ({ success: true }))
    );

    // Action without disabled callback (baseline)
    this.registerAction(
      Action.create('pickColor')
        .chooseFrom('color', {
          prompt: 'Choose a color',
          choices: ['red', 'blue', 'green'],
        })
        .execute(() => ({ success: true }))
    );

    // Action with elements multi-select and disabled callback
    this.registerAction(
      Action.create('pickItems')
        .chooseElements('items', {
          prompt: 'Choose items',
          elements: (ctx) => [...ctx.game.all(Item)],
          disabled: (element) => (element as Item).locked ? 'Item is locked' : false,
          multiSelect: 3,
        })
        .execute(() => ({ success: true }))
    );

    // Action with dependent filtering
    this.registerAction(
      Action.create('pickByType')
        .chooseFrom('type', {
          prompt: 'Choose item type',
          choices: ['weapon', 'consumable'],
        })
        .chooseFrom('item', {
          prompt: 'Choose item',
          choices: [
            { id: 'sword', type: 'weapon' },
            { id: 'shield', type: 'weapon' },
            { id: 'potion', type: 'consumable' },
          ],
          filterBy: { key: 'type', selectionName: 'type' },
          display: (choice) => (choice as { id: string }).id,
        })
        .execute(() => ({ success: true }))
    );

    // Set up flow making all actions available
    this.setFlow(defineFlow({
      root: actionStep({ actions: ['pickFruit', 'pickItem', 'pickColor', 'pickItems', 'pickByType'] }),
    }));
  }
}

describe('PickHandler disabled threading', () => {
  let session: GameSession<TestPickGame>;

  beforeEach(() => {
    session = GameSession.create({
      gameType: 'test-pick',
      GameClass: TestPickGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
    });
  });

  describe('choice selection: disabled choices carry reason string', () => {
    test('disabled callback result is threaded to wire choices', () => {
      const result = session.getPickChoices('pickFruit', 'fruit', 1);
      expect(result.success).toBe(true);
      expect(result.choices).toHaveLength(3);

      const apple = result.choices!.find(c => c.value === 'apple')!;
      const banana = result.choices!.find(c => c.value === 'banana')!;
      const cherry = result.choices!.find(c => c.value === 'cherry')!;

      // Enabled choices have NO disabled field
      expect('disabled' in apple).toBe(false);
      expect('disabled' in cherry).toBe(false);

      // Disabled choice has reason string
      expect(banana.disabled).toBe('Out of stock');
    });
  });

  describe('element selection: disabled elements carry reason string', () => {
    test('disabled callback result is threaded to wire elements', () => {
      const result = session.getPickChoices('pickItem', 'item', 1);
      expect(result.success).toBe(true);
      expect(result.validElements).toHaveLength(3);

      const sword = result.validElements!.find(e => e.display === 'Sword')!;
      const shield = result.validElements!.find(e => e.display === 'Shield')!;
      const potion = result.validElements!.find(e => e.display === 'Potion')!;

      // Enabled elements have NO disabled field
      expect('disabled' in sword).toBe(false);
      expect('disabled' in potion).toBe(false);

      // Disabled element has reason string
      expect(shield.disabled).toBe('Item is locked');
    });
  });

  describe('sparse representation: enabled items have no disabled field at all', () => {
    test('enabled choices do not have disabled key in object', () => {
      const result = session.getPickChoices('pickFruit', 'fruit', 1);

      for (const choice of result.choices!) {
        if (choice.value !== 'banana') {
          expect(Object.keys(choice)).not.toContain('disabled');
        }
      }
    });

    test('enabled elements do not have disabled key in object', () => {
      const result = session.getPickChoices('pickItem', 'item', 1);

      for (const elem of result.validElements!) {
        if (elem.display !== 'Shield') {
          expect(Object.keys(elem)).not.toContain('disabled');
        }
      }
    });
  });

  describe('no disabled callback: all items have no disabled field', () => {
    test('choices without disabled callback have no disabled field', () => {
      const result = session.getPickChoices('pickColor', 'color', 1);
      expect(result.success).toBe(true);
      expect(result.choices).toHaveLength(3);

      for (const choice of result.choices!) {
        expect(Object.keys(choice)).not.toContain('disabled');
      }
    });
  });

  describe('elements (multi-select) selection: disabled elements carry reason string', () => {
    test('disabled callback result is threaded to wire elements for multi-select', () => {
      const result = session.getPickChoices('pickItems', 'items', 1);
      expect(result.success).toBe(true);
      expect(result.validElements).toHaveLength(3);

      const shield = result.validElements!.find(e => e.display === 'Shield')!;
      expect(shield.disabled).toBe('Item is locked');

      // Enabled elements have no disabled field
      const sword = result.validElements!.find(e => e.display === 'Sword')!;
      const potion = result.validElements!.find(e => e.display === 'Potion')!;
      expect('disabled' in sword).toBe(false);
      expect('disabled' in potion).toBe(false);
    });
  });

  describe('choice selection: filterBy uses resolved args from action executor', () => {
    test('dependent choices are filtered consistently with action validation', () => {
      const result = session.getPickChoices('pickByType', 'item', 1, { type: 'weapon' });
      expect(result.success).toBe(true);
      expect(result.choices).toBeDefined();
      expect(result.choices!.map(c => c.display)).toEqual(['sword', 'shield']);
    });
  });
});

// ============================================================
// BoardRefs / BoardRef construction (D-01 migration)
// ============================================================

interface MoveChoice {
  from: string;
  to: string;
}

class Square extends Space<BoardRefsGame> {}

class BoardRefsGame extends Game<BoardRefsGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    const board = this.create(Square, 'board');
    board.create(Square, 'a1');
    board.create(Square, 'a2');
    board.create(Square, 'a3');

    // Choice pick with boardRefs returning refs array
    this.registerAction(
      Action.create('move')
        .chooseFrom<MoveChoice>('dest', {
          prompt: 'Choose destination',
          choices: [
            { from: 'a1', to: 'a2' },
            { from: 'a1', to: 'a3' },
          ],
          display: (c) => `${c.from} → ${c.to}`,
          boardRefs: (choice) => ({
            refs: [
              { ref: { notation: choice.from }, role: 'source' as const },
              { ref: { notation: choice.to }, role: 'target' as const },
            ],
          }),
        })
        .execute(() => ({ success: true }))
    );

    // Element pick with boardRef callback
    this.registerAction(
      Action.create('selectSquare')
        .chooseElement('sq', {
          prompt: 'Choose a square',
          elements: (ctx) => [...ctx.game.all(Square)].filter(s => s.name !== 'board'),
          boardRef: (element) => ({ notation: element.name }),
        })
        .execute(() => ({ success: true }))
    );

    // Element pick WITHOUT boardRef (default behavior)
    this.registerAction(
      Action.create('selectSquareDefault')
        .chooseElement('sq', {
          prompt: 'Choose a square',
          elements: (ctx) => [...ctx.game.all(Square)].filter(s => s.name !== 'board'),
        })
        .execute(() => ({ success: true }))
    );

    this.setFlow(defineFlow({
      root: actionStep({ actions: ['move', 'selectSquare', 'selectSquareDefault'] }),
    }));
  }
}

describe('PickHandler refs construction (D-01)', () => {
  let session: GameSession<BoardRefsGame>;

  beforeEach(() => {
    session = GameSession.create({
      gameType: 'test-board-refs',
      GameClass: BoardRefsGame,
      playerCount: 1,
      playerNames: ['Alice'],
    });
  });

  describe('choice pick with boardRefs callback', () => {
    test('choice.refs equals the array returned by boardRefs()', () => {
      const result = session.getPickChoices('move', 'dest', 1);
      expect(result.success).toBe(true);
      expect(result.choices).toHaveLength(2);

      const first = result.choices![0];
      expect(first.refs).toBeDefined();
      expect(first.refs).toHaveLength(2);
      expect(first.refs![0]).toEqual({ ref: { notation: 'a1' }, role: 'source' });
      expect(first.refs![1]).toEqual({ ref: { notation: 'a2' }, role: 'target' });

      // No singular fields present
      expect((first as any).sourceRef).toBeUndefined();
      expect((first as any).targetRef).toBeUndefined();
    });
  });

  describe('element pick with boardRef callback', () => {
    test('validElem.refs equals [{ ref: <callback result>, role: "highlight" }]', () => {
      const result = session.getPickChoices('selectSquare', 'sq', 1);
      expect(result.success).toBe(true);
      expect(result.validElements).toBeDefined();

      for (const elem of result.validElements!) {
        expect(elem.refs).toBeDefined();
        expect(elem.refs).toHaveLength(1);
        expect(elem.refs![0].role).toBe('highlight');
        expect(elem.refs![0].ref).toHaveProperty('notation');
        // No singular ref field
        expect((elem as any).ref).toBeUndefined();
      }
    });
  });

  describe('element pick without boardRef (default)', () => {
    test('validElem.refs === [{ ref: { id, notation? }, role: "highlight" }]', () => {
      const result = session.getPickChoices('selectSquareDefault', 'sq', 1);
      expect(result.success).toBe(true);
      expect(result.validElements).toBeDefined();

      for (const elem of result.validElements!) {
        expect(elem.refs).toBeDefined();
        expect(elem.refs).toHaveLength(1);
        expect(elem.refs![0].role).toBe('highlight');
        expect(typeof elem.refs![0].ref.id).toBe('number');
        // No singular ref field
        expect((elem as any).ref).toBeUndefined();
      }
    });
  });
});

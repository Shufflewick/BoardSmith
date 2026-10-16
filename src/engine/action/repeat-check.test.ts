/**
 * The repeat check and the count refusal each live in one place (#775): every
 * pick type that can repeat answers isRepeatingSelection the same way, and a
 * count refusal names what was counted (choices or elements).
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, Space, Piece } from '../index.js';
import { ActionExecutor } from './action.js';

class TestGame extends Game<TestGame, Player> {}

describe('one repeat check and one count refusal for every pick type (#775)', () => {
  const game = new TestGame({ playerCount: 2 });
  const board = game.create(Space<TestGame>, 'board');
  board.create(Piece<TestGame>, 'a');
  const executor = new ActionExecutor(game);
  const repeat = { onEach: () => {}, until: () => true };

  const action = Action.create<TestGame>('mixed')
    .chooseFrom('choice', { choices: ['x'], repeat })
    .chooseElement('element', { elementClass: Piece, repeat })
    .chooseElements('elements', { elements: () => [...board.all(Piece)], repeat })
    .chooseFrom('plain', { choices: ['y'] })
    .enterText('text', {})
    .enterNumber('number', {})
    .execute(() => {});
  const byName = (name: string) => action.selections.find((s) => s.name === name)!;

  it('reports choice, element and elements picks with repeat as repeating, and the rest as not', () => {
    expect(['choice', 'element', 'elements'].map((n) => executor.isRepeatingSelection(byName(n)))).toEqual([true, true, true]);
    expect(['plain', 'text', 'number'].map((n) => executor.isRepeatingSelection(byName(n)))).toEqual([false, false, false]);
  });

  it('names elements in an element count refusal and choices in a choice count refusal', () => {
    const elements = Action.create<TestGame>('take')
      .chooseElements('pieces', { elements: () => [...board.all(Piece)], multiSelect: { min: 2, max: 3 } })
      .execute(() => {});
    const choices = Action.create<TestGame>('pick')
      .chooseFrom('letters', { choices: ['p', 'q', 'r'], multiSelect: { min: 2, max: 3 } })
      .execute(() => {});
    const seat = game.getPlayer(1)!;
    const piece = board.first(Piece)!;

    expect(executor.validateSelection(elements.selections[0], [piece], seat, {}).errors)
      .toContain('Selection "pieces" requires at least 2 elements, got 1');
    expect(executor.validateSelection(choices.selections[0], ['p'], seat, {}).errors)
      .toContain('Selection "letters" requires at least 2 choices, got 1');
  });
});

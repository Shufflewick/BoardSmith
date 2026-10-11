/**
 * #660: A PICK THAT TAKES ONE VALUE IS NEVER SENT A LIST OF ITS CHOICES.
 *
 * A `chooseFrom` with no `multiSelect` or `orderedList` takes one choice. Its
 * validation used to check an array item by item, as if the pick were a
 * multiSelect, so `{ b: ['x', 'y'] }` was accepted and `execute` was handed
 * the array: a move no bot enumeration or UI ever offers. A single choice
 * whose VALUE is itself an array is still one choice, and is still accepted.
 *
 * Both submission paths are driven through the real executor.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action } from '../index.js';
import type { ActionDefinition } from './types.js';

class Stone extends Piece<Yard> {}
class Pile extends Space<Yard> {}

class Yard extends Game<Yard, Player> {
  rocks!: Pile;
  constructor() {
    super({ playerCount: 2 });
    this.rocks = this.create(Pile, 'rocks');
    for (const name of ['flint', 'slate']) this.rocks.create(Stone, name);
  }
}

type Submit = (game: Yard, action: ActionDefinition, value: unknown) => string | undefined;

const paths: Array<[string, Submit]> = [
  ['a whole submission', (game, _action, value) => game.performAction('take', game.getPlayer(1)!, { b: value }).error],
  ['one selection at a time', (game, action, value) => {
    const executor = game.getActionExecutor();
    const player = game.getPlayer(1)!;
    const pending = executor.createPendingActionState('take', 1);
    const step = executor.processSelectionStep(action, player, pending, 'b', value);
    if (!step.success) return step.error;
    return executor.executePendingAction(action, player, pending).error;
  }],
];

/** Registers `take` with one pick `b`, recording what `execute` was handed. */
function setUp(pick: (action: ReturnType<typeof Action.create>) => ReturnType<typeof Action.create>) {
  const game = new Yard();
  const executed: unknown[] = [];
  const action = pick(Action.create('take')).execute((args) => { executed.push((args as Record<string, unknown>).b); });
  game.registerAction(action);
  return { game, action, executed };
}

describe.each(paths)('a single pick sent an array, via %s (#660)', (_path, submit) => {
  it('a chooseFrom refuses a list of its own choices, saying it takes one', () => {
    const { game, action, executed } = setUp((a) => a.chooseFrom('b', { choices: ['x', 'y'] }));
    const error = submit(game, action, ['x', 'y']);
    expect(error).toBe('Selection "b" takes one choice, got a list of 2. Submit one of its choices.');
    expect(executed).toEqual([]);
  });

  it('a chooseFrom refuses a list of one of its choices', () => {
    const { game, action, executed } = setUp((a) => a.chooseFrom('b', { choices: ['x', 'y'] }));
    expect(submit(game, action, ['x'])).toBe('Selection "b" takes one choice, got a list of 1. Submit one of its choices.');
    expect(executed).toEqual([]);
  });

  it('a chooseFrom whose one choice is itself an array accepts that array', () => {
    const { game, action, executed } = setUp((a) => a.chooseFrom('b', { choices: [['x', 'y'], ['z']] }));
    expect(submit(game, action, ['x', 'y'])).toBeUndefined();
    expect(executed).toEqual([['x', 'y']]);
  });

  it('a chooseFrom with array choices refuses an array it does not offer as no longer available', () => {
    const { game, action, executed } = setUp((a) => a.chooseFrom('b', { choices: [['x', 'y'], ['z']] }));
    expect(submit(game, action, ['q'])).toBe(
      'That choice is no longer available. Things changed while you were choosing, so please choose again.',
    );
    expect(executed).toEqual([]);
  });

  it('a chooseFrom with array choices refuses a list of them', () => {
    const { game, action, executed } = setUp((a) => a.chooseFrom('b', { choices: [['x', 'y'], ['z']] }));
    expect(submit(game, action, [['x', 'y'], ['z']])).toBe(
      'Selection "b" takes one choice, got a list of 2. Submit one of its choices.',
    );
    expect(executed).toEqual([]);
  });

  it('a chooseElement refuses a list of its elements', () => {
    const { game, action, executed } = setUp((a) => a.chooseElement('b', { elementClass: Stone }));
    const ids = game.rocks.all(Stone).map((s) => s.id);
    expect(submit(game, action, ids)).toMatch(/expects a single element, got an array of 2/);
    expect(executed).toEqual([]);
  });

  it('an enterText refuses a list of strings', () => {
    const { game, action, executed } = setUp((a) => a.enterText('b', {}));
    expect(submit(game, action, ['x', 'y'])).toBe('b must be a string');
    expect(executed).toEqual([]);
  });

  it('an enterNumber refuses a list of numbers', () => {
    const { game, action, executed } = setUp((a) => a.enterNumber('b', {}));
    expect(submit(game, action, [1, 2])).toBe('b must be a number');
    expect(executed).toEqual([]);
  });
});

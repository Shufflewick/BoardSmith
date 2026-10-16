/**
 * #769: chooseElements TAKES A LIST, NEVER A BARE ID.
 *
 * `{ cards: 5 }` used to pass the count check as one item and reach `execute`
 * as a lone element, so `args.cards.length < 2` was `undefined < 2` (false).
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
  ['a whole submission', (game, _action, value) => game.performAction('take', game.getPlayer(1)!, { cards: value }).error],
  ['one selection at a time', (game, action, value) => {
    const executor = game.getActionExecutor();
    const player = game.getPlayer(1)!;
    const pending = executor.createPendingActionState('take', 1);
    const step = executor.processSelectionStep(action, player, pending, 'cards', value);
    if (!step.success) return step.error;
    return executor.executePendingAction(action, player, pending).error;
  }],
];

function setUp() {
  const game = new Yard();
  const executed: unknown[] = [];
  const action = Action.create('take')
    .chooseElements('cards', { elements: () => [...game.rocks.all(Stone)] })
    .execute((args) => { executed.push((args as Record<string, unknown>).cards); });
  game.registerAction(action);
  const ids = [...game.rocks.all(Stone)].map((s) => s.id);
  return { game, action, executed, ids };
}

describe.each(paths)('chooseElements sent a bare id, via %s (#769)', (_path, submit) => {
  it('refuses a bare id as not an array, and execute never runs', () => {
    const { game, action, executed, ids } = setUp();
    const error = submit(game, action, ids[0]);
    expect(error).toContain('Selection "cards" is multi-select and expected an array, got object');
    expect(executed).toEqual([]);
  });

  it('accepts an array of ids', () => {
    const { game, action, executed, ids } = setUp();
    expect(submit(game, action, ids)).toBeUndefined();
    expect(executed).toHaveLength(1);
    expect(Array.isArray(executed[0])).toBe(true);
  });

  it('accepts a single-element array', () => {
    const { game, action, executed, ids } = setUp();
    expect(submit(game, action, [ids[0]])).toBeUndefined();
    expect((executed[0] as unknown[]).length).toBe(1);
  });
});

/**
 * An ORDERED, REPEATABLE list of choices (#249).
 *
 * `multiSelect` is a SET: order is incidental and an identity may appear once,
 * which is why a repeated identity is refused with "contains duplicate
 * choices". Some rules are lists instead — Lacuna's repair order spends the
 * resources left after each entry, so repairing one building twice in one
 * command is a legal, meaningful move whose SECOND entry is computed from the
 * first. There was no way to say that.
 *
 * `orderedList` says it, as a separate option rather than a flag on
 * `multiSelect`: the two differ in what a submission MEANS (a set versus a
 * sequence), in what is refused (duplicates versus nothing), and in what the
 * panel draws (checkboxes versus a built-up list), so a reader of the call site
 * must be able to tell them apart without reading a boolean. Declaring both is
 * refused outright.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Action, ActionExecutor } from '../index.js';
import type { Selection } from '../index.js';
import { buildPickMetadata } from '../element/action-metadata.js';

class TestGame extends Game<TestGame, Player> {}

describe('orderedList — an ordered, repeatable list of choices (#249)', () => {
  let game: TestGame;
  let executor: ActionExecutor;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    executor = new ActionExecutor(game);
  });

  /** Validate one submission against one selection, as seat 1. */
  const check = (
    selection: Selection,
    value: unknown,
    args: Record<string, unknown> = {}
  ) => executor.validateSelection(selection, value, game.getPlayer(1)!, args);

  /** The ticket's own shape: up to three repairs, in the order given. */
  const repairs = () =>
    Action.create<TestGame>('repair')
      .chooseFrom('buildings', {
        choices: ['university', 'shipyard'],
        orderedList: { min: 0, max: 3 },
      })
      .execute(() => {});

  it('ACCEPTS a repeated identity, which multiSelect refuses', () => {
    const result = check(repairs().selections[0], ['university', 'university']);

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('leaves an ordinary multiSelect refusing the same submission, unchanged', () => {
    const action = Action.create<TestGame>('repair')
      .chooseFrom('buildings', {
        choices: ['university', 'shipyard'],
        multiSelect: { min: 0, max: 3 },
      })
      .execute(() => {});

    const result = check(action.selections[0], ['university', 'university']);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('duplicate');
  });

  it('counts ENTRIES against max, not distinct identities', () => {
    const result = check(repairs().selections[0], ['university', 'university', 'shipyard', 'university']);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('at most 3');
  });

  it('counts ENTRIES against min, so repeats DO satisfy a lower bound', () => {
    const action = Action.create<TestGame>('repair')
      .chooseFrom('buildings', {
        choices: ['university', 'shipyard'],
        orderedList: { min: 2 },
      })
      .execute(() => {});

    expect(
      check(action.selections[0], ['university', 'university']).valid
    ).toBe(true);

    const short = check(action.selections[0], ['university']);
    expect(short.valid).toBe(false);
    expect(short.errors.join(' ')).toContain('at least 2');
  });

  it('checks EVERY occurrence against the current authoritative choice set', () => {
    const result = check(repairs().selections[0], ['university', 'observatory', 'university']);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('observatory');
  });

  it('refuses a repeated occurrence of a DISABLED choice, every time it appears', () => {
    const action = Action.create<TestGame>('repair')
      .chooseFrom('buildings', {
        choices: ['university', 'shipyard'],
        orderedList: { max: 3 },
        disabled: (choice) => (choice === 'shipyard' ? 'Already at full condition.' : false),
      })
      .execute(() => {});

    const result = check(action.selections[0], ['university', 'shipyard']);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('Already at full condition.');
  });

  it('refuses a bare value: a list selection is a list, never a shorthand for one entry', () => {
    const result = check(repairs().selections[0], 'university');

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('expected an array');
  });

  it('resolves a FUNCTION form against the arguments bound so far', () => {
    const action = Action.create<TestGame>('repair')
      .chooseFrom('budget', { choices: [1, 2] })
      .chooseFrom('buildings', {
        choices: ['university'],
        orderedList: (ctx) => ({ min: 1, max: Number(ctx.args.budget) }),
      })
      .execute(() => {});

    const withinBudget = check(action.selections[1], ['university', 'university'], { budget: 2 });
    expect(withinBudget.valid).toBe(true);

    const overBudget = check(action.selections[1], ['university', 'university'], { budget: 1 });
    expect(overBudget.valid).toBe(false);
    expect(overBudget.errors.join(' ')).toContain('at most 1');
  });

  it('takes a number as shorthand for "up to N entries"', () => {
    const action = Action.create<TestGame>('repair')
      .chooseFrom('buildings', { choices: ['university'], orderedList: 2 })
      .execute(() => {});

    expect(
      check(action.selections[0], ['university', 'university']).valid
    ).toBe(true);
    expect(
      check(action.selections[0], ['university', 'university', 'university']).valid
    ).toBe(false);
  });

  it('hands the execute handler the list in the ORDER it was submitted, repeats intact', () => {
    const seen: string[][] = [];
    const action = Action.create<TestGame>('repair')
      .chooseFrom('buildings', {
        choices: ['university', 'shipyard'],
        orderedList: { min: 1, max: 4 },
      })
      // The engine builder's own arg type for a chooseFrom is `T` whether the
      // option is multiSelect or orderedList -- a world's facade is where the
      // array is knowable from the call. Read as one here, as every other engine
      // multi-value test does.
      .execute((args) => {
        seen.push([...(args.buildings as unknown as string[])]);
      });
    game.registerAction(action);

    const result = game.performAction('repair', game.getPlayer(1)!, {
      buildings: ['shipyard', 'university', 'shipyard'],
    });

    expect(result.success).toBe(true);
    expect(seen).toEqual([['shipyard', 'university', 'shipyard']]);
  });

  it('REFUSES an action that declares both multiSelect and orderedList', () => {
    expect(() =>
      Action.create<TestGame>('repair').chooseFrom('buildings', {
        choices: ['university'],
        multiSelect: 2,
        orderedList: 2,
      })
    ).toThrow(/multiSelect.*orderedList|orderedList.*multiSelect/);
  });

  it('puts the bounds on the pick metadata a host serializes, max omitted when unbounded', () => {
    const bounded = buildPickMetadata(game, game.getPlayer(1)!, repairs().selections[0]);
    expect(bounded.orderedList).toEqual({ min: 0, max: 3 });
    expect(bounded.multiSelect).toBeUndefined();

    const unbounded = Action.create<TestGame>('repair')
      .chooseFrom('buildings', { choices: ['university'], orderedList: { min: 1 } })
      .execute(() => {});
    const pick = buildPickMetadata(game, game.getPlayer(1)!, unbounded.selections[0]);

    // `Infinity` is not JSON — it serializes as `null`, which the panel read as
    // a cap of nothing (ShufflewickPub #378). An unbounded list OMITS max.
    expect(pick.orderedList).toEqual({ min: 1 });
    expect('max' in (pick.orderedList as object)).toBe(false);
  });
});

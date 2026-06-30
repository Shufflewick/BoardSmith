/**
 * TEST-05: ActionBuilder — ergonomic multi-step / dependent-selection builder
 *
 * Verifies that:
 * (1) getChoices(selectionName) returns only enabled choices (disabled === false).
 * (2) After select(firstSel, value), getChoices(secondSel) reflects the accumulated
 *     arg — cross-layer integration: testing → engine (getSelectionChoices).
 * (3) execute() runs the action successfully when all args are valid.
 * (4) execute() throws a descriptive Error naming the action + seat on failure.
 * (5) buildArgs() returns accumulated selection values as a Record without executing.
 * (6) testGame.action(name, seat) factory returns an ActionBuilder instance.
 *
 * Cross-layer boundary: testing → engine (getSelectionChoices)
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type FlowContext,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { ActionBuilder } from './action-builder.js';

// ---------------------------------------------------------------------------
// Fixture: SelectionBuilderGame
//
// Has one action 'categorize' with two selections:
//   • 'category' — static choices ['A', 'B'];
//                  'B' is disabled so getChoices should only return ['A']
//   • 'item'     — choices depend on 'category':
//                  if category='A' → [10, 20, 30]
//                  if category='B' → [40, 50]
//                  (dependent-selection integration test)
//
// Game loops until 3 categorize actions have been executed.
// ---------------------------------------------------------------------------

class SelectionBuilderGame extends Game<SelectionBuilderGame, Player> {
  moves = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<SelectionBuilderGame>('categorize')
        .chooseFrom('category', {
          choices: ['A', 'B'],
          // 'B' is always disabled — getChoices must filter it out (Pitfall 3)
          disabled: (choice: string) =>
            choice === 'B' ? 'Category B is reserved' : false,
        })
        .chooseFrom('item', {
          // Choices depend on the previously accumulated 'category' arg.
          // This exercises the dependent-selection path through getSelectionChoices.
          choices: (ctx) =>
            (ctx.args.category as string) === 'A' ? [10, 20, 30] : [40, 50],
        })
        .execute((args, ctx) => {
          (ctx.game as SelectionBuilderGame).moves += 1;
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx: FlowContext) =>
            (ctx.game as SelectionBuilderGame).moves < 3,
          maxIterations: 20,
          do: eachPlayer({
            do: actionStep({ actions: ['categorize'] }),
          }),
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeFixture(): TestGame<SelectionBuilderGame> {
  return TestGame.create(SelectionBuilderGame, {
    playerCount: 2,
    seed: 'action-builder-test',
  });
}

// ---------------------------------------------------------------------------
// TEST-05 (1): getChoices returns only enabled choices
// ---------------------------------------------------------------------------

describe('ActionBuilder — TEST-05: enabled-only choices', () => {
  it('getChoices() returns only choices where disabled === false', () => {
    const testGame = makeFixture();
    const builder = new ActionBuilder(testGame, 'categorize', 1);

    const choices = builder.getChoices('category');

    // 'A' is enabled, 'B' is disabled — only 'A' should be returned
    expect(choices).toEqual(['A']);
    expect(choices).not.toContain('B');
  });

  it('getChoices() returns choice VALUES, not AnnotatedChoice wrappers', () => {
    const testGame = makeFixture();
    const builder = new ActionBuilder(testGame, 'categorize', 1);

    const choices = builder.getChoices('category');

    // Values are primitives — not objects with {value, disabled} shape
    for (const c of choices) {
      expect(typeof c).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-05 (2): dependent selection — getChoices reflects accumulated args
// Cross-layer integration: testing → engine (getSelectionChoices)
// ---------------------------------------------------------------------------

describe('ActionBuilder — TEST-05: dependent selection', () => {
  it("getChoices('item') after select('category','A') returns A-specific items", () => {
    const testGame = makeFixture();
    const builder = new ActionBuilder(testGame, 'categorize', 1);

    builder.select('category', 'A');
    const items = builder.getChoices('item');

    // Category A maps to items [10, 20, 30]
    expect(items).toEqual([10, 20, 30]);
  });

  it("getChoices('item') with no prior select returns items for any category path", () => {
    const testGame = makeFixture();
    const builder = new ActionBuilder(testGame, 'categorize', 1);

    // Without any accumulated arg, getSelectionChoices evaluates choices with
    // args = {} → ctx.args.category is undefined → function returns []
    // (the integration confirms that passing args={} flows through to the engine).
    const items = builder.getChoices('item');

    // No category selected yet — choices function returns [] (undefined !== 'A')
    expect(items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TEST-05 (3): execute() succeeds when args are valid
// ---------------------------------------------------------------------------

describe('ActionBuilder — TEST-05: execute success', () => {
  it('execute() performs the action and advances game state', () => {
    const testGame = makeFixture();
    const movesBefore = testGame.game.moves;

    new ActionBuilder(testGame, 'categorize', 1)
      .select('category', 'A')
      .select('item', 10)
      .execute();

    expect(testGame.game.moves).toBe(movesBefore + 1);
  });

  it('select() is fluent and returns the same ActionBuilder instance', () => {
    const testGame = makeFixture();
    const builder = new ActionBuilder(testGame, 'categorize', 1);

    const result = builder.select('category', 'A');

    expect(result).toBe(builder);
  });
});

// ---------------------------------------------------------------------------
// TEST-05 (4): execute() throws descriptive error on failure
// ---------------------------------------------------------------------------

describe('ActionBuilder — TEST-05: execute error', () => {
  it('execute() throws an Error when the action fails', () => {
    const testGame = makeFixture();
    // No selections made — required 'category' and 'item' are absent → action fails
    const builder = new ActionBuilder(testGame, 'categorize', 1);

    expect(() => builder.execute()).toThrow(Error);
  });

  it('execute() error message names the action and seat', () => {
    const testGame = makeFixture();
    const builder = new ActionBuilder(testGame, 'categorize', 1);

    let caught: Error | undefined;
    try {
      builder.execute();
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toContain('categorize');
    expect(caught!.message).toContain('1');
  });
});

// ---------------------------------------------------------------------------
// TEST-05 (5): buildArgs() returns accumulated values without executing
// ---------------------------------------------------------------------------

describe('ActionBuilder — TEST-05: buildArgs()', () => {
  it('buildArgs() returns accumulated selection values as a Record', () => {
    const testGame = makeFixture();
    const builder = new ActionBuilder(testGame, 'categorize', 1)
      .select('category', 'A')
      .select('item', 10);

    const args = builder.buildArgs();

    expect(args).toEqual({ category: 'A', item: 10 });
  });

  it('buildArgs() returns a shallow copy — mutations do not affect internal state', () => {
    const testGame = makeFixture();
    const builder = new ActionBuilder(testGame, 'categorize', 1)
      .select('category', 'A');

    const args = builder.buildArgs();
    args['extra'] = 'mutation';

    // Internal args must not be affected
    const args2 = builder.buildArgs();
    expect(args2).not.toHaveProperty('extra');
  });

  it('buildArgs() does NOT execute the action', () => {
    const testGame = makeFixture();
    const movesBefore = testGame.game.moves;

    new ActionBuilder(testGame, 'categorize', 1)
      .select('category', 'A')
      .select('item', 10)
      .buildArgs();  // not execute()

    expect(testGame.game.moves).toBe(movesBefore);
  });
});

// ---------------------------------------------------------------------------
// TEST-05 (6): testGame.action() factory
// ---------------------------------------------------------------------------

describe('ActionBuilder — TEST-05: factory', () => {
  it('testGame.action(name, seat) returns an ActionBuilder instance', () => {
    const testGame = makeFixture();

    const builder = testGame.action('categorize', 1);

    expect(builder).toBeInstanceOf(ActionBuilder);
  });

  it('testGame.action() factory produces a builder that works end-to-end', () => {
    const testGame = makeFixture();
    const movesBefore = testGame.game.moves;

    testGame.action('categorize', 1)
      .select('category', 'A')
      .select('item', 20)
      .execute();

    expect(testGame.game.moves).toBe(movesBefore + 1);
  });
});

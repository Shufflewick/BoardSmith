/**
 * TEST-03: assertActionAvailable trace-on-failure
 * TEST-04: assertFlowState actionsMode option
 *
 * Cross-layer boundary: testing → engine (debugActionAvailability)
 * The trace must flow from the engine through the assertion error message.
 */
import { describe, it, expect, vi } from 'vitest';
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
import { assertActionAvailable, assertFlowState } from './assertions.js';

// ---------------------------------------------------------------------------
// Fixture: game for TEST-03 (trace) and TEST-04 (actionsMode)
//
// Available actions while it is player 1's turn:
//   • 'pick' — has valid choices [1,2,3]; always available
//   • 'pass' — no selections; always available
//
// Registered but always unavailable (no valid choices):
//   • 'constrained' — chooseFrom returns [] → 0 choices → blocked
// ---------------------------------------------------------------------------

class AssertionsFixtureGame extends Game<AssertionsFixtureGame, Player> {
  total = 0;

  constructor(options: GameOptions) {
    super(options);

    // Available action with valid selections
    this.registerAction(
      Action.create<AssertionsFixtureGame>('pick')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          (ctx.game as AssertionsFixtureGame).total += args.value as number;
          return { success: true };
        }),
    );

    // Available action with no selections
    this.registerAction(
      Action.create<AssertionsFixtureGame>('pass')
        .execute(() => ({ success: true })),
    );

    // Registered but unavailable: choices function always returns empty array.
    // This ensures debugActionAvailability returns a non-trivial trace with a
    // blocking selection and a note — exactly what TEST-03 exercises.
    this.registerAction(
      Action.create<AssertionsFixtureGame>('constrained')
        .chooseFrom('value', { choices: () => [] as number[] })
        .execute(() => ({ success: true })),
    );

    // Flow: loop until total >= 6, one action step per player per iteration.
    // Only 'pick' and 'pass' are in-scope for the actionStep; 'constrained' is
    // registered on the game but deliberately excluded from the flow step so it
    // never appears in availableActions — making assertActionAvailable for it
    // fail and trigger the trace path.
    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx: FlowContext) =>
            (ctx.game as AssertionsFixtureGame).total < 6,
          maxIterations: 100,
          do: eachPlayer({
            do: actionStep({ actions: ['pick', 'pass'] }),
          }),
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Helper: create a started 2-player fixture game
// ---------------------------------------------------------------------------

function makeFixture(): TestGame<AssertionsFixtureGame> {
  return TestGame.create(AssertionsFixtureGame, {
    playerCount: 2,
    seed: 'assertions-test',
  });
}

// ---------------------------------------------------------------------------
// TEST-03: assertActionAvailable — trace on failure
// ---------------------------------------------------------------------------

describe('assertActionAvailable — TEST-03: trace-on-failure', () => {
  it('failure message includes debugInfo.reason for an unavailable action', () => {
    // 'constrained' is registered but has no valid choices → not in availableActions
    // The failure branch should call debugActionAvailability and include the reason.
    const testGame = makeFixture();

    let thrownError: Error | undefined;
    try {
      assertActionAvailable(testGame, 1, 'constrained');
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).toBeDefined();
    // The reason from debugActionAvailability must be present in the message.
    // Expected reason: "Selection 'value' has no valid choices (...)"
    expect(thrownError!.message).toContain('Why:');
    expect(thrownError!.message).toMatch(/value|no valid choice|No elements/i);
  });

  it('failure message includes per-selection note lines', () => {
    // The selections block should list the 'value' selection with its note.
    const testGame = makeFixture();

    let thrownError: Error | undefined;
    try {
      assertActionAvailable(testGame, 1, 'constrained');
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).toBeDefined();
    // The message should include a "Selections:" block with per-selection lines.
    expect(thrownError!.message).toContain('Selections:');
    // Each selection line starts with ✓ or ✗
    expect(thrownError!.message).toMatch(/[✓✗]/);
  });

  it('passing assertActionAvailable does NOT invoke debugActionAvailability', () => {
    // Spy on game.debugActionAvailability — it must NOT be called on the success path.
    const testGame = makeFixture();
    const spy = vi.spyOn(testGame.game, 'debugActionAvailability');

    // 'pick' IS in availableActions → should pass without calling the debug method
    expect(() => assertActionAvailable(testGame, 1, 'pick')).not.toThrow();
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// TEST-04: assertFlowState — actionsMode option
// ---------------------------------------------------------------------------

describe('assertFlowState — TEST-04: actionsMode option', () => {
  it("actionsMode: 'exact' fails when extra actions are available", () => {
    // available = ['pick', 'pass']; expected only ['pick'] — 'pass' is extra
    const testGame = makeFixture();

    expect(() =>
      assertFlowState(testGame, {
        actions: ['pick'],
        actionsMode: 'exact',
      }),
    ).toThrow(/Unexpected available actions/);
  });

  it("actionsMode: 'contains' passes despite extra available actions", () => {
    // available = ['pick', 'pass']; expected only ['pick'] — should pass in contains mode
    const testGame = makeFixture();

    expect(() =>
      assertFlowState(testGame, {
        actions: ['pick'],
        actionsMode: 'contains',
      }),
    ).not.toThrow();
  });

  it('no actionsMode defaults to exact behavior (D-06 backward-compat pin)', () => {
    // Omitting actionsMode should behave identically to actionsMode: 'exact'
    const testGame = makeFixture();

    expect(() =>
      assertFlowState(testGame, {
        actions: ['pick'],
        // no actionsMode
      }),
    ).toThrow(/Unexpected available actions/);
  });
});

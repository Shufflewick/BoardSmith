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
  simultaneousActionStep,
  type GameOptions,
  type FlowContext,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { assertActionAvailable, assertActionNotAvailable, assertFlowState } from './assertions.js';

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

// ---------------------------------------------------------------------------
// CR-01/02/03 regression: simultaneous-turn support
//
// A simultaneousActionStep sets awaitingPlayers (not currentPlayer).
// The three assertion helpers previously read currentPlayer, which is
// undefined in simultaneous turns — causing:
//   CR-01: assertActionAvailable threw false error for active players
//   CR-02: assertActionNotAvailable silently passed (false pass)
//   CR-03: assertFlowState reported all actions as missing
//
// These tests pin the correct behavior for all three helpers.
// ---------------------------------------------------------------------------

/** Fixture: both players must bid; game ends when both have acted. */
class BidPlayer extends Player<BidGame, BidPlayer> {
  hasBid = false;
}

class BidGame extends Game<BidGame, BidPlayer> {
  static PlayerClass = BidPlayer;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<BidGame>('bid').execute((_args, ctx) => {
        (ctx.player as BidPlayer).hasBid = true;
        return { success: true };
      }),
    );

    // 'fold' is a second action only player 2 should have — used by CR-02 test
    // to verify assertActionNotAvailable doesn't silently pass for a real action.
    this.registerAction(
      Action.create<BidGame>('fold').execute((_args, ctx) => {
        (ctx.player as BidPlayer).hasBid = true;
        return { success: true };
      }),
    );

    this.setFlow(
      defineFlow({
        root: simultaneousActionStep({
          actions: ['bid', 'fold'],
          playerDone: (_ctx, p) => (p as BidPlayer).hasBid,
        }),
      }),
    );
  }
}

function makeBidGame(): TestGame<BidGame> {
  return TestGame.create(BidGame, { playerCount: 2, seed: 'bid-test' });
}

describe('assertActionAvailable — CR-01: simultaneous turns', () => {
  it('does NOT throw for an active simultaneous player with the action available', () => {
    // Both player 1 and player 2 are active via awaitingPlayers.
    // Previously the guard used currentPlayer (undefined here), throwing a false error.
    const testGame = makeBidGame();
    expect(() => assertActionAvailable(testGame, 1, 'bid')).not.toThrow();
    expect(() => assertActionAvailable(testGame, 2, 'bid')).not.toThrow();
  });

  it('throws when the seat is active but the named action is not available', () => {
    // 'ask' is not registered in BidGame — should still throw the "not available" error.
    const testGame = makeBidGame();
    expect(() => assertActionAvailable(testGame, 1, 'ask')).toThrow(/not available/i);
  });

  it('error message mentions awaitingPlayers when currentPlayer is undefined', () => {
    // Verify the error message is actionable for a simultaneous-turn game where
    // the requested seat is not an active awaiting player at all.
    // Use seat 3 — it does not exist in a 2-player game.
    const testGame = makeBidGame();
    let err: Error | undefined;
    try {
      assertActionAvailable(testGame, 3, 'bid');
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/awaitingPlayers/i);
  });
});

describe('assertActionNotAvailable — CR-02: simultaneous turns', () => {
  it('does NOT silently pass when a simultaneous player IS active and action IS available', () => {
    // Previously returned early because currentPlayer (undefined) !== playerSeat.
    // This was a false pass — the seat IS active, 'bid' IS available.
    const testGame = makeBidGame();
    // 'bid' IS available for both players — assertActionNotAvailable should throw.
    expect(() => assertActionNotAvailable(testGame, 1, 'bid')).toThrow(
      /should NOT be available/i,
    );
  });

  it('passes (no throw) for a seat that is truly not active', () => {
    // Seat 3 does not exist — canSeatAct returns false → should pass silently.
    const testGame = makeBidGame();
    expect(() => assertActionNotAvailable(testGame, 3, 'bid')).not.toThrow();
  });

  it('passes after a player has completed their simultaneous action', () => {
    // After player 1 bids, their slot is marked completed; their actions should
    // not be available any more — assertActionNotAvailable should not throw.
    const testGame = makeBidGame();
    testGame.doAction(1, 'bid', {});
    expect(() => assertActionNotAvailable(testGame, 1, 'bid')).not.toThrow();
  });
});

describe('assertFlowState — CR-03: simultaneous turns', () => {
  it("reports correct actions for a simultaneous step (contains mode)", () => {
    // availableActions is undefined on a simultaneous step; the fix reads from
    // awaitingPlayers[*].availableActions instead.
    const testGame = makeBidGame();
    expect(() =>
      assertFlowState(testGame, {
        actions: ['bid', 'fold'],
        actionsMode: 'contains',
      }),
    ).not.toThrow();
  });

  it("fails when an expected action is genuinely missing in a simultaneous step", () => {
    const testGame = makeBidGame();
    expect(() =>
      assertFlowState(testGame, {
        actions: ['nonexistent'],
        actionsMode: 'contains',
      }),
    ).toThrow(/Missing expected actions/i);
  });
});

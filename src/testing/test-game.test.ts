/**
 * TEST-01: Typed observable state — getPlayerView annotation + JSDoc
 *
 * Verifies that:
 * (1) testGame.getPlayerView(seat) returns an object whose shape matches
 *     PlayerStateView (IDE surfaces the type; no JSON parsing required).
 * (2) Hidden-info exclusion: the perspective filter is in effect — a player
 *     cannot see another player's hand contents through their own view.
 * (3) Typed per-game access: testGame.game exposes the concrete game class so
 *     custom properties are readable without casts.
 *
 * Cross-layer boundary: testing → engine (createPlayerView / toJSONForPlayer)
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Hand,
  Card,
  Space,
  Piece,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type ElementJSON,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import type { PlayerStateView } from '../runtime/index.js';

// ---------------------------------------------------------------------------
// Fixture: a minimal 2-player card game with per-player hands
// ---------------------------------------------------------------------------

/** Card element used in the fixture game */
class FixtureCard extends Card<FixtureGame> {
  rank!: string;
}

/**
 * Minimal game fixture for TEST-01.
 *
 * Each player receives one card in an owner-only hand so we can verify both
 * the PlayerStateView shape and the hidden-info perspective filter.
 * The `score` property demonstrates typed per-game custom-property access via
 * `testGame.game.score`.
 */
class FixtureGame extends Game<FixtureGame, Player> {
  /** Custom game property — readable via testGame.game.score (typed as number) */
  score = 0;

  constructor(options: GameOptions) {
    super(options);

    // Register custom element classes so they survive serialization
    this.registerElements([FixtureCard]);

    // Deal one card per player into an owner-only hand
    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      // Hand defaults to contentsVisibleToOwner() — call it explicitly for clarity
      hand.contentsVisibleToOwner();
      hand.create(FixtureCard, `card-p${player.seat}`, { rank: String(player.seat) });
    }

    // Simple flow: one turn per player, awaiting input from the active player
    this.registerAction(
      Action.create<FixtureGame>('pass').execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => false, // single pass-through then complete
          maxIterations: 10,
          do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function findChildByName(
  json: ElementJSON,
  name: string,
): ElementJSON | undefined {
  return json.children?.find((c) => c.name === name);
}

// ---------------------------------------------------------------------------
// TEST-01 tests
// ---------------------------------------------------------------------------

describe('TestGame.getPlayerView — TEST-01: typed observable state', () => {
  // Use a fixed seed so the fixture is deterministic
  let testGame: TestGame<FixtureGame>;

  // Create a fresh game before each test so state cannot leak between tests
  function makeGame() {
    return TestGame.create(FixtureGame, { playerCount: 2, seed: 'test-01-seed' });
  }

  // -------------------------------------------------------------------------
  // (1) PlayerStateView shape
  // -------------------------------------------------------------------------

  describe('getPlayerView(seat) returns a PlayerStateView', () => {
    it('returns an object with the player field matching the requested seat', () => {
      testGame = makeGame();
      const view = testGame.getPlayerView(1);
      expect(view.player).toBe(1);
    });

    it('returns view.player === 2 when seat 2 is requested', () => {
      testGame = makeGame();
      const view = testGame.getPlayerView(2);
      expect(view.player).toBe(2);
    });

    it('returns a view with a phase field (string)', () => {
      testGame = makeGame();
      const view = testGame.getPlayerView(1);
      expect(typeof view.phase).toBe('string');
    });

    it('returns a view with a complete field (boolean)', () => {
      testGame = makeGame();
      const view = testGame.getPlayerView(1);
      expect(typeof view.complete).toBe('boolean');
    });

    it('returns a view with a flowState field reflecting the active turn', () => {
      testGame = makeGame();
      const view = testGame.getPlayerView(1);
      // flowState is set while the game is awaiting input
      expect(view.flowState).toBeDefined();
      expect(typeof view.flowState!.awaitingInput).toBe('boolean');
      expect(typeof view.flowState!.isMyTurn).toBe('boolean');
    });

    it('view.flowState.isMyTurn is true for the active seat and false for others', () => {
      testGame = makeGame();
      const activeFlowState = testGame.getFlowState();
      const activePlayer = activeFlowState?.currentPlayer;
      expect(activePlayer).toBeDefined();

      const activeView = testGame.getPlayerView(activePlayer!);
      expect(activeView.flowState?.isMyTurn).toBe(true);

      // The other player's view should report isMyTurn === false
      const otherSeat = activePlayer === 1 ? 2 : 1;
      const otherView = testGame.getPlayerView(otherSeat);
      expect(otherView.flowState?.isMyTurn).toBe(false);
    });

    it('return type satisfies PlayerStateView (type-level — state field is ElementJSON)', () => {
      testGame = makeGame();
      // Assign to a typed variable — TS will fail to compile if the type is wrong
      const view: PlayerStateView = testGame.getPlayerView(1);
      // state is ElementJSON (perspective-filtered tree), not the typed game model
      expect(view.state).toBeDefined();
      expect(typeof view.state).toBe('object');
    });
  });

  // -------------------------------------------------------------------------
  // (2) Hidden-info exclusion (cross-layer: testing → engine perspective filter)
  // -------------------------------------------------------------------------

  describe('hidden-info exclusion — perspective filter is in effect', () => {
    it('player 1 cannot see the contents of player 2 hand (cards are hidden)', () => {
      testGame = makeGame();
      const p1View = testGame.getPlayerView(1);

      // Locate player 2's hand in player 1's view
      const hand2 = findChildByName(p1View.state, 'hand-2');
      expect(hand2).toBeDefined(); // the hand element itself must appear
      expect(hand2!.children).toBeDefined();
      expect(hand2!.children!.length).toBeGreaterThan(0); // placeholder present

      // All children of hand-2 in player 1's view must be marked hidden
      for (const child of hand2!.children!) {
        expect(
          child.attributes.__hidden,
          `card in hand-2 should be hidden from player 1's view`,
        ).toBe(true);
        // The card's rank attribute must NOT be disclosed to the non-owner
        expect(
          child.attributes.rank,
          `card rank must not be visible to non-owner`,
        ).toBeUndefined();
      }
    });

    it('player 2 cannot see the contents of player 1 hand (cards are hidden)', () => {
      testGame = makeGame();
      const p2View = testGame.getPlayerView(2);

      const hand1 = findChildByName(p2View.state, 'hand-1');
      expect(hand1).toBeDefined();
      expect(hand1!.children).toBeDefined();
      expect(hand1!.children!.length).toBeGreaterThan(0);

      for (const child of hand1!.children!) {
        expect(
          child.attributes.__hidden,
          `card in hand-1 should be hidden from player 2's view`,
        ).toBe(true);
        expect(child.attributes.rank).toBeUndefined();
      }
    });

    it('each player CAN see the contents of their own hand', () => {
      testGame = makeGame();

      const p1View = testGame.getPlayerView(1);
      const ownHand1 = findChildByName(p1View.state, 'hand-1');
      expect(ownHand1).toBeDefined();
      const ownCards1 = ownHand1!.children ?? [];
      expect(ownCards1.length).toBeGreaterThan(0);
      for (const card of ownCards1) {
        expect(card.attributes.__hidden).toBeUndefined();
        expect(card.attributes.rank).toBe('1');
      }

      const p2View = testGame.getPlayerView(2);
      const ownHand2 = findChildByName(p2View.state, 'hand-2');
      expect(ownHand2).toBeDefined();
      const ownCards2 = ownHand2!.children ?? [];
      expect(ownCards2.length).toBeGreaterThan(0);
      for (const card of ownCards2) {
        expect(card.attributes.__hidden).toBeUndefined();
        expect(card.attributes.rank).toBe('2');
      }
    });

    it('views for seat 1 and seat 2 are distinct (per-seat perspective)', () => {
      testGame = makeGame();
      const p1View = testGame.getPlayerView(1);
      const p2View = testGame.getPlayerView(2);

      expect(p1View.player).not.toBe(p2View.player);
      expect(p1View.flowState?.isMyTurn).not.toBe(p2View.flowState?.isMyTurn);
    });
  });

  // -------------------------------------------------------------------------
  // (3) Typed per-game access — testGame.game is the concrete class
  // -------------------------------------------------------------------------

  describe('testGame.game gives typed access to per-game custom properties', () => {
    it('testGame.game.score is accessible as a number without casting', () => {
      testGame = makeGame();
      // TypeScript infers testGame.game as FixtureGame — score is typed as number
      const score: number = testGame.game.score;
      expect(score).toBe(0);
    });

    it('testGame.game is the same instance used by the runner', () => {
      testGame = makeGame();
      // game and runner.game must reference the same object
      expect(testGame.game).toBe(testGame.runner.game);
    });
  });
});

// ---------------------------------------------------------------------------
// TST-01: doAction throw-on-failure + tryAction escape hatch
// ---------------------------------------------------------------------------

/**
 * Minimal single-actionStep game fixture for TST-01. FixtureGame's `pass`
 * flow (a `loop({ while: () => false, ... })`) completes on construction
 * before any action can be submitted, so a dedicated always-awaiting fixture
 * is used here to exercise the doAction success path.
 */
class TST01Game extends Game<TST01Game, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<TST01Game>('pass').execute(() => ({ success: true })),
    );
    this.setFlow(defineFlow({ root: actionStep({ actions: ['pass'] }) }));
  }
}

describe('doAction throw-on-failure (TST-01)', () => {
  it('doAction THROWS when the action is unavailable, naming the action and seat, with an availability trace', () => {
    const testGame = TestGame.create(TST01Game, { playerCount: 2, seed: 'tst-01-throw' });

    expect(() => testGame.doAction(1, 'notAnAction', {})).toThrow(/notAnAction/);
    // The thrown message must name the seat and include an availability/"Why:" trace fragment.
    try {
      testGame.doAction(1, 'notAnAction', {});
      throw new Error('expected doAction to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('notAnAction');
      expect(message).toMatch(/seat 1|player 1/i);
      expect(message).toMatch(/Why:|Flow position:/);
    }
  });

  it('tryAction returns { success: false } WITHOUT throwing for the same unavailable action', () => {
    const testGame = TestGame.create(TST01Game, { playerCount: 2, seed: 'tst-01-try' });

    let result: { success: boolean } | undefined;
    expect(() => {
      result = testGame.tryAction(1, 'notAnAction', {});
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });

  it('doAction does NOT throw for a valid action and completes normally', () => {
    const testGame = TestGame.create(TST01Game, { playerCount: 2, seed: 'tst-01-valid' });

    expect(() => testGame.doAction(1, 'pass', {})).not.toThrow();
    expect(testGame.isComplete()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixture: a 2-selection action for FLOW-03 pending-action introspection
// (Phase 123 Plan 03)
// ---------------------------------------------------------------------------

/**
 * Minimal game fixture with a two-selection ('color' then 'size') action, so
 * we can drive selections one at a time via the session-free
 * `GameRunner.startPendingAction`/`processSelectionStep` path and inspect the
 * in-progress `PendingActionState` via `TestGame.getPendingAction(seat)`.
 */
class MultiStepGame extends Game<MultiStepGame, Player> {
  chosenColor?: string;
  chosenSize?: string;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<MultiStepGame>('pick')
        .chooseFrom('color', { choices: ['red', 'blue', 'green'] })
        .chooseFrom('size', { choices: ['S', 'M', 'L'] })
        .execute((args, ctx) => {
          (ctx.game as MultiStepGame).chosenColor = args.color as string;
          (ctx.game as MultiStepGame).chosenSize = args.size as string;
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => true,
          maxIterations: 1, // one pass over all players, then complete
          do: eachPlayer({ do: actionStep({ actions: ['pick'] }) }),
        }),
      }),
    );
  }
}

function makeMultiStepGame(): TestGame<MultiStepGame> {
  return TestGame.create(MultiStepGame, { playerCount: 2, seed: 'flow-03-pending-action' });
}

describe('TestGame.getFlowDebugInfo — FLOW-01 passthrough (Phase 123 Plan 03)', () => {
  it('equals game.getFlowDebugInfo()', () => {
    const testGame = makeMultiStepGame();
    const viaTestGame = testGame.getFlowDebugInfo();
    const viaGame = testGame.game.getFlowDebugInfo();

    // describe() is a fresh closure per call — compare structural fields
    // directly and the formatted string separately (functions are never
    // reference-equal, so toEqual() on the whole object would false-fail).
    expect({ phase: viaTestGame.phase, step: viaTestGame.step, path: viaTestGame.path, awaiting: viaTestGame.awaiting })
      .toEqual({ phase: viaGame.phase, step: viaGame.step, path: viaGame.path, awaiting: viaGame.awaiting });
    expect(viaTestGame.describe()).toBe(viaGame.describe());
  });
});

describe('TestGame.getPendingAction — FLOW-03 (Phase 123 Plan 03)', () => {
  it('returns undefined when nothing is pending for the seat', () => {
    const testGame = makeMultiStepGame();
    expect(testGame.getPendingAction(1)).toBeUndefined();
  });

  it('returns undefined for an out-of-range seat (no throw)', () => {
    const testGame = makeMultiStepGame();
    expect(() => testGame.getPendingAction(99)).not.toThrow();
    expect(testGame.getPendingAction(99)).toBeUndefined();
  });

  it('returns a mid-action snapshot with current step + completed selections', () => {
    const testGame = makeMultiStepGame();
    testGame.runner.startPendingAction('pick', 1);
    const stepResult = testGame.runner.processSelectionStep(1, 'color', 'red');
    expect(stepResult.success).toBe(true);

    const snapshot = testGame.getPendingAction(1);
    expect(snapshot).toBeDefined();
    expect(snapshot!.actionName).toBe('pick');
    expect(snapshot!.currentSelectionIndex).toBe(1);
    expect(snapshot!.collectedArgs).toEqual({ color: 'red' });
  });

  it('returned snapshot is a copy — mutation does not leak back', () => {
    const testGame = makeMultiStepGame();
    testGame.runner.startPendingAction('pick', 1);
    testGame.runner.processSelectionStep(1, 'color', 'red');

    const snapshot = testGame.getPendingAction(1)!;
    snapshot.collectedArgs.color = 'MUTATED';
    snapshot.currentSelectionIndex = 999;

    const secondSnapshot = testGame.getPendingAction(1)!;
    expect(secondSnapshot.collectedArgs.color).toBe('red');
    expect(secondSnapshot.currentSelectionIndex).toBe(1);
  });

  it('completing the final selection clears the pending state and records history', () => {
    const testGame = makeMultiStepGame();
    testGame.runner.startPendingAction('pick', 1);
    testGame.runner.processSelectionStep(1, 'color', 'red');
    const finalResult = testGame.runner.processSelectionStep(1, 'size', 'M');

    expect(finalResult.success).toBe(true);
    expect(finalResult.actionComplete).toBe(true);
    expect(testGame.getPendingAction(1)).toBeUndefined();
    expect(testGame.game.chosenColor).toBe('red');
    expect(testGame.game.chosenSize).toBe('M');
  });
});

// ---------------------------------------------------------------------------
// Fixture: an action with a disabled choice, for FLOW-02 introspection
// (Phase 123 Plan 03)
// ---------------------------------------------------------------------------

/**
 * Minimal game fixture with one action whose choices include a disabled one
 * (mirrors `pick-handler.test.ts`'s `pickFruit` fixture — 'banana' disabled).
 */
class DisabledChoiceGame extends Game<DisabledChoiceGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<DisabledChoiceGame>('pickFruit')
        .chooseFrom('fruit', {
          prompt: 'Choose a fruit',
          choices: ['apple', 'banana', 'cherry'],
          disabled: (choice) => (choice === 'banana' ? 'Out of stock' : false),
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow(defineFlow({ root: actionStep({ actions: ['pickFruit'] }) }));
  }
}

describe('TestGame.getActionSpaceWithChoices — FLOW-02 (Phase 123 Plan 03)', () => {
  it('surfaces disabled choices with their reason alongside enabled choices', () => {
    const testGame = TestGame.create(DisabledChoiceGame, { playerCount: 1, seed: 'flow-02-disabled' });

    const view = testGame.getActionSpaceWithChoices(1);
    const pickFruit = view.actions.find((a) => a.name === 'pickFruit');
    expect(pickFruit).toBeDefined();

    const fruitSelection = pickFruit!.selections.find((s) => s.name === 'fruit');
    expect(fruitSelection).toBeDefined();
    expect(fruitSelection!.choices).toHaveLength(3);

    const banana = fruitSelection!.choices.find((c) => c.value === 'banana');
    expect(banana).toBeDefined();
    expect(banana!.disabled).toBe('Out of stock');

    const apple = fruitSelection!.choices.find((c) => c.value === 'apple');
    expect(apple).toBeDefined();
    expect(apple!.disabled).toBe(false);
  });

  it('returns { actions: [] } for an out-of-range seat (no throw)', () => {
    const testGame = TestGame.create(DisabledChoiceGame, { playerCount: 1, seed: 'flow-02-oob' });
    expect(() => testGame.getActionSpaceWithChoices(99)).not.toThrow();
    expect(testGame.getActionSpaceWithChoices(99)).toEqual({ actions: [] });
  });

  // Gameplay-path regression: the disabled choice surfaced above still cannot
  // be SUBMITTED through the gameplay pick path — this introspection helper
  // is display-only. That gameplay rejection is already covered end-to-end by
  // `pick-handler.test.ts` ("PickHandler disabled threading"), not re-tested here.
});

// ---------------------------------------------------------------------------
// Fixture: a shuffled deck, for TST-02 seedless-determinism coverage
// ---------------------------------------------------------------------------

/** Token element shuffled inside the fixture's constructor. */
class SeedToken extends Piece<SeedFixtureGame> {
  label!: string;
}

/**
 * Minimal game fixture whose constructor shuffles a 10-item deck using the
 * game's seeded rng — lets TST-02 tests observe whether two seedless
 * `TestGame.create()` calls produce identical shuffle order.
 */
class SeedFixtureGame extends Game<SeedFixtureGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerElements([SeedToken]);

    const deck = this.create(Space, 'deck');
    for (let i = 0; i < 10; i++) {
      deck.create(SeedToken, `token-${i}`, { label: `token-${i}` });
    }
    deck.shuffle();

    this.registerAction(
      Action.create<SeedFixtureGame>('pass').execute(() => ({ success: true })),
    );

    this.setFlow(defineFlow({ root: actionStep({ actions: ['pass'] }) }));
  }
}

describe('deterministic default seed (TST-02)', () => {
  it('two TestGames created with NO seed option produce identical shuffles', () => {
    const gameA = TestGame.create(SeedFixtureGame, { playerCount: 1 });
    const orderA = gameA.game.first(Space, 'deck')!.all(SeedToken).map((t) => t.label);

    const gameB = TestGame.create(SeedFixtureGame, { playerCount: 1 });
    const orderB = gameB.game.first(Space, 'deck')!.all(SeedToken).map((t) => t.label);

    expect(orderA).toEqual(orderB);
    // Sanity: shuffle actually reorders (not a no-op on 10 items).
    expect(orderA).not.toEqual(
      Array.from({ length: 10 }, (_, i) => `token-${i}`),
    );
  });

  it('testGame.seed returns the resolved seed — fixed literal default when unset', () => {
    const testGame = TestGame.create(SeedFixtureGame, { playerCount: 1 });
    expect(testGame.seed).toBeTypeOf('string');
    expect(testGame.seed).not.toMatch(/^test-\d+$/); // not a Date.now()-derived seed
  });

  it('testGame.seed returns the caller-supplied seed when explicitly set', () => {
    const testGame = TestGame.create(SeedFixtureGame, { playerCount: 1, seed: 'my-explicit-seed' });
    expect(testGame.seed).toBe('my-explicit-seed');
  });
});

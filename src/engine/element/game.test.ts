/**
 * PIT-03 unit coverage for Game#validateActionReachability() (called from
 * startFlow() before FlowEngine construction).
 *
 * - Throw case: an actionStep references an unregistered action (static
 *   string-array form).
 * - devWarn case: a registered action referenced by no actionStep.
 * - Positive case: a correctly-wired game starts clean (no throw, no warn).
 * - Function-valued-actions blind spot: actions field is a function, so it
 *   cannot be statically enumerated and must never throw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Game,
  Player,
  Action,
  Space,
  Card,
  Piece,
  Die,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../index.js';
import { _clearShownWarnings } from '../../utils/dev.js';

class MissingActionGame extends Game<MissingActionGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    // Only 'known' is registered; the flow also references 'missing'.
    this.registerAction(
      Action.create<MissingActionGame>('known').execute(() => {}),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 5,
          do: eachPlayer({
            do: actionStep({ actions: ['known', 'missing'] }),
          }),
        }),
      }),
    );
  }
}

class UnreachableActionGame extends Game<UnreachableActionGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    // 'used' is referenced by the actionStep; 'unused' is registered but
    // never referenced by any actionStep.
    this.registerAction(
      Action.create<UnreachableActionGame>('used').execute(() => {}),
    );
    this.registerAction(
      Action.create<UnreachableActionGame>('unused').execute(() => {}),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 5,
          do: eachPlayer({
            do: actionStep({ actions: ['used'] }),
          }),
        }),
      }),
    );
  }
}

class CorrectlyWiredGame extends Game<CorrectlyWiredGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<CorrectlyWiredGame>('draw').execute(() => {}),
    );
    this.registerAction(
      Action.create<CorrectlyWiredGame>('play').execute(() => {}),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 5,
          do: eachPlayer({
            do: actionStep({ actions: ['draw', 'play'] }),
          }),
        }),
      }),
    );
  }
}

class FunctionValuedActionsGame extends Game<FunctionValuedActionsGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    // Note: 'x' is deliberately unregistered — the function-valued `actions`
    // field is a static-walk blind spot (documented in
    // Game#validateActionReachability) and must never throw.
    // No outer loop() wrapper: a single eachPlayer pass with zero available
    // actions per player auto-completes the flow, avoiding an unrelated
    // loop-maxIterations safety error that would otherwise mask the
    // assertion this test cares about.
    this.setFlow(
      defineFlow({
        root: eachPlayer({
          do: actionStep({ actions: () => ['x'] }),
        }),
      }),
    );
  }
}

function makeOptions(): GameOptions {
  return {
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'pit-03-test',
  };
}

// ============================================
// PIT-02: unregistered-element-class query validation
// ============================================

/** Deliberately never created/registered by any PIT-02 test game. */
class Ghost extends Piece<UnregisteredQueryGame> {}

class TestDeck extends Space<UnregisteredQueryGame> {}

/** Flow queries `Ghost` during the first traversal without ever registering it. */
class UnregisteredQueryGame extends Game<UnregisteredQueryGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([TestDeck, Card]);
    const deck = this.create(TestDeck, 'deck');
    deck.create(Card, 'card');
    this.setFlow(
      defineFlow({
        setup: (ctx) => {
          (ctx.game as UnregisteredQueryGame).all(Ghost);
        },
        root: eachPlayer({
          do: actionStep({ actions: [] }),
        }),
      }),
    );
  }
}

/** Flow queries `Card` after Card elements were created (and hence registered) normally. */
class CorrectlyRegisteredQueryGame extends Game<CorrectlyRegisteredQueryGame, Player> {
  queriedCards: Card[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([TestDeck2]);
    const deck = this.create(TestDeck2, 'deck');
    deck.create(Card, 'card');
    this.setFlow(
      defineFlow({
        setup: (ctx) => {
          this.queriedCards = (ctx.game as CorrectlyRegisteredQueryGame).all(Card);
        },
        root: eachPlayer({
          do: actionStep({ actions: [] }),
        }),
      }),
    );
  }
}
class TestDeck2 extends Space<CorrectlyRegisteredQueryGame> {}

class TestDeck3 extends Space<UnregisteredHasQueryGame> {}

/**
 * Flow queries `Ghost` via `has()` (not `all`/`first`/etc.) during the first
 * traversal without ever registering it -- proves `has()` is recorded by
 * PIT-02 same as the other finders (WR-01).
 */
class UnregisteredHasQueryGame extends Game<UnregisteredHasQueryGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([TestDeck3, Card]);
    const deck = this.create(TestDeck3, 'deck');
    deck.create(Card, 'card');
    this.setFlow(
      defineFlow({
        setup: (ctx) => {
          (ctx.game as UnregisteredHasQueryGame).has(Ghost);
        },
        root: eachPlayer({
          do: actionStep({ actions: [] }),
        }),
      }),
    );
  }
}

class TestBagB extends Space<BuiltinBaseQueryGame> {}

/**
 * Flow queries the framework built-in `Die` polymorphically during the first
 * traversal WITHOUT the game ever registering `Die`. Built-in element classes
 * are seeded at construction, so this must NOT throw — PIT-02 exists to catch
 * unregistered CUSTOM classes, and games (and the engine's own DicePool.all(Die))
 * legitimately query built-in base classes. Mirrors the polyhedral-potions
 * migration finding.
 */
class BuiltinBaseQueryGame extends Game<BuiltinBaseQueryGame, Player> {
  dieCount = -1;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([TestBagB]);
    const bag = this.create(TestBagB, 'bag');
    // A subclass author would create their own Die subclass; here we create the
    // built-in Die directly to prove the base class need not be registered.
    bag.create(Die, 'd6');
    this.setFlow(
      defineFlow({
        setup: (ctx) => {
          this.dieCount = (ctx.game as BuiltinBaseQueryGame).all(Die).length;
        },
        root: eachPlayer({
          do: actionStep({ actions: [] }),
        }),
      }),
    );
  }
}

describe('PIT-02', () => {
  beforeEach(() => {
    _clearShownWarnings();
  });

  it('does not throw when the flow queries a built-in element class (Die) that was never explicitly registered', () => {
    const game = new BuiltinBaseQueryGame(makeOptions());
    expect(() => game.startFlow()).not.toThrow();
    expect(game.dieCount).toBe(1);
  });

  it('throws naming an element class queried but never registered during first traversal', () => {
    const game = new UnregisteredQueryGame(makeOptions());
    expect(() => game.startFlow()).toThrowError(/Ghost/);
    expect(() => new UnregisteredQueryGame(makeOptions()).startFlow()).toThrowError(
      /registerElements/,
    );
  });

  it('throws naming an element class queried only via has() but never registered during first traversal (WR-01)', () => {
    const game = new UnregisteredHasQueryGame(makeOptions());
    expect(() => game.startFlow()).toThrowError(/Ghost/);
    expect(() => new UnregisteredHasQueryGame(makeOptions()).startFlow()).toThrowError(
      /registerElements/,
    );
  });

  it('does not throw for a correctly-registered game whose flow queries a created class', () => {
    const game = new CorrectlyRegisteredQueryGame(makeOptions());
    expect(() => game.startFlow()).not.toThrow();
    expect(game.queriedCards).toHaveLength(1);
  });

  it('stops recording after the first traversal — a later query for an unregistered class does not throw', () => {
    const game = new CorrectlyRegisteredQueryGame(makeOptions());
    expect(() => game.startFlow()).not.toThrow();
    // Post-start query for a never-registered class: recording is off by now,
    // so this returns an empty collection instead of throwing (documented
    // post-start / async out-of-scope limitation).
    expect(() => game.all(Ghost)).not.toThrow();
    expect(game.all(Ghost)).toHaveLength(0);
  });

  it('does not leak recorded classes across games (per-game _ctx isolation)', () => {
    const registered = new CorrectlyRegisteredQueryGame(makeOptions());
    expect(() => registered.startFlow()).not.toThrow();

    // A second, independent game that never queries Ghost or Card at all —
    // if recording state leaked from `registered` (e.g. via a module-level
    // global), classRegistry/recorded-set contamination could produce a
    // false throw here even though this game's own flow queries nothing.
    const untouched = new CorrectlyRegisteredQueryGame(makeOptions());
    expect(() => untouched.startFlow()).not.toThrow();

    expect((registered as any)._ctx).not.toBe((untouched as any)._ctx);
    expect((registered as any)._ctx.classRegistry).not.toBe(
      (untouched as any)._ctx.classRegistry,
    );

    // A third game that DOES query the unregistered Ghost class must still
    // throw, proving the earlier clean games didn't poison a shared state
    // that would otherwise suppress this detection.
    const unregistered = new UnregisteredQueryGame(makeOptions());
    expect(() => unregistered.startFlow()).toThrowError(/Ghost/);
  });
});

describe('PIT-03', () => {
  beforeEach(() => {
    _clearShownWarnings();
  });

  it('throws naming the unregistered action referenced by an actionStep', () => {
    const game = new MissingActionGame(makeOptions());
    expect(() => game.startFlow()).toThrowError(/missing/);
    expect(() => new MissingActionGame(makeOptions()).startFlow()).toThrowError(/registerActions/);
  });

  it('emits a devWarn (not a throw) for a registered action referenced by no actionStep', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const game = new UnreachableActionGame(makeOptions());

    expect(() => game.startFlow()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unused'));

    warnSpy.mockRestore();
  });

  it('starts clean with no throw and no unreachable-action devWarn when correctly wired', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const game = new CorrectlyWiredGame(makeOptions());

    expect(() => game.startFlow()).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('does not throw when actionStep actions is a function (static-walk blind spot)', () => {
    const game = new FunctionValuedActionsGame(makeOptions());
    expect(() => game.startFlow()).not.toThrow();
  });
});

/**
 * Regression test for audit finding F10 (RST-01): `Space.onEnter`/`onExit`
 * handlers registered in a game's constructor must keep firing after ANY
 * snapshot restore. Today `_eventHandlers` is a private field holding live
 * closures, correctly excluded from serialization (closures cannot
 * serialize) — but `Game.loadSerializedState` discards the constructor-built
 * tree wholesale (`this._t.children = []`) and rebuilds fresh `Space`
 * instances via `GameElement.fromJSON`, which starts every rebuilt `Space`
 * with `_eventHandlers = { enter: [], exit: [] }`. Nothing re-invokes the
 * constructor logic that originally called `onEnter`/`onExit`, so the
 * handlers are silently dead after restore — a silent game-logic loss, not
 * merely a visibility/data bug.
 *
 * This test registers `onEnter`/`onExit` handlers in the game constructor
 * that increment counters, proves they fire on the live game, then restores
 * via `GameRunner.fromSnapshot` and proves the SAME handlers still fire when
 * a real enter/exit is triggered on the restored game (not merely inspecting
 * internal `_eventHandlers` state).
 */

import { describe, it, expect, vi } from 'vitest';
import { _clearShownWarnings } from '../../utils/dev.js';
import {
  Game,
  GameElement,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  type GameOptions,
} from '../index.js';
import { GameRunner } from '../../runtime/index.js';

// ---------------------------------------------------------------------------
// Minimal test game: two Spaces (source, dest) and a Token piece. `dest`
// registers onEnter/onExit handlers in the constructor that increment
// module-scoped-per-game counters (stored as plain Game attributes so they
// round-trip through JSON like any other game-level counter — the handler
// closures themselves are what we're testing, not the counters' persistence).
// A 'move' action moves the token from source to dest (triggering onEnter on
// dest / onExit on source... but source has no handlers, so we register both
// onEnter and onExit on the SAME `dest` space by moving the token in and
// then back out via a second action).
// ---------------------------------------------------------------------------

class Token extends Piece<HandlerGame> {}
class Source extends Space<HandlerGame> {}
class Dest extends Space<HandlerGame> {}

class HandlerGame extends Game<HandlerGame, Player> {
  source!: Source;
  dest!: Dest;
  enterCount = 0;
  exitCount = 0;

  constructor(options: GameOptions) {
    super(options);

    this.source = this.create(Source, 'source');
    this.dest = this.create(Dest, 'dest');
    this.source.create(Token, 'token');

    // Registered in the constructor, per the class docstring's modeled
    // pattern (Space's own JSDoc example uses this exact style).
    this.dest.onEnter(() => {
      this.enterCount++;
    }, Token);
    this.dest.onExit(() => {
      this.exitCount++;
    }, Token);

    this.registerAction(
      Action.create('moveIn').execute((_args, ctx) => {
        const game = ctx.game as HandlerGame;
        const token = game.source.first(Token);
        if (token) token.putInto(game.dest);
        return { success: true };
      })
    );
    this.registerAction(
      Action.create('moveOut').execute((_args, ctx) => {
        const game = ctx.game as HandlerGame;
        const token = game.dest.first(Token);
        if (token) token.putInto(game.source);
        return { success: true };
      })
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['moveIn', 'moveOut'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      })
    );
  }
}

function buildRunner(): GameRunner<HandlerGame> {
  const runner = new GameRunner<HandlerGame>({
    GameClass: HandlerGame,
    gameType: 'handler-restore-test',
    gameOptions: { playerCount: 1, seed: 'handler-restore-seed' },
  });
  runner.start();
  return runner;
}

/** Simulate a cold-storage round-trip (matches production storage adapters). */
function roundTripJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('RST-01/F10: onEnter/onExit handlers survive snapshot restore', () => {
  it('onEnter fires on the live (never-restored) game', () => {
    const runner = buildRunner();
    expect(runner.game.enterCount).toBe(0);

    const result = runner.performAction('moveIn', 1, {});
    expect(result.success).toBe(true);
    expect(runner.game.enterCount).toBe(1);
  });

  it('onExit fires on the live (never-restored) game', () => {
    const runner = buildRunner();
    runner.performAction('moveIn', 1, {});
    expect(runner.game.exitCount).toBe(0);

    const result = runner.performAction('moveOut', 1, {});
    expect(result.success).toBe(true);
    expect(runner.game.exitCount).toBe(1);
  });

  it('onEnter STILL fires after GameRunner.fromSnapshot', () => {
    const runner = buildRunner();

    const snapshot = roundTripJson(runner.getSnapshot());
    const restored = GameRunner.fromSnapshot<HandlerGame>(snapshot, HandlerGame);

    expect(restored.game.enterCount).toBe(0);
    const result = restored.performAction('moveIn', 1, {});
    expect(result.success).toBe(true);

    // Triggers a REAL enter (token moves into `dest`), not an inspection of
    // internal `_eventHandlers` state — if the handler was dropped on
    // restore, this counter never increments.
    expect(restored.game.enterCount).toBe(1);
  });

  it('onExit STILL fires after GameRunner.fromSnapshot', () => {
    const runner = buildRunner();
    runner.performAction('moveIn', 1, {});

    const snapshot = roundTripJson(runner.getSnapshot());
    const restored = GameRunner.fromSnapshot<HandlerGame>(snapshot, HandlerGame);

    expect(restored.game.exitCount).toBe(0);
    const result = restored.performAction('moveOut', 1, {});
    expect(result.success).toBe(true);

    expect(restored.game.exitCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// WR-02 (iteration 2): handler re-binding must NOT cross-wire same-class
// sibling Spaces when sibling indices shift. The constructor creates a Piece
// BEFORE two same-class Spaces, so the piece's departure (a normal in-game
// move) shifts both Spaces' `branch()` indices by one in the snapshot
// relative to the fresh constructor tree. Under the old
// `${className}:${branch()}` key, bucketB's restored key matched bucketA's
// CAPTURED handlers — bucketB silently received bucketA's onEnter while
// bucketA got none. The key is now class name + element name + Space-only
// index path, which is immune to piece movement.
// ---------------------------------------------------------------------------

class Bucket extends Space<CrossWireGame> {}
class Chip extends Piece<CrossWireGame> {}

class CrossWireGame extends Game<CrossWireGame, Player> {
  bucketA!: Bucket;
  bucketB!: Bucket;
  aEnterCount = 0;
  bEnterCount = 0;

  constructor(options: GameOptions) {
    super(options);

    // Piece FIRST so its departure shifts the Spaces' all-sibling indices.
    this.create(Chip, 'floater');
    this.bucketA = this.create(Bucket, 'bucketA');
    this.bucketB = this.create(Bucket, 'bucketB');

    this.bucketA.onEnter(() => {
      this.aEnterCount++;
    }, Chip);
    this.bucketB.onEnter(() => {
      this.bEnterCount++;
    }, Chip);

    this.registerAction(
      Action.create('intoA').execute((_args, ctx) => {
        const game = ctx.game as CrossWireGame;
        game.first(Chip)?.putInto(game.bucketA);
        return { success: true };
      })
    );
    this.registerAction(
      Action.create('aToB').execute((_args, ctx) => {
        const game = ctx.game as CrossWireGame;
        game.bucketA.first(Chip)?.putInto(game.bucketB);
        return { success: true };
      })
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['intoA', 'aToB'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      })
    );
  }
}

describe('WR-02: handler re-binding does not cross-wire same-class sibling Spaces after sibling indices shift', () => {
  it('each Space keeps ITS OWN handlers after a restore from a snapshot where a sibling piece has moved', () => {
    const runner = new GameRunner<CrossWireGame>({
      GameClass: CrossWireGame,
      gameType: 'handler-crosswire-test',
      gameOptions: { playerCount: 1, seed: 'crosswire-seed' },
    });
    runner.start();

    // Move the floater out of the top level: both buckets' all-sibling branch
    // indices shift down by one relative to the fresh constructor tree.
    expect(runner.performAction('intoA', 1, {}).success).toBe(true);
    expect(runner.game.aEnterCount).toBe(1);

    const snapshot = roundTripJson(runner.getSnapshot());
    const restored = GameRunner.fromSnapshot<CrossWireGame>(snapshot, CrossWireGame);

    const aBefore = restored.game.aEnterCount;
    const bBefore = restored.game.bEnterCount;

    // Entering bucketB must fire bucketB's handler — NOT bucketA's. Under the
    // old branch()-based key this incremented aEnterCount instead.
    expect(restored.performAction('aToB', 1, {}).success).toBe(true);
    expect(restored.game.bEnterCount).toBe(bBefore + 1);
    expect(restored.game.aEnterCount).toBe(aBefore);
  });
});

// ---------------------------------------------------------------------------
// WR-03 (iteration 2): a re-bound handler closure that lexically captured a
// constructor-LOCAL element points at the discarded pre-restore tree after a
// snapshot restore. The engine cannot fix the closure, but dev mode must
// warn LOUDLY when the handler moves an element into the detached tree
// (before this, the element silently vanished from the serialized game).
// ---------------------------------------------------------------------------

class Coin extends Piece<StaleRefGame> {}
class Inbox extends Space<StaleRefGame> {}
class Stash extends Space<StaleRefGame> {}

class StaleRefGame extends Game<StaleRefGame, Player> {
  inbox!: Inbox;

  constructor(options: GameOptions) {
    super(options);

    this.inbox = this.create(Inbox, 'inbox');
    // THE MISTAKE under test: a constructor local captured by the closure
    // (documented anti-pattern — see Space.onEnter JSDoc / pitfall 21).
    const stash = this.create(Stash, 'stash');
    this.inbox.onEnter((coin) => {
      coin.putInto(stash);
    }, Coin);

    this.create(Coin, 'coin');

    this.registerAction(
      Action.create('deliver').execute((_args, ctx) => {
        const game = ctx.game as StaleRefGame;
        game.first(Coin)?.putInto(game.inbox);
        return { success: true };
      })
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['deliver'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      })
    );
  }
}

describe('WR-03: dev warning when a restored handler moves an element into a detached tree', () => {
  function buildStaleRunner(): GameRunner<StaleRefGame> {
    const runner = new GameRunner<StaleRefGame>({
      GameClass: StaleRefGame,
      gameType: 'stale-ref-test',
      gameOptions: { playerCount: 1, seed: 'stale-ref-seed' },
    });
    runner.start();
    return runner;
  }

  it('does NOT warn on the live (never-restored) game — the captured local is still attached', () => {
    _clearShownWarnings();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const runner = buildStaleRunner();
    expect(runner.performAction('deliver', 1, {}).success).toBe(true);

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('detached'));
    warnSpy.mockRestore();
  });

  it('warns when the handler fires after a restore and putInto targets the discarded tree', () => {
    const runner = buildStaleRunner();
    const snapshot = roundTripJson(runner.getSnapshot());
    const restored = GameRunner.fromSnapshot<StaleRefGame>(snapshot, StaleRefGame);

    _clearShownWarnings();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(restored.performAction('deliver', 1, {}).success).toBe(true);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('detached'));
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// WR-05 (iteration 2): the WR-02 fix computed the identity path over Space
// siblings only, mapping every NON-Space ancestor (Player, Piece) to `-1` via
// `spaceSiblings.indexOf(el)`. Two same-class, same-name Spaces nested under
// DIFFERENT non-Space parents — the natural per-player pattern
// `player.create(Hand, 'hand')` — therefore produced identical keys
// (`Hand:hand:-1/0`), the capture map silently overwrote (last writer wins),
// and BOTH restored hands received the last-captured handler set: moving a
// card into player 1's hand fired player 2's onEnter. The key now
// discriminates non-Space ancestors by seat (Players) or class+name (other
// elements), and any residual collision devWarns and refuses to re-bind
// instead of silently cross-wiring.
// ---------------------------------------------------------------------------

class HandCard extends Piece<PerPlayerGame> {}
class Hand extends Space<PerPlayerGame> {}
class Deck extends Space<PerPlayerGame> {}

class PerPlayerGame extends Game<PerPlayerGame, Player> {
  deck!: Deck;
  p1Enter = 0;
  p2Enter = 0;

  constructor(options: GameOptions) {
    super(options);

    this.deck = this.create(Deck, 'deck');
    this.deck.create(HandCard, 'card1');
    this.deck.create(HandCard, 'card2');

    // Same class, same name, different non-Space (Player) parents — under
    // the pre-fix key both collapse to `Hand:hand:-1/0`.
    const h1 = this.getPlayer(1)!.create(Hand, 'hand');
    const h2 = this.getPlayer(2)!.create(Hand, 'hand');
    h1.onEnter(() => {
      this.p1Enter++;
    }, HandCard);
    h2.onEnter(() => {
      this.p2Enter++;
    }, HandCard);

    this.registerAction(
      Action.create('dealTo1').execute((_args, ctx) => {
        const game = ctx.game as PerPlayerGame;
        game.deck.first(HandCard)?.putInto(game.getPlayer(1)!.first(Hand)!);
        return { success: true };
      })
    );
    this.registerAction(
      Action.create('dealTo2').execute((_args, ctx) => {
        const game = ctx.game as PerPlayerGame;
        game.deck.first(HandCard)?.putInto(game.getPlayer(2)!.first(Hand)!);
        return { success: true };
      })
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['dealTo1', 'dealTo2'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      })
    );
  }
}

describe('WR-05: per-player same-name Spaces keep their OWN handlers after restore', () => {
  function buildPerPlayerRunner(): GameRunner<PerPlayerGame> {
    const runner = new GameRunner<PerPlayerGame>({
      GameClass: PerPlayerGame,
      gameType: 'per-player-hand-test',
      gameOptions: { playerCount: 2, seed: 'per-player-seed' },
    });
    runner.start();
    return runner;
  }

  it('sanity: each hand fires only its own handler on the live game', () => {
    const runner = buildPerPlayerRunner();
    expect(runner.performAction('dealTo1', 1, {}).success).toBe(true);
    expect(runner.game.p1Enter).toBe(1);
    expect(runner.game.p2Enter).toBe(0);
    expect(runner.performAction('dealTo2', 1, {}).success).toBe(true);
    expect(runner.game.p2Enter).toBe(1);
  });

  it("moving a card into player 1's hand after restore fires player 1's handler — not player 2's", () => {
    const runner = buildPerPlayerRunner();
    const snapshot = roundTripJson(runner.getSnapshot());
    const restored = GameRunner.fromSnapshot<PerPlayerGame>(snapshot, PerPlayerGame);

    expect(restored.performAction('dealTo1', 1, {}).success).toBe(true);
    // Pre-fix: p1Enter stayed 0 and p2Enter became 1 (player 2's handler,
    // the last-captured one, was wired to BOTH hands).
    expect(restored.game.p1Enter).toBe(1);
    expect(restored.game.p2Enter).toBe(0);
  });

  it("moving a card into player 2's hand after restore fires player 2's handler — not player 1's", () => {
    const runner = buildPerPlayerRunner();
    const snapshot = roundTripJson(runner.getSnapshot());
    const restored = GameRunner.fromSnapshot<PerPlayerGame>(snapshot, PerPlayerGame);

    expect(restored.performAction('dealTo2', 1, {}).success).toBe(true);
    expect(restored.game.p2Enter).toBe(1);
    expect(restored.game.p1Enter).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WR-05 guard: if two handler-bearing Spaces STILL produce the same identity
// key (same class, same name, indistinguishable ancestors), the restore must
// devWarn about the ambiguity and refuse to re-bind that key, never silently
// wire both Spaces to one handler set. Pieces cannot contain Spaces (engine
// invariant, piece.ts), so the ambiguous ancestors here are two same-class,
// same-NAME direct GameElement subclass instances.
// ---------------------------------------------------------------------------

class Gem extends Piece<AmbiguousGame> {}
class Box extends GameElement<AmbiguousGame> {}
class Slot extends Space<AmbiguousGame> {}

class AmbiguousGame extends Game<AmbiguousGame, Player> {
  slotEnter = 0;

  constructor(options: GameOptions) {
    super(options);

    // Two non-Space elements with the SAME class and SAME name, each holding
    // a same-named handler-bearing Space: no stable identity component can
    // tell the two slots apart, so their keys collide by construction.
    const boxA = this.create(Box, 'box');
    const boxB = this.create(Box, 'box');
    boxA.create(Slot, 'slot').onEnter(() => {
      this.slotEnter++;
    }, Gem);
    boxB.create(Slot, 'slot').onEnter(() => {
      this.slotEnter++;
    }, Gem);

    this.create(Gem, 'gem');

    this.registerAction(
      Action.create('stash').execute((_args, ctx) => {
        const game = ctx.game as AmbiguousGame;
        game.first(Gem)?.putInto(game.first(Box)!.first(Slot)!);
        return { success: true };
      })
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['stash'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      })
    );
  }
}

describe('handler re-bind: same-name Spaces are disambiguated by stable id (F-03)', () => {
  it('re-binds BOTH same-name slots correctly with no ambiguity warning', () => {
    // F-03 (v4.8): handler re-binding now keys on the Space's stable element id
    // instead of tree position. Two same-class/same-name slots under two
    // same-class/same-name boxes -- which the old positional key could not tell
    // apart (it dropped both handlers) -- have DISTINCT ids, so both handlers
    // survive restore and fire on their own slot. No ambiguity is possible.
    const runner = new GameRunner<AmbiguousGame>({
      GameClass: AmbiguousGame,
      gameType: 'ambiguous-key-test',
      gameOptions: { playerCount: 1, seed: 'ambiguous-seed' },
    });
    runner.start();

    const snapshot = roundTripJson(runner.getSnapshot());

    _clearShownWarnings();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restored = GameRunner.fromSnapshot<AmbiguousGame>(snapshot, AmbiguousGame);

    // No ambiguity is reported — ids are unique.
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('ambiguous'));
    warnSpy.mockRestore();

    // The first box's slot fired its own onEnter after restore.
    expect(restored.performAction('stash', 1, {}).success).toBe(true);
    expect(restored.game.slotEnter).toBe(1);
  });
});

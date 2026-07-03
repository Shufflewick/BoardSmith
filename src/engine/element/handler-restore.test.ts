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

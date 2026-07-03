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

import { describe, it, expect } from 'vitest';
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

/**
 * Regression test for audit findings F1/F7 (SEC-01): `Space._zoneVisibility`
 * must survive EVERY snapshot restore path. Today it is listed in
 * `Space.unserializableAttributes` with no compensating `toJSON`/`fromJSON`
 * override, so `loadSerializedState` (reached by every restore path) rebuilds
 * every `Space` with `_zoneVisibility === undefined` — hidden hands/decks
 * silently become fully visible to every viewer after any undo, rewind, cold
 * restore, or dev-host broadcast.
 *
 * IMPORTANT (why this uses a plain `Space`, not `Deck`/`Hand`): `Deck` and
 * `Hand` set their own zone-visibility default in THEIR OWN constructors
 * (F32 secure-by-default: Deck defaults to 'hidden', Hand to 'owner'). Since
 * `GameElement.fromJSON`'s restore path does `new ElementClass(ctx)`, a
 * restored `Deck`/`Hand` re-runs ITS OWN constructor and incidentally
 * re-applies that class default — masking the F1/F7 bug for the exact case
 * where a designer never diverges from the built-in default. The real bug
 * (constructor-applied config lost on restore) only shows up when the zone
 * visibility set at runtime differs from a fresh instance's default — e.g. a
 * plain `Space` (no built-in default; effectively visible to all) that calls
 * `contentsHidden()`, or a `Deck` that opts OUT of its hidden default via
 * `contentsVisible()`. Every case below is deliberately constructed to
 * diverge from the restored class's own default so the assertions are not
 * accidentally masked.
 *
 * Byte-identity contract: for every restore path below,
 * `JSON.stringify(game.toJSONForPlayer(opponentSeat))` before the restore
 * must strictly equal the same call after the restore. One dedicated `it()`
 * per path — see the D-SEC-01 coverage contract in the plan. The
 * `GameSession.restore()` case lives in the companion file
 * `src/session/restore-snapshot-authoritative.test.ts` (session-layer
 * concern per the CONTEXT.md test-placement decision).
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
import { StateHistory } from '../../session/state-history.js';
import { executeOp, type GameDefinitionLike } from '../../session/stateless-ops.js';
import type { StoredGameState } from '../../session/types.js';

// ---------------------------------------------------------------------------
// Minimal test game: a plain Space whose contents are explicitly hidden via
// `contentsHidden()` (diverging from Space's undefined/all-visible default —
// see file header). Actions toggle visibility mid-game so the runtime-
// visibility-change case can be exercised. Two seats: seat 1 acts, seat 2 is
// the "opponent" whose view we assert byte-identity for.
// ---------------------------------------------------------------------------

class Card extends Piece<ZoneVisGame> {
  suit!: string;
}

class SecretZone extends Space<ZoneVisGame> {}

class ZoneVisGame extends Game<ZoneVisGame, Player> {
  secretZone!: SecretZone;

  constructor(options: GameOptions) {
    super(options);

    this.secretZone = this.create(SecretZone, 'secret-zone');
    this.secretZone.contentsHidden();
    this.secretZone.createMany(3, Card, 'card', (i) => ({ suit: ['H', 'S', 'D'][i] }));

    this.registerAction(Action.create('noop').execute(() => ({ success: true })));
    this.registerAction(
      Action.create('reveal').execute((_args, ctx) => {
        (ctx.game as ZoneVisGame).secretZone.contentsVisible();
        return { success: true };
      })
    );
    this.registerAction(
      Action.create('rehide').execute((_args, ctx) => {
        (ctx.game as ZoneVisGame).secretZone.contentsHidden();
        return { success: true };
      })
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['noop', 'reveal', 'rehide'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      })
    );
  }
}

const OPPONENT_SEAT = 2;

function buildRunner(): GameRunner<ZoneVisGame> {
  const runner = new GameRunner<ZoneVisGame>({
    GameClass: ZoneVisGame,
    gameType: 'zone-vis-test',
    gameOptions: { playerCount: 2, seed: 'zone-vis-seed' },
  });
  runner.start();
  return runner;
}

/** JSON.stringify of the opponent's per-player view — the byte-identity probe. */
function opponentView(runner: GameRunner<ZoneVisGame>): string {
  return JSON.stringify(runner.game.toJSONForPlayer(OPPONENT_SEAT));
}

/** Simulate a cold-storage round-trip (matches production storage adapters). */
function roundTripJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('SEC-01/F1/F7: zone visibility survives restore (byte-identity of opponent view)', () => {
  it('a hidden Space reports __hidden contents to the opponent before any restore', () => {
    const runner = buildRunner();
    const view = runner.game.toJSONForPlayer(OPPONENT_SEAT);
    const zoneJson = view.children?.find((c) => c.name === 'secret-zone');
    const cards = zoneJson?.children ?? [];
    expect(cards.length).toBe(3);
    for (const card of cards) {
      expect(card.attributes.__hidden).toBe(true);
      expect(card.attributes.suit).toBeUndefined();
    }
  });

  it('(a) survives GameRunner.fromSnapshot', () => {
    const runner = buildRunner();
    const before = opponentView(runner);

    const snapshot = roundTripJson(runner.getSnapshot());
    const restored = GameRunner.fromSnapshot<ZoneVisGame>(snapshot, ZoneVisGame);

    expect(opponentView(restored)).toBe(before);
  });

  it('(b) survives undo via StateHistory', async () => {
    const runner = buildRunner();
    const before = opponentView(runner);

    // Give seat 1 something to undo — turn-start checkpoint (index 0) still
    // has the hidden zone from the constructor, matching `before`.
    const actionResult = runner.performAction('noop', 1, {});
    expect(actionResult.success).toBe(true);

    let currentRunner = runner;
    const storedState = {
      actionHistory: currentRunner.actionHistory,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
    } as unknown as StoredGameState;

    const history = new StateHistory<ZoneVisGame>(ZoneVisGame, storedState, () => currentRunner, {
      replaceRunner: (r) => {
        currentRunner = r;
      },
      save: async () => {},
      broadcast: () => {},
    });

    const undoResult = await history.undoToTurnStart(1);
    expect(undoResult.success).toBe(true);

    expect(opponentView(currentRunner)).toBe(before);
  });

  it('(c) survives rewind / time-travel via StateHistory.getStateAtAction', async () => {
    const runner = buildRunner();
    const before = opponentView(runner);

    const actionResult = runner.performAction('noop', 1, {});
    expect(actionResult.success).toBe(true);

    const storedState = {
      actionHistory: runner.actionHistory,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
    } as unknown as StoredGameState;

    const history = new StateHistory<ZoneVisGame>(ZoneVisGame, storedState, () => runner, {
      replaceRunner: () => {},
      save: async () => {},
      broadcast: () => {},
    });

    // Action index 0 = turn-start checkpoint, before the 'noop' action.
    const result = history.getStateAtAction(0, OPPONENT_SEAT);
    expect(result.success).toBe(true);

    expect(JSON.stringify(result.state!.view)).toBe(before);
  });

  it('(d) [companion assertion — see src/session/restore-snapshot-authoritative.test.ts for GameSession.restore()]', () => {
    // Intentionally empty placeholder documenting where case (d) lives, per
    // the plan's test-placement rule: it MUST exist in exactly one file and
    // is asserted in the session-layer companion suite, not duplicated here.
    expect(true).toBe(true);
  });

  it('(e) survives the stateless-ops path (playerViews built after GameRunner.fromSnapshot)', async () => {
    const def: GameDefinitionLike = {
      gameClass: ZoneVisGame as unknown as GameDefinitionLike['gameClass'],
      gameType: 'zone-vis-test',
      minPlayers: 2,
      maxPlayers: 2,
    };

    const startResult = await executeOp(
      def,
      { playerCount: 2, seed: 'zone-vis-seed' },
      null,
      null,
      { type: 'start' }
    );
    expect(startResult.success).toBe(true);
    const startPlayerViews = (startResult as unknown as { playerViews: Array<{ state: { view: unknown } }> })
      .playerViews;
    const before = JSON.stringify(startPlayerViews[OPPONENT_SEAT - 1].state.view);

    // Force a restore (GameRunner.fromSnapshot) by driving an unrelated action
    // through the snapshot-in/snapshot-out stateless op executor.
    const actionResult = await executeOp(
      def,
      { playerCount: 2, seed: 'zone-vis-seed' },
      startResult.snapshot,
      null,
      { type: 'action', actionName: 'noop', player: 1, args: {} }
    );
    expect(actionResult.success).toBe(true);
    const afterPlayerViews = (actionResult as unknown as { playerViews: Array<{ state: { view: unknown } }> })
      .playerViews;
    const after = JSON.stringify(afterPlayerViews[OPPONENT_SEAT - 1].state.view);

    expect(after).toBe(before);
  });

  it('a zone re-hidden after being shown mid-game also survives GameRunner.fromSnapshot', () => {
    const runner = buildRunner();

    // Reveal, then re-hide — the runtime-mutated state (not the constructor
    // default) is what must round-trip.
    const revealResult = runner.performAction('reveal', 1, {});
    expect(revealResult.success).toBe(true);
    const revealedView = opponentView(runner);
    expect(revealedView).not.toContain('__hidden');

    const rehideResult = runner.performAction('rehide', 1, {});
    expect(rehideResult.success).toBe(true);
    const before = opponentView(runner);
    expect(before).toContain('__hidden');

    const snapshot = roundTripJson(runner.getSnapshot());
    const restored = GameRunner.fromSnapshot<ZoneVisGame>(snapshot, ZoneVisGame);

    expect(opponentView(restored)).toBe(before);
  });
});

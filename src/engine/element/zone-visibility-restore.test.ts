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
 * per path — see the D-SEC-01 coverage contract in the plan. The undo,
 * time-travel and cold-restore cases drive the session host every platform
 * runs, and compare the opponent's published view.
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  actionStep,
  type GameOptions,
} from '../index.js';
import { GameRunner } from '../../runtime/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/stateless-ops.js';
import { createHeadlessSession } from '../../session/headless-session.js';
import { SnapshotSessionHost, type SnapshotHostState } from '../../session/snapshot-session-host.js';
import { boundaryKeyOf, boundaryKeyOfHost } from '../../session/testing/boundary-stamp.js';
import { succeeded } from '../../session/op-result.test-helper.js';

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
      {
        root: actionStep({
          actions: ['noop', 'reveal', 'rehide'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      }
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

const zoneVisDefinition: GameDefinitionLike = {
  gameClass: ZoneVisGame,
  gameType: 'zone-vis-test',
  minPlayers: 2,
  maxPlayers: 2,
};

const zoneVisOptions = { playerCount: 2, seed: 'zone-vis-seed' };

/** A started table on the in-process session host, and the opponent's first published view. */
async function startZoneVisSession() {
  const session = createHeadlessSession(zoneVisDefinition, zoneVisOptions);
  await session.start();
  return { session, before: JSON.stringify(session.playerState(OPPONENT_SEAT).view) };
}

/** Simulate a cold-storage round-trip (matches production storage adapters). */
function roundTripJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('SEC-01/F1/F7: zone visibility survives restore (byte-identity of opponent view)', () => {
  it('a hidden Space reports neither childCount nor children to the opponent before any restore (SPACE-03/D24)', () => {
    const runner = buildRunner();
    const view = runner.game.toJSONForPlayer(OPPONENT_SEAT);
    const zoneJson = view.children?.find((c) => c.name === 'secret-zone');
    expect(zoneJson).toBeDefined();
    expect('childCount' in zoneJson!).toBe(false);
    expect('children' in zoneJson!).toBe(false);
  });

  it('(a) survives GameRunner.fromSnapshot', () => {
    const runner = buildRunner();
    const before = opponentView(runner);

    const snapshot = roundTripJson(runner.getSnapshot());
    const restored = GameRunner.fromSnapshot<ZoneVisGame>(snapshot, ZoneVisGame);

    expect(opponentView(restored)).toBe(before);
  });

  it('(b) survives undo', async () => {
    const { session, before } = await startZoneVisSession();

    // Give seat 1 something to undo — the turn-start checkpoint still has the
    // hidden zone from the constructor, matching `before`.
    const actionResult = await session.send(1, { type: 'action', actionName: 'noop', player: 1, args: {} });
    expect(actionResult.success).toBe(true);

    const undoResult = await session.send(1, { type: 'undo', player: 1 });
    expect(undoResult.success).toBe(true);

    expect(JSON.stringify(session.playerState(OPPONENT_SEAT).view)).toBe(before);
  });

  it('(c) survives rewind / time-travel via debugStateAt', async () => {
    const { session, before } = await startZoneVisSession();

    const actionResult = await session.send(1, { type: 'action', actionName: 'noop', player: 1, args: {} });
    expect(actionResult.success).toBe(true);

    // Action index 0 = turn-start checkpoint, before the 'noop' action.
    const result = succeeded(
      await session.send(OPPONENT_SEAT, { type: 'debugStateAt', actionIndex: 0, player: OPPONENT_SEAT }),
    );

    expect(JSON.stringify((result.historicalState as { view: unknown }).view)).toBe(before);
  });

  it('(d) survives a cold restore of the session host from its durable state', async () => {
    const { session, before } = await startZoneVisSession();
    const actionResult = await session.send(1, { type: 'action', actionName: 'noop', player: 1, args: {} });
    expect(actionResult.success).toBe(true);

    // What storage hands back after the process died: the durable state, as JSON.
    const stored = roundTripJson(session.host.durableState()) as SnapshotHostState;
    const published: unknown[][] = [];
    const restored = SnapshotSessionHost.restore(
      {
        playerCount: zoneVisOptions.playerCount,
        executeOp: (snap, pend, op) => executeOp(zoneVisDefinition, zoneVisOptions, snap, pend, op),
        record: ({ players }) => published.push(players),
        push: () => {},
      },
      { ...stored, botSeats: [] },
    );

    // The restored host builds its next views from the stored snapshot.
    const next = await restored.handleOp(1, {
      type: 'action', actionName: 'noop', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(restored),
    });
    expect(next.success).toBe(true);

    const restoredView = (published.at(-1)![OPPONENT_SEAT - 1] as { state: { view: unknown } }).state.view;
    expect(JSON.stringify(restoredView)).toBe(before);
  });

  it('(e) survives the stateless-ops path (playerViews built after GameRunner.fromSnapshot)', async () => {
    const def = zoneVisDefinition;

    const startResult = succeeded(await executeOp(
      def,
      { playerCount: 2, seed: 'zone-vis-seed' },
      null,
      null,
      { type: 'start' }
    ));
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
      { type: 'action', actionName: 'noop', player: 1, args: {}, boundaryKey: boundaryKeyOf(startResult.snapshot) }
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
    const revealedZone = runner.game
      .toJSONForPlayer(OPPONENT_SEAT)
      .children?.find((c) => c.name === 'secret-zone');
    expect(revealedZone).toBeDefined();
    expect((revealedZone!.children ?? []).length).toBe(3);
    expect((revealedZone!.children ?? []).every((c: any) => c.attributes.suit !== undefined)).toBe(true);

    const rehideResult = runner.performAction('rehide', 1, {});
    expect(rehideResult.success).toBe(true);
    const before = opponentView(runner);
    const beforeZone = runner.game
      .toJSONForPlayer(OPPONENT_SEAT)
      .children?.find((c) => c.name === 'secret-zone');
    expect(beforeZone).toBeDefined();
    // SPACE-03/D24: re-hiding must go back to true concealment — no
    // childCount, no children — not just re-appear as anonymized placeholders.
    expect('childCount' in beforeZone!).toBe(false);
    expect('children' in beforeZone!).toBe(false);

    const snapshot = roundTripJson(runner.getSnapshot());
    const restored = GameRunner.fromSnapshot<ZoneVisGame>(snapshot, ZoneVisGame);

    expect(opponentView(restored)).toBe(before);
  });
});

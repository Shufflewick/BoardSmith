import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { GameSession } from '../game-session.js';
import type { Op, GameDefinitionLike } from '../stateless-ops.js';
import type { StorageAdapter, StoredGameState } from '../types.js';
import {
  Game,
  Player,
  Action,
  defineFlow,
  sequence,
  actionStep,
  execute,
  loop,
  type GameOptions,
} from '../../engine/index.js';

/**
 * UNDO-04 regression: the animation-event id sequence must never move
 * backwards across an undo or debug-rewind, because the client's monotonic
 * watermark (`e.id > lastQueuedId`, `useAnimationEvents.ts:381`) silently
 * drops any replayed beat whose id it has already seen.
 *
 * This test asserts on BEATS DELIVERED through that exact client-side filter
 * -- not on raw `_animationEventSeq` values -- because that is how the
 * defect actually presents to a designer: "undo eats my animations", not as
 * an id-counter bug.
 */

// ── Fixture ───────────────────────────────────────────────────────────────
// Mirrors collect-turns-fixture.ts's turn shape (two actions per turn, then
// rotate) -- the minimal structure that makes undo/rewind reachable while
// still current-player -- but its only action pushes an animation event, so
// this is a purpose-built local fixture rather than a shared one nobody else
// would use.

class TickGame extends Game<TickGame, Player> {
  activeSeat = 1;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('tick').execute((_args, ctx) => {
        ctx.game.animate('tick', { seat: ctx.player.seat });
        return { success: true };
      }),
    );

    const activePlayer = (ctx: { game: Game }) =>
      ctx.game.getPlayer((ctx.game as TickGame).activeSeat)!;

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: sequence(
            actionStep({ actions: ['tick'], player: activePlayer }),
            actionStep({ actions: ['tick'], player: activePlayer }),
            execute((ctx) => {
              const game = ctx.game as TickGame;
              game.activeSeat = game.activeSeat >= game.players.length ? 1 : game.activeSeat + 1;
            }),
          ),
        }),
      }),
    );
  }
}

const tickFixtureDefinition: GameDefinitionLike = {
  gameClass: TickGame as new (...args: unknown[]) => unknown,
  gameType: 'tick-watermark',
  minPlayers: 2,
  maxPlayers: 2,
};

const gameOptions = { playerCount: 2, seed: 'watermark' };

// ── Client-side watermark, mirroring useAnimationEvents.ts:381,389 EXACTLY ─

type ClientWatermark = { lastQueuedId: number };

/** Filter to `id > lastQueuedId`, then advance the watermark by the NEW
 *  events only (same shape as the real composable's `watch` handler).
 *  Returns the ids the client actually delivers (queues) for this batch. */
function clientDeliver(
  watermark: ClientWatermark,
  events: Array<{ id: number }> | undefined,
): number[] {
  if (!events || events.length === 0) return [];
  const newEvents = events.filter((e) => e.id > watermark.lastQueuedId);
  if (newEvents.length === 0) return [];
  watermark.lastQueuedId = Math.max(watermark.lastQueuedId, ...newEvents.map((e) => e.id));
  return newEvents.map((e) => e.id);
}

function animationEventsFor(
  result: { playerViews?: unknown[] },
  seat: number,
): Array<{ id: number }> | undefined {
  const view = (
    result.playerViews as Array<{ state?: { animationEvents?: Array<{ id: number }> } }> | undefined
  )?.[seat - 1];
  return view?.state?.animationEvents;
}

describe('UNDO-04: animation-event watermark survives undo/rewind', () => {
  it('every beat after an undo is delivered under the real client watermark, with strictly increasing ids', async () => {
    const session = createHeadlessSession(tickFixtureDefinition, gameOptions);
    await session.start();

    const watermark: ClientWatermark = { lastQueuedId: 0 };
    const deliveredIds: number[] = [];
    const record = (result: { playerViews?: unknown[] }, seat: number) => {
      deliveredIds.push(...clientDeliver(watermark, animationEventsFor(result, seat)));
    };

    // Turn 1 -- player 1: two ticks (ids 1, 2).
    record(await session.send(1, { type: 'action', actionName: 'tick', player: 1, args: {} } as Op), 1);
    record(await session.send(1, { type: 'action', actionName: 'tick', player: 1, args: {} } as Op), 1);
    // Turn 2 -- player 2: two ticks (ids 3, 4).
    record(await session.send(2, { type: 'action', actionName: 'tick', player: 2, args: {} } as Op), 2);
    record(await session.send(2, { type: 'action', actionName: 'tick', player: 2, args: {} } as Op), 2);
    // Turn 3 -- player 1: first tick (id 5), then undo it.
    const turn3tick1 = await session.send(1, { type: 'action', actionName: 'tick', player: 1, args: {} } as Op);
    expect(turn3tick1.success).toBe(true);
    record(turn3tick1, 1);

    expect(deliveredIds).toEqual([1, 2, 3, 4, 5]);

    const undo = await session.send(1, { type: 'undo', player: 1 });
    expect(undo.success).toBe(true);
    // The restored checkpoint's buffered events, if re-broadcast, must be
    // re-stamped above the watermark or they would be silently dropped here.
    record(undo, 1);

    // Player 1 acts again after the undo -- the very beat a designer would
    // watch for on-screen and see missing.
    const afterUndo = await session.send(1, { type: 'action', actionName: 'tick', player: 1, args: {} } as Op);
    expect(afterUndo.success).toBe(true);
    record(afterUndo, 1);

    // Every id delivered across the whole run must be strictly increasing --
    // the monotonic client dedupe never drops a post-undo beat.
    for (let i = 1; i < deliveredIds.length; i++) {
      expect(deliveredIds[i]).toBeGreaterThan(deliveredIds[i - 1]);
    }
    // The post-undo tick's beat specifically must have been delivered.
    expect(deliveredIds.length).toBeGreaterThan(5);
  });

  it('every beat after a debug-rewind is delivered under the real client watermark, with strictly increasing ids', async () => {
    const session = createHeadlessSession(tickFixtureDefinition, gameOptions);
    await session.start();

    const watermark: ClientWatermark = { lastQueuedId: 0 };
    const deliveredIds: number[] = [];
    const record = (result: { playerViews?: unknown[] }, seat: number) => {
      deliveredIds.push(...clientDeliver(watermark, animationEventsFor(result, seat)));
    };

    // Turn 1 -- player 1: two ticks (ids 1, 2).
    record(await session.send(1, { type: 'action', actionName: 'tick', player: 1, args: {} } as Op), 1);
    record(await session.send(1, { type: 'action', actionName: 'tick', player: 1, args: {} } as Op), 1);
    // Turn 2 -- player 2: two ticks (ids 3, 4).
    record(await session.send(2, { type: 'action', actionName: 'tick', player: 2, args: {} } as Op), 2);
    record(await session.send(2, { type: 'action', actionName: 'tick', player: 2, args: {} } as Op), 2);

    expect(deliveredIds).toEqual([1, 2, 3, 4]);

    // Debug-rewind to action index 2 -- the checkpoint captured right after
    // player 1's second tick, i.e. the start of player 2's turn.
    const rewind = await session.send(1, { type: 'debugRewind', actionIndex: 2 } as Op);
    expect(rewind.success).toBe(true);
    record(rewind, 2);

    const afterRewind = await session.send(2, { type: 'action', actionName: 'tick', player: 2, args: {} } as Op);
    expect(afterRewind.success).toBe(true);
    record(afterRewind, 2);

    for (let i = 1; i < deliveredIds.length; i++) {
      expect(deliveredIds[i]).toBeGreaterThan(deliveredIds[i - 1]);
    }
    // The post-rewind tick's beat specifically must have been delivered.
    expect(deliveredIds.length).toBeGreaterThan(4);
  });
});

/** In-memory storage, matching restore-snapshot-authoritative.test.ts's
 *  JsonRoundTripStorage: `GameSession.#save()` only populates
 *  `storedState.snapshot` when a storage adapter is present. */
class InMemoryStorage implements StorageAdapter {
  saved: string | null = null;
  async save(state: StoredGameState): Promise<void> {
    this.saved = JSON.stringify(state);
  }
  async load(): Promise<StoredGameState | null> {
    return this.saved ? (JSON.parse(this.saved) as StoredGameState) : null;
  }
}

describe('UNDO-04: full session restore is unaffected (the two loadSerializedState callers stay distinguished)', () => {
  it('GameSession.restore (server restart) still ADOPTS the persisted animation-event seq unchanged', async () => {
    // GameSession.create -> performAction ticks -> GameSession.restore is the
    // EXACT production path (game-session.ts:865 calls
    // `GameRunner.fromSnapshot<G>(storedState.snapshot, GameClass)` with NO
    // animationSeqFloor option). This is the guard against over-applying the
    // fix: a full restore must keep adopting the persisted seq verbatim, not
    // be floored against anything, because there is no "live" counter running
    // across a cold restart to protect.
    const session = GameSession.create<TickGame>({
      gameType: 'tick-watermark',
      GameClass: TickGame,
      playerCount: 2,
      playerNames: ['A', 'B'],
      seed: 'restore-seed',
      storage: new InMemoryStorage(),
    });

    expect((await session.performAction('tick', 1, {})).success).toBe(true);
    expect((await session.performAction('tick', 1, {})).success).toBe(true);
    expect((await session.performAction('tick', 2, {})).success).toBe(true);

    const liveSeq = (session.runner.getSnapshot().state as { animationEventSeq?: number }).animationEventSeq;
    expect(liveSeq).toBe(3);

    // Simulate a cold restart: persist -> reload the stored state JSON, exactly
    // as restore-snapshot-authoritative.test.ts's JsonRoundTripStorage does.
    const storedState = JSON.parse(JSON.stringify(session.storedState));
    const restored = GameSession.restore<TickGame>(storedState, TickGame);

    const restoredSeq = (
      restored.runner.getSnapshot().state as { animationEventSeq?: number }
    ).animationEventSeq;
    expect(restoredSeq).toBe(liveSeq);

    // The next beat minted after restore continues the ADOPTED seq, not a
    // floor derived from anything -- there is no floor on this path at all.
    expect((await restored.performAction('tick', 2, {})).success).toBe(true);
    const nextSeq = (
      restored.runner.getSnapshot().state as { animationEventSeq?: number }
    ).animationEventSeq;
    expect(nextSeq).toBe(4);
  });

  it('adversarial: repeated undo -> act -> undo -> act cycles never produce a non-increasing delivered id', async () => {
    const session = createHeadlessSession(tickFixtureDefinition, { playerCount: 2, seed: 'adversarial' });
    await session.start();

    const watermark: ClientWatermark = { lastQueuedId: 0 };
    const deliveredIds: number[] = [];
    const record = (result: { playerViews?: unknown[] }, seat: number) => {
      deliveredIds.push(...clientDeliver(watermark, animationEventsFor(result, seat)));
    };

    // Actively try to drive the sequence backwards: undo -> act -> undo -> act,
    // repeated several times in a row, entirely within player 1's opening turn
    // (tick, undo, tick, undo, tick, ... -- always the first action of the
    // turn, so undo stays offered every time).
    for (let i = 0; i < 5; i++) {
      const tick = await session.send(1, { type: 'action', actionName: 'tick', player: 1, args: {} } as Op);
      expect(tick.success).toBe(true);
      record(tick, 1);

      const undo = await session.send(1, { type: 'undo', player: 1 });
      expect(undo.success).toBe(true);
      record(undo, 1);
    }
    // Final act after the last undo, so the run ends on a delivered beat.
    const final = await session.send(1, { type: 'action', actionName: 'tick', player: 1, args: {} } as Op);
    expect(final.success).toBe(true);
    record(final, 1);

    expect(deliveredIds.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < deliveredIds.length; i++) {
      expect(deliveredIds[i]).toBeGreaterThan(deliveredIds[i - 1]);
    }
  });

  it('adversarial: a direct rewindToAction() call (bypassing the op layer) also preserves monotonicity', async () => {
    const session = GameSession.create<TickGame>({
      gameType: 'tick-watermark',
      GameClass: TickGame,
      playerCount: 2,
      playerNames: ['A', 'B'],
      seed: 'rewind-direct',
    });

    const watermark: ClientWatermark = { lastQueuedId: 0 };
    const deliveredIds: number[] = [];
    const recordState = (state: { animationEvents?: Array<{ id: number }> } | undefined) => {
      deliveredIds.push(...clientDeliver(watermark, state?.animationEvents));
    };

    // Each performAction leaves its beats in the live game's buffer -- read
    // straight off it, exactly like buildPlayerState/utils.ts:323 do.
    const liveBeats = () => session.runner.game.pendingAnimationEvents;

    const t1 = await session.performAction('tick', 1, {}); // action 0 -> id 1
    expect(t1.success).toBe(true);
    recordState({ animationEvents: liveBeats() });

    const t2 = await session.performAction('tick', 1, {}); // action 1 -> id 2
    expect(t2.success).toBe(true);
    recordState({ animationEvents: liveBeats() });

    const t3 = await session.performAction('tick', 2, {}); // action 2 -> id 3
    expect(t3.success).toBe(true);
    recordState({ animationEvents: liveBeats() });

    // Bypass the op layer entirely: call StateHistory.rewindToAction directly
    // via GameSession's delegating method, targeting action index 1 (right
    // after the first tick).
    const rewind = await session.rewindToAction(1);
    expect(rewind.success).toBe(true);
    recordState(rewind.state);

    // Act again after the direct rewind -- the beat that must not collide.
    const afterRewindTick = await session.performAction('tick', 1, {});
    expect(afterRewindTick.success).toBe(true);
    recordState({ animationEvents: liveBeats() });

    for (let i = 1; i < deliveredIds.length; i++) {
      expect(deliveredIds[i]).toBeGreaterThan(deliveredIds[i - 1]);
    }
    expect(deliveredIds.length).toBeGreaterThan(0);
  });
});

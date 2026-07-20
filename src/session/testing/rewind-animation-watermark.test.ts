import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import type { Op, GameDefinitionLike } from '../stateless-ops.js';
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

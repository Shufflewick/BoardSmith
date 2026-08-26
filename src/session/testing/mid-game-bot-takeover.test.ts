import { describe, it, expect, vi } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import {
  simultaneousRoundsFixtureDefinition,
  TOTAL_ROUNDS,
} from './fixtures/simultaneous-rounds-fixture.js';
import { SnapshotSessionHost, type SnapshotSessionAdapters } from '../snapshot-session-host.js';
import type { Op, OpResult } from '../stateless-ops.js';

/**
 * BSMITH-03 — a seat converted to bot MID-GAME is actually played by a bot.
 *
 * The mechanism was never the gap. `handleBotTurn` takes its seat list as a
 * per-call argument and `runBotTurnsInner` re-reads `adapters.botSeats` on every
 * iteration, so a roster that changes mid-game has always been honoured. What
 * did not exist was (a) any engine-side ACKNOWLEDGEMENT of the conversion —
 * without which the engine's own harness froze `botSeats` at construction and a
 * mid-game conversion was not even expressible — and (b) a SELF-WAKE, since the
 * pump only ever ran when some other op drove it.
 *
 * Every assertion below is on a bot MOVING: the boundary the engine itself
 * publishes, and the action history the engine itself records. Never on a flag.
 */

const twoSeats = { playerCount: 2, seed: 'takeover' };

type Session = ReturnType<typeof createHeadlessSession>;

const lastBoundary = (session: Session) => session.metas.at(-1)!.turnBoundary;

/** Seat `seat` commits in the open simultaneous round. */
const commit = (session: Session, seat: number) =>
  session.send(seat, { type: 'action', actionName: 'commit', player: seat, args: {} });

/** The engine's own record of who acted, in order. */
async function actionHistory(session: Session): Promise<Array<{ name: string; player: number }>> {
  const res = await session.send(1, { type: 'debugHistory' });
  return (res.actionHistory as Array<{ name: string; player: number }>).map((a) => ({
    name: a.name,
    player: a.player,
  }));
}

describe('mid-game bot takeover (BSMITH-03)', () => {
  // ── 1. The bot MOVES ───────────────────────────────────────────────────────

  it('case 1 — a seat converted mid-game is played by a bot, with no further human input', async () => {
    const session = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats);
    await session.start();
    expect(lastBoundary(session).dueSeats).toEqual([1, 2]);

    // One real human move, so the conversion genuinely happens MID-game.
    await commit(session, 1);
    const before = lastBoundary(session);
    expect(before.dueSeats).toEqual([2]);
    expect(await actionHistory(session)).toEqual([{ name: 'commit', player: 1 }]);

    // The roster is the adapter's half of the conversion (the platform's
    // `mindSeats`); the op is the engine's half.
    session.makeSeatBot(2);
    const res = await session.send(2, { type: 'convertSeatToBot', seat: 2 });

    expect(res.success, `convertSeatToBot failed: ${res.error ?? ''}`).toBe(true);
    // The engine ACKNOWLEDGES the conversion by naming the seat back.
    expect(res.convertedSeat).toBe(2);

    // …and with NOTHING else sent, the bot has moved: the round the human was
    // waiting on has closed and a new one opened.
    const after = lastBoundary(session);
    expect(after.key).not.toBe(before.key);
    // Round 2 is open and seat 2 has ALREADY answered it — the pump kept going
    // for as long as the converted seat owed a move. Only seat 1 is left.
    expect(after.dueSeats).toEqual([1]);

    // The proof of record: seat 2's moves are in the engine's action history.
    expect(await actionHistory(session)).toEqual([
      { name: 'commit', player: 1 },
      { name: 'commit', player: 2 },
      { name: 'commit', player: 2 },
    ]);
  });

  // ── 2. The conversion is the wake ──────────────────────────────────────────

  it('case 2 — the conversion op ALONE drives the pump; flipping the roster without it parks the table', async () => {
    const session = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats);
    await session.start();
    await commit(session, 1);
    const parked = lastBoundary(session);
    expect(parked.dueSeats).toEqual([2]);

    // The counterfactual, and the reason the op has to exist: the roster now
    // reports seat 2 as bot and the pump would honour it — but nothing wakes it.
    session.makeSeatBot(2);
    expect(lastBoundary(session)).toEqual(parked);
    expect(await actionHistory(session)).toEqual([{ name: 'commit', player: 1 }]);

    // The op is the wake. No `host.runBotTurns()` anywhere in this test: if the
    // test had to call it, gap B would still be open.
    await session.send(2, { type: 'convertSeatToBot', seat: 2 });

    expect(lastBoundary(session).key).not.toBe(parked.key);
    expect(await actionHistory(session)).toContainEqual({ name: 'commit', player: 2 });
  });

  // ── 3. One code path ───────────────────────────────────────────────────────

  it('case 3 — a converted seat and a seat that started as bot produce the SAME observable play', async () => {
    // Started-as-bot. `start()` does not pump, so seat 1 moves first in both.
    const startedAsBot = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats, [
      { seat: 2 },
    ]);
    await startedAsBot.start();
    await commit(startedAsBot, 1);

    // Converted mid-game, same fixture, same seed, same human move.
    const converted = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats);
    await converted.start();
    await commit(converted, 1);
    converted.makeSeatBot(2);
    await converted.send(2, { type: 'convertSeatToBot', seat: 2 });

    // Same boundary identity and same due seats: the converted seat is at the
    // exact flow position the pre-configured one reached.
    expect(lastBoundary(converted)).toEqual(lastBoundary(startedAsBot));
    // And the same recorded play, move for move. A second takeover path could
    // not produce a byte-identical history through the same bot and seed.
    expect(await actionHistory(converted)).toEqual(await actionHistory(startedAsBot));
  });

  // ── 4. Loud on a conversion the roster does not back ───────────────────────

  it('case 4 — converting a seat the roster does not report as bot is refused, loudly and actionably', async () => {
    const session = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats);
    await session.start();
    await commit(session, 1);
    const before = lastBoundary(session);

    // NOTE: no `makeSeatBot(2)`. This is the silent failure being closed — an op
    // that woke a pump for a seat the roster does not back would do nothing at
    // all and say nothing about it.
    const res = await session.send(2, { type: 'convertSeatToBot', seat: 2 });

    expect(res.success).toBe(false);
    expect(res.category).toBe('protocol');
    expect(res.error).toContain('seat 2');
    // Actionable: it names what the caller must do.
    expect(res.error).toMatch(/roster/i);

    // And nothing happened: no bot move, no boundary movement.
    expect(lastBoundary(session)).toEqual(before);
    expect(await actionHistory(session)).toEqual([{ name: 'commit', player: 1 }]);
  });

  // ── 5. Idempotent ──────────────────────────────────────────────────────────

  it('case 5 — converting an already-converted seat succeeds and does not move the game again', async () => {
    const session = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats);
    await session.start();
    await commit(session, 1);

    session.makeSeatBot(2);
    const first = await session.send(2, { type: 'convertSeatToBot', seat: 2 });
    expect(first.success).toBe(true);
    const settled = lastBoundary(session);
    const historyAfterFirst = await actionHistory(session);

    // Re-converting is a legal, harmless re-wake — which is what lets a caller
    // use this op to un-park a table without first working out whether the seat
    // is already a bot.
    const second = await session.send(2, { type: 'convertSeatToBot', seat: 2 });
    expect(second.success).toBe(true);
    expect(second.convertedSeat).toBe(2);

    // The bot did not move again: nothing was due for it.
    expect(lastBoundary(session)).toEqual(settled);
    expect(await actionHistory(session)).toEqual(historyAfterFirst);
  });

  it('case 5b — a re-conversion arriving DURING an in-flight pump waits its turn instead of being swallowed', async () => {
    // The sequential case above cannot see a double-run: with nothing due for
    // the bot, one pump and two pumps are indistinguishable. This one can.
    //
    // The hazard is `botPumpRunning`. It is the right re-entrancy guard, but it
    // makes a concurrent wake a SILENT no-op — so a conversion op that ran
    // inline instead of on `opChain` would return success to a caller whose
    // re-wake did nothing at all. That matters because "convert an
    // already-converted seat" is precisely how a caller un-parks a table that
    // is stalled on a seat which is already a bot, and a wake that is silently
    // dropped whenever a pump happens to be in flight is not a wake.
    const base: OpResult = {
      success: true,
      snapshot: {},
      pendingState: null,
      flowState: {},
      playerViews: [],
      isComplete: false,
      winners: [],
      botMoved: false,
    };
    const events: string[] = [];
    let botTurnCalls = 0;
    let releaseFirstBotTurn = () => {};
    const firstBotTurn = new Promise<void>((resolve) => {
      releaseFirstBotTurn = resolve;
    });

    const adapters: SnapshotSessionAdapters = {
      playerCount: 2,
      executeOp: async (_snap, _pend, op: Op) => {
        if (op.type !== 'botTurn') return { ...base };
        botTurnCalls++;
        const n = botTurnCalls;
        events.push(`read${n}`);
        if (n === 1) {
          await firstBotTurn; // hold the first pump open
          events.push(`write${n}`);
          return { ...base, botMoved: true, botPlayer: 2 };
        }
        return { ...base, botMoved: false };
      },
      broadcast: () => {},
      botSeats: [{ seat: 2 }],
    };

    const host = new SnapshotSessionHost(adapters);
    await host.start();

    const firstConversion = host.handleOp(2, { type: 'convertSeatToBot', seat: 2 });
    // Fire the second while the first is stalled mid-pump.
    const secondConversion = host.handleOp(2, { type: 'convertSeatToBot', seat: 2 });
    releaseFirstBotTurn();
    const [first, second] = await Promise.all([firstConversion, secondConversion]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    // Pump 1 ran to exhaustion (moved once, then found nothing due) and pump 2
    // ran AFTER it, not inside it. A conversion handled inline would have hit
    // `botPumpRunning` and made no botTurn call at all — three calls, in this
    // order, is what proves the op is serialized on opChain and that the
    // re-wake really happened.
    expect(events).toEqual(['read1', 'write1', 'read2', 'read3']);
    expect(botTurnCalls).toBe(3);
  });

  // ── 6. Terminal game ───────────────────────────────────────────────────────

  it('case 6 — converting a seat in a finished game is refused with a clear reason, and never hangs', async () => {
    const session = createHeadlessSession(simultaneousRoundsFixtureDefinition, twoSeats);
    await session.start();
    for (let round = 0; round < TOTAL_ROUNDS; round++) {
      await commit(session, 1);
      await commit(session, 2);
    }
    expect(session.host.isComplete).toBe(true);
    const terminal = lastBoundary(session);
    expect(terminal.dueSeats).toEqual([]);

    session.makeSeatBot(2);
    const res = await session.send(2, { type: 'convertSeatToBot', seat: 2 });

    expect(res.success).toBe(false);
    expect(res.category).toBe('protocol');
    expect(res.error).toMatch(/complete/i);
    expect(lastBoundary(session)).toEqual(terminal);
  });

  // ── 7. The circuit breaker still holds ─────────────────────────────────────

  it('case 7 — a conversion-started pump is still capped at MAX_BOT_MOVES', async () => {
    // Stub adapters: a bundle that always claims a move was made would loop
    // forever if the conversion had its own pump instead of reusing the one
    // MAX_BOT_MOVES bounds. The exact cap AND the exact log line are what prove
    // the conversion went through `runBotTurnsInner` and not a clone of it.
    const base: OpResult = {
      success: true,
      snapshot: {},
      pendingState: null,
      flowState: {},
      playerViews: [],
      isComplete: false,
      winners: [],
      botMoved: true,
    };
    let botCallCount = 0;
    const adapters: SnapshotSessionAdapters = {
      playerCount: 2,
      executeOp: async (_snap, _pend, op: Op) => {
        if (op.type === 'start') return { ...base, botMoved: false };
        if (op.type === 'botTurn') {
          botCallCount++;
          return { ...base, botMoved: true };
        }
        return { ...base };
      },
      broadcast: () => {},
      botSeats: [{ seat: 2 }],
    };

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = new SnapshotSessionHost(adapters);
    await host.start();

    // Must terminate, not hang.
    const res = await host.handleOp(2, { type: 'convertSeatToBot', seat: 2 });

    expect(res.success).toBe(true);
    expect(botCallCount).toBe(500);
    expect(errSpy).toHaveBeenCalledWith(
      '[SnapshotSessionHost] bot pump hit MAX_BOT_MOVES cap (500); stopping to avoid runaway.',
    );
    errSpy.mockRestore();
  });
});

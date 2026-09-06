// #35 section 4's scheduling policy, driven directly.
//
// Every case here is a pure function of its arguments -- no Durable Object, no
// alarm, no wall clock -- which is the reason the policy was split out of the
// `WorldSession` at all. The decisions below are the ones that would be
// expensive to get wrong and cheap to get wrong quietly: tie-break order,
// whether a coalesced catch-up drifts, and when the next alarm is armed.
import { describe, expect, test } from "vitest";
import {
  catchUpPlan,
  occurrencesDue,
  nextDueBatch,
  rearmAt,
  scheduleBatchRefusal,
  unkeyedScheduleRefusal,
  type ScheduledEvent,
} from "./schedule.js";
import { worldBudgets } from "./budgets.js";

// The budgets this file drives the policy against. Every ceiling is passed
// rather than read, which is exactly what makes the same tests true of a laptop
// host and a hosting platform running different numbers.
const BUDGETS = worldBudgets();
const WORLD_MAX_PLAYERS = BUDGETS.maxPlayers;
const WORLD_DRAIN_BATCH = BUDGETS.drainBatch;
const WORLD_CATCHUP_MAX_REAL_ITERATIONS = BUDGETS.catchUpMaxRealIterations;
const WORLD_MAX_UNKEYED_PENDING_PER_PLAYER = BUDGETS.maxUnkeyedPendingPerPlayer;
const WORLD_MAX_KEYED_PENDING_PER_PLAYER = BUDGETS.maxKeyedPendingPerPlayer;
const WORLD_MAX_SCHEDULES_PER_COMMAND = BUDGETS.maxSchedulesPerCommand;

const ev = (due: number, seq: number, rest: Partial<ScheduledEvent> = {}): ScheduledEvent => ({
  due,
  seq,
  ...rest,
});

/**
 * WHAT LEFT WITH THE HOST (#165): the drain's CPU budget.
 *
 * `WORLD_DRAIN_WALL_MS`, `WORLD_EVENT_HANDLER_BUDGET_MS`, `drainSpent`,
 * `batchSpent` and the frame/wake budgets were tested here and are not in this
 * library. How long a host may hold its world lock, and how much one poke of a
 * parked world may spend, are facts about that host's runtime -- a Durable
 * Object with 500 sockets queued behind a lock and a laptop with one browser
 * tab do not owe the same answer, and neither one is a fact about the game.
 * What IS a fact about the game -- the order events run in, whether a coalesced
 * catch-up drifts, and the caps -- is below, and the batch SIZE arrives as
 * `WorldBudgets.drainBatch`.
 */

describe("nextDueBatch — what runs, in what order", () => {
  test("orders by (due, seq), so a same-millisecond tie is insertion order", () => {
    // NOT `due` alone. Two events scheduled in the same millisecond must not
    // depend on how storage happens to return ties -- that is the kind of
    // difference that surfaces as one world diverging from another months on.
    const { batch } = nextDueBatch([ev(100, 3), ev(100, 1), ev(50, 9), ev(100, 2)], 200, WORLD_DRAIN_BATCH);
    expect(batch.map((e) => e.seq)).toEqual([9, 1, 2, 3]);
  });

  test("an event exactly AT now is due", () => {
    // A due time is the moment it becomes true, not the moment after.
    expect(nextDueBatch([ev(100, 1)], 100, WORLD_DRAIN_BATCH).batch).toHaveLength(1);
    expect(nextDueBatch([ev(101, 1)], 100, WORLD_DRAIN_BATCH).batch).toHaveLength(0);
  });

  test("leaves future events alone", () => {
    const { batch, behind } = nextDueBatch([ev(50, 1), ev(500, 2)], 100, WORLD_DRAIN_BATCH);
    expect(batch.map((e) => e.seq)).toEqual([1]);
    expect(behind).toBe(false);
  });

  test("caps at the batch size and reports that it is still behind", () => {
    // The overload rung: it does not refuse anything, it says there is more.
    const many = Array.from({ length: WORLD_DRAIN_BATCH + 5 }, (_, i) => ev(1, i));
    const { batch, behind } = nextDueBatch(many, 10_000, WORLD_DRAIN_BATCH);
    expect(batch).toHaveLength(WORLD_DRAIN_BATCH);
    expect(behind).toBe(true);
  });

  test("an exactly-full batch is NOT behind", () => {
    // The off-by-one that would re-arm a busy world to `now` forever, burning
    // a wake per drain with nothing left to do.
    const exact = Array.from({ length: WORLD_DRAIN_BATCH }, (_, i) => ev(1, i));
    expect(nextDueBatch(exact, 10_000, WORLD_DRAIN_BATCH).behind).toBe(false);
  });
});

describe("rearmAt — when the next alarm fires", () => {
  test("nothing queued -> NULL, so an idle world has no alarm armed at all", () => {
    // #35's wake-abuse guard depends on this being an absence rather than a
    // far-future time: an unoccupied world "deletes its Cloudflare alarm
    // entirely", so there is nothing armed to fire.
    expect(rearmAt([], 500)).toBeNull();
  });

  test("a timer still to come is armed AT ITS DUE, however soon that is (#344)", () => {
    // The whole of the timer contract: `ctx.schedule({ delayMs: 30_000 })`
    // lands at thirty seconds. There used to be a forty second floor here
    // that bound this first arm as hard as any re-arm, so a thirty second
    // march landed at forty and the settler watching their own countdown saw
    // it. The floor is gone rather than documented.
    expect(rearmAt([ev(501, 1)], 500)).toBe(501);
    expect(rearmAt([ev(500 + 30_000, 1)], 500)).toBe(500 + 30_000);
  });

  test("an OVERDUE event is armed for NOW, whether the drain was behind or the queue is stale", () => {
    // Behind-ness is not a separate verdict any more: a drain that stopped on
    // its budget left due work, due work is overdue, and overdue arms now.
    expect(rearmAt([ev(0, 1)], 500)).toBe(500);
    expect(rearmAt([ev(500, 1)], 500)).toBe(500);
  });

  test("overdue work that is a RETRY waits for `retryAt`, and never longer than it", () => {
    // A quarantined event and an event the bundle store could not answer for
    // both stay queued at their own due, already past. Arming NOW for them
    // would hammer a failing handler or an unreachable store as fast as the
    // runtime delivers alarms; the drain names when they may next be tried.
    expect(rearmAt([ev(0, 1)], 500, 900)).toBe(900);
    // A stale `retryAt` -- one the clock has passed -- is now, not the past.
    expect(rearmAt([ev(0, 1)], 500, 100)).toBe(500);
  });

  test("a fresh timer beside a retry is NOT held to the retry's wait (#344)", () => {
    // The precision the floor never had: the wait is the failing event's, and
    // a thirty second timer scheduled while some other event is failing still
    // lands at thirty seconds -- the alarm fires for whichever comes first.
    expect(rearmAt([ev(0, 1), ev(700, 2)], 500, 900)).toBe(700);
    expect(rearmAt([ev(0, 1), ev(1_500, 2)], 500, 900)).toBe(900);
  });
});

describe("catchUpPlan — integrate, never replay", () => {
  const HOUR = 3_600_000;

  test("nothing due yet is an empty plan", () => {
    expect(catchUpPlan(1000, HOUR, 500, WORLD_CATCHUP_MAX_REAL_ITERATIONS)).toEqual([]);
  });

  test("one occurrence due runs once, with nothing folded in", () => {
    expect(catchUpPlan(1000, HOUR, 1000, WORLD_CATCHUP_MAX_REAL_ITERATIONS)).toEqual([{ due: 1000, missedCount: 0 }]);
  });

  test("THE #35 CASE: three missed days run four real iterations then ONE coalesced call", () => {
    // "A recurring event that missed three days runs at most four real
    // iterations, then one coalesced call with {due, missedCount}."
    // Hourly over 72 hours is 73 occurrences: 4 real + 69 folded.
    const plan = catchUpPlan(0, HOUR, 72 * HOUR, WORLD_CATCHUP_MAX_REAL_ITERATIONS);
    expect(plan).toHaveLength(WORLD_CATCHUP_MAX_REAL_ITERATIONS + 1);
    expect(plan.slice(0, 4).map((p) => p.missedCount)).toEqual([0, 0, 0, 0]);
    expect(plan.at(-1)!.missedCount).toBe(68);
    // 4 real + 69 folded accounts for every occurrence, which is the property
    // that makes "integrate" mean the same thing as "replay" to the game.
    // Four real iterations, the coalesced call itself, and the 68 that got no
    // call of their own: every occurrence that was due is accounted for once.
    // A handler integrating with `1 + missedCount` therefore lands exactly on
    // 73 hours of income, which `world-recurring-tick.test.ts` proves through
    // the real drain.
    expect(WORLD_CATCHUP_MAX_REAL_ITERATIONS + 1 + plan.at(-1)!.missedCount).toBe(73);
  });

  test("the coalesced call is stamped with the LAST occurrence's due, not the first", () => {
    // The world's clock is where the world actually is. Stamping it with the
    // catch-up's start would leave the world an interval behind forever.
    const plan = catchUpPlan(0, HOUR, 72 * HOUR, WORLD_CATCHUP_MAX_REAL_ITERATIONS);
    expect(plan.at(-1)!.due).toBe(72 * HOUR);
  });

  test("DRIFT-FREE: every real iteration is firstDue + n*interval, never now-based", () => {
    // The reason #35 says a tick needs no special machinery. `now` here is
    // deliberately NOT on an interval boundary; if any due were derived from
    // it, the sequence would skew.
    const plan = catchUpPlan(0, HOUR, 2 * HOUR + 137, WORLD_CATCHUP_MAX_REAL_ITERATIONS);
    expect(plan.map((p) => p.due)).toEqual([0, HOUR, 2 * HOUR]);
  });

  test("exactly at the real-iteration ceiling folds nothing", () => {
    // The boundary where a plan stops needing a coalesced call at all.
    const plan = catchUpPlan(0, HOUR, (WORLD_CATCHUP_MAX_REAL_ITERATIONS - 1) * HOUR, WORLD_CATCHUP_MAX_REAL_ITERATIONS);
    expect(plan).toHaveLength(WORLD_CATCHUP_MAX_REAL_ITERATIONS);
    expect(plan.every((p) => p.missedCount === 0)).toBe(true);
  });

  test("ONE occurrence past the ceiling folds nothing into anybody", () => {
    // The boundary the `- 1` is about. Five occurrences due against a ceiling
    // of four is five calls and nothing missed -- not four calls and one
    // carrying a phantom. A handler adding `1 + missedCount` would otherwise
    // charge an hour that never elapsed.
    const plan = catchUpPlan(0, HOUR, WORLD_CATCHUP_MAX_REAL_ITERATIONS * HOUR, WORLD_CATCHUP_MAX_REAL_ITERATIONS);
    expect(plan).toHaveLength(WORLD_CATCHUP_MAX_REAL_ITERATIONS + 1);
    expect(plan.every((p) => p.missedCount === 0)).toBe(true);
  });

  test("refuses a non-positive interval rather than looping forever", () => {
    expect(() => catchUpPlan(0, 0, 1000, WORLD_CATCHUP_MAX_REAL_ITERATIONS)).toThrow(/interval must be positive/);
    expect(() => catchUpPlan(0, -1, 1000, WORLD_CATCHUP_MAX_REAL_ITERATIONS)).toThrow(/interval must be positive/);
  });
});

describe("occurrencesDue — what the drain actually runs, and where it re-arms", () => {
  const HOUR = 3_600_000;

  test("a ONE-SHOT is one call and no next occurrence", () => {
    // The queue is simply finished with it, which is what `nextDue: null` tells
    // the drain to do: settle the row rather than move it.
    expect(occurrencesDue({ due: 1000, seq: 1 }, 9999, WORLD_CATCHUP_MAX_REAL_ITERATIONS)).toEqual({
      occurrences: [{ due: 1000, missedCount: 0 }],
      nextDue: null,
    });
  });

  test("a PUNCTUAL recurrence is one call, re-armed one interval on", () => {
    expect(occurrencesDue({ due: 1000, seq: 1, everyMs: HOUR }, 1000, WORLD_CATCHUP_MAX_REAL_ITERATIONS)).toEqual({
      occurrences: [{ due: 1000, missedCount: 0 }],
      nextDue: 1000 + HOUR,
    });
  });

  test("a BEHIND recurrence comes out of ONE wake armed for the present", () => {
    // The whole cost argument. A world 72 hours behind on an hourly tick is
    // armed for hour 73 when the wake ends, not for hour 5 -- so it does not
    // grind through 68 more wakes at the re-arm floor to reach the present.
    const behind = occurrencesDue({ due: 0, seq: 1, everyMs: HOUR }, 72 * HOUR, WORLD_CATCHUP_MAX_REAL_ITERATIONS);
    expect(behind.occurrences).toHaveLength(WORLD_CATCHUP_MAX_REAL_ITERATIONS + 1);
    expect(behind.nextDue).toBe(73 * HOUR);
    expect(behind.nextDue).toBeGreaterThan(72 * HOUR);
  });
});

describe("unkeyedScheduleRefusal — the one refusal in the design", () => {
  test("admits everything below the cap", () => {
    expect(unkeyedScheduleRefusal(0, "p1", WORLD_MAX_UNKEYED_PENDING_PER_PLAYER)).toBeNull();
    expect(unkeyedScheduleRefusal(WORLD_MAX_UNKEYED_PENDING_PER_PLAYER - 1, "p1", WORLD_MAX_UNKEYED_PENDING_PER_PLAYER)).toBeNull();
  });

  test("refuses the 33rd, which is what #35 specifies", () => {
    // The cap is 32 and the 33rd is refused, so a player holding exactly 32 is
    // the last admitted state.
    expect(WORLD_MAX_UNKEYED_PENDING_PER_PLAYER).toBe(32);
    expect(unkeyedScheduleRefusal(WORLD_MAX_UNKEYED_PENDING_PER_PLAYER, "p1", WORLD_MAX_UNKEYED_PENDING_PER_PLAYER)).not.toBeNull();
  });

  test("names all THREE ways forward, because a refusal without one is a trap", () => {
    const message = unkeyedScheduleRefusal(WORLD_MAX_UNKEYED_PENDING_PER_PLAYER, "ada", WORLD_MAX_UNKEYED_PENDING_PER_PLAYER)!;
    expect(message).toContain("ada");
    expect(message).toMatch(/key/i);
    expect(message).toMatch(/cancel/i);
    expect(message).toMatch(/lazy/i);
    // ...and the lazy route says HOW, since it is the one that costs nothing.
    expect(message).toContain("completesAt");
  });

  test("a KEYED schedule can never reach it, however many are pending", () => {
    // "Keyed schedules and lazy timestamps can never hit any rung." The cap
    // counts unkeyed events only, so this is a fact about the argument the
    // caller passes -- asserted here so a future caller that started counting
    // every pending event would fail rather than silently refuse good bundles.
    const pendingKeyed = 10_000;
    expect(unkeyedScheduleRefusal(0, "p1", pendingKeyed)).toBeNull();
  });
});

describe("scheduleBatchRefusal — the batch cap agrees with the holding caps (#170)", () => {
  test("is derived from EVERYTHING one owner may hold, across both classes", () => {
    // The cap was derived from the UNKEYED holding cap (32) and then from the
    // KEYED one (64), and both contradicted the stated invariant -- "an asking
    // bound below a holding bound refuses batches the queue would have
    // admitted whole". An owner holds 32 unkeyed AND 64 keyed, so the only
    // asking bound that never refuses an admissible batch is the sum.
    expect(WORLD_MAX_SCHEDULES_PER_COMMAND).toBe(
      WORLD_MAX_UNKEYED_PENDING_PER_PLAYER + WORLD_MAX_KEYED_PENDING_PER_PLAYER,
    );
  });

  test("admits a MIXED batch every holding cap would admit whole (#205)", () => {
    // A setup command arming 64 named building timers and one unkeyed kickoff.
    // 65 requests, all of them admissible -- 64 under the keyed cap, 1 under
    // the unkeyed one -- and the batch cap refused the 65th, with advice to use
    // stable keys, which is what its author had already done for everything the
    // advice can apply to. That is #170's failure shape one class over.
    expect(
      scheduleBatchRefusal(WORLD_MAX_KEYED_PENDING_PER_PLAYER + 1, WORLD_MAX_SCHEDULES_PER_COMMAND),
    ).toBeNull();
  });

  test("admits the encouraged shape: a keyed setup batch bigger than the unkeyed cap", () => {
    // 40 named building timers in one command. Over the old cap of 32; well
    // under what one owner may HOLD keyed, so the ask can be fully admitted.
    expect(scheduleBatchRefusal(40, WORLD_MAX_SCHEDULES_PER_COMMAND)).toBeNull();
    expect(scheduleBatchRefusal(WORLD_MAX_SCHEDULES_PER_COMMAND - 1, WORLD_MAX_SCHEDULES_PER_COMMAND)).toBeNull();
  });

  test("still refuses an ask past the cap, naming the number", () => {
    const message = scheduleBatchRefusal(WORLD_MAX_SCHEDULES_PER_COMMAND, WORLD_MAX_SCHEDULES_PER_COMMAND)!;
    expect(message).not.toBeNull();
    expect(message).toContain(String(WORLD_MAX_SCHEDULES_PER_COMMAND));
  });

  test("names ways forward the author has NOT already taken", () => {
    // The file's own rule: "a refusal that does not leave a way forward is the
    // trap". The old message told a keyed-batch author to "give each thing a
    // stable key and re-arm it when it changes" -- precisely what they had
    // done. The actual way forward for an oversized ask is to SPLIT it.
    const message = scheduleBatchRefusal(WORLD_MAX_SCHEDULES_PER_COMMAND, WORLD_MAX_SCHEDULES_PER_COMMAND)!;
    expect(message).toMatch(/split/i);
    expect(message).toMatch(/lazy/i);
    expect(message).toContain("completesAt");
    expect(message).not.toContain("give each thing a stable key");
  });
});

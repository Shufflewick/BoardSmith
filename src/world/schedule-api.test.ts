// Issue #37 item 3: `ctx.schedule()`, the parent's half.
//
// §7 puts this in the PARENT so "the abusive path cannot reach the queue
// rather than failing a check". These cases are about that sentence: what a
// bundle can ask for, what it cannot cause, and what the parent stamps rather
// than believes.
import { describe, expect, it } from "vitest";
import {
  WORLD_OWNER,
  planSchedules,
  type PlannedEvent,
  type ScheduleRequest,
} from "./schedule-api.js";
import { worldBudgets } from "./budgets.js";

// The ceilings this file plans against. Passed into every plan rather than read
// from a module constant, which is what lets a laptop host and a hosting
// platform run different numbers and still be the same world.
const BUDGETS = worldBudgets();
const WORLD_MAX_KEYED_PENDING_PER_PLAYER = BUDGETS.maxKeyedPendingPerPlayer;
const WORLD_MAX_PENDING_EVENTS = BUDGETS.maxPendingEvents;
const WORLD_MAX_SCHEDULES_PER_COMMAND = BUDGETS.maxSchedulesPerCommand;
const WORLD_MAX_UNKEYED_PENDING_PER_PLAYER = BUDGETS.maxUnkeyedPendingPerPlayer;

const ARRIVED = 1_000_000;

/**
 * Plan against a queue held as a plain array.
 *
 * `planSchedules` is told ABOUT the queue rather than handed it (#74: one
 * storage key per event, so there is no whole-queue value and reading one
 * would be O(queue) per command). This is the parent's two point-addressed
 * lookups, done the slow obvious way over an array -- which is exactly what a
 * test wants, because it makes the queue visible.
 *
 * An event's own id stands in for its storage key here: the only thing
 * `replaced` is ever used for is naming the row to delete.
 */
function plan(
  queue: readonly PlannedEvent[],
  requests: readonly ScheduleRequest[],
  owner: string | null = "p1",
  /** What the world holds that this array does not -- the only way to reach a
   *  ceiling no test can afford to build event by event. */
  over: Partial<{ worldPending: number }> = {},
) {
  const charged = owner ?? WORLD_OWNER;
  return planSchedules(requests, {
    owner,
    budgets: BUDGETS,
    arrivedAt: ARRIVED,
    nextSeq: queue.length,
    mintId: (index) => `evt-${queue.length + index}`,
    allowance: {
      unkeyed: queue.filter((e) => e.owner === charged && e.key === undefined).length,
      keys: queue.flatMap((e) => (e.owner === charged && e.key !== undefined ? [e.key] : [])),
      worldPending: queue.length,
      ...over,
    },
    replaces: (key) => queue.find((e) => e.owner === charged && e.key === key)?.id,
  });
}

/** The queue after a plan lands: displaced rows out, planned events in. */
function applied(
  queue: readonly PlannedEvent[],
  result: ReturnType<typeof plan>,
): readonly PlannedEvent[] {
  if (!result.ok) return queue;
  return [
    ...queue.filter((e) => !result.replaced.includes(e.id)),
    ...result.events,
  ];
}

/** `n` distinct one-shot events already pending for `owner`. */
function unkeyed(owner: string, n: number): PlannedEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `old-${owner}-${i}`,
    due: ARRIVED,
    seq: i,
    attempts: 0,
    action: "tick",
    args: {},
    owner,
  }));
}

describe("#37 item 3 — ctx.schedule() as the parent applies it", () => {
  it("schedules from the command's ARRIVAL, not from wall clock", () => {
    // A world that woke late must not schedule everything late in turn, or a
    // parked world drifts further from its own clock at every wake. Same
    // reason a drained event's handler receives its scheduled `due`.
    const result = plan([], [{ delayMs: 5_000, action: "tick", args: { tick: 1 } }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]!.due).toBe(ARRIVED + 5_000);
  });

  it("STAMPS the owner from the acting player -- a request cannot claim one", () => {
    // The cap is decorative if a bundle can charge its events to somebody
    // else's budget, so the owner is never taken from the request. There is no
    // field on `ScheduleRequest` to put one in, and this is that as a fact.
    const result = plan([], [{ delayMs: 1, action: "tick" }], "p2");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]!.owner).toBe("p2");
  });

  it("charges a due event's own schedules to the WORLD, not to whoever acted last", () => {
    // A scheduled event has no acting player. Leaving it unowned would leave
    // it uncapped, and a recurring handler re-arming itself without a key is
    // exactly the shape that would then grow the queue forever.
    const result = plan([], [{ delayMs: 1, action: "tick" }], null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]!.owner).toBe(WORLD_OWNER);
    // Unforgeable: no platform user id contains a colon, so a player can never
    // be charged for the world's events nor the world for theirs.
    expect(WORLD_OWNER).toContain(":");
  });

  it("REFUSES a player's 33rd unkeyed event, and names the three ways forward", () => {
    // #35's single refusal, stated as "a player's 33rd unkeyed pending event".
    const full = unkeyed("p1", WORLD_MAX_UNKEYED_PENDING_PER_PLAYER);
    const result = plan(full, [{ delayMs: 1, action: "tick" }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.message).toContain("give the schedule a KEY");
    // NAMING A REMEDY THAT EXISTS (#177). This said "cancel one of the pending
    // events" while `ScheduleRequest` had no cancel on it at all.
    expect(result.refusal.message).toContain("ctx.world.cancel(key)");
    expect(result.refusal.message).toContain("LAZY");
  });

  it("admits the 32nd, so the cap is the 33rd and not the 32nd", () => {
    const nearlyFull = unkeyed("p1", WORLD_MAX_UNKEYED_PENDING_PER_PLAYER - 1);
    expect(plan(nearlyFull, [{ delayMs: 1, action: "tick" }]).ok).toBe(true);
  });

  it("counts the cap PER PLAYER, so one player cannot exhaust another's budget", () => {
    // The abuse this shape exists to make impossible: a queue full of p2's
    // events must not refuse p1.
    const full = unkeyed("p2", WORLD_MAX_UNKEYED_PENDING_PER_PLAYER);
    expect(plan(full, [{ delayMs: 1, action: "tick" }], "p1").ok).toBe(true);
  });

  it("a KEYED schedule can never hit the cap, because it replaces rather than adds", () => {
    // The exemption the refusal's first suggestion depends on. Scheduling the
    // same key many times over a full queue must always succeed and must never
    // grow it.
    const full = unkeyed("p1", WORLD_MAX_UNKEYED_PENDING_PER_PLAYER);
    let queue: readonly PlannedEvent[] = full;
    for (let i = 0; i < 10; i++) {
      const result = plan(queue, [{ delayMs: i, key: "respawn", action: "respawn", args: { i } }]);
      expect(result.ok).toBe(true);
      queue = applied(queue, result);
    }

    expect(queue).toHaveLength(WORLD_MAX_UNKEYED_PENDING_PER_PLAYER + 1);
    const keyed = queue.filter((e) => e.key === "respawn");
    expect(keyed).toHaveLength(1);
    // The LATEST wins: an upsert replaces, so the pending event is the last one asked for.
    expect(keyed[0]!.args).toEqual({ i: 9 });
  });

  it("a key is scoped to its owner: two players may hold the same key", () => {
    const mine = plan([], [{ delayMs: 1, key: "respawn", action: "tick", args: { tag: "p1" } }], "p1");
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;

    const queue = applied([], mine);
    const theirs = plan(queue, [{ delayMs: 1, key: "respawn", action: "tick", args: { tag: "p2" } }], "p2");
    expect(theirs.ok).toBe(true);
    if (!theirs.ok) return;
    // Nothing displaced: a key is scoped to its owner, so p2's respawn is not
    // p1's and both stay pending.
    expect(theirs.replaced).toEqual([]);
    expect(applied(queue, theirs)).toHaveLength(2);
  });

  it("REFUSES the WHOLE batch when one request is refused", () => {
    // A command whose third schedule was refused must not leave the first two
    // behind: the handler ran to completion believing all three were taken, and
    // a world holding two of them is a state the bundle never anticipated.
    const nearlyFull = unkeyed("p1", WORLD_MAX_UNKEYED_PENDING_PER_PLAYER - 1);
    const result = plan(nearlyFull, [
      { delayMs: 1, action: "tick", args: { tag: "first" } },
      { delayMs: 2, action: "tick", args: { tag: "second" } },
    ]);

    expect(result.ok).toBe(false);
  });

  it("REFUSES a negative or non-finite delay, and says what to do instead", () => {
    const bad = plan([], [{ delayMs: -1, action: "tick" }]);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.refusal.message).toContain("zero or more milliseconds");
    // The code, not the prose, is what the park ladder reads.
    expect(bad.refusal.code).toBe("invalid-schedule-delay");
    expect(bad.refusal.owner).toBe("game");
    expect(plan([], [{ delayMs: Number.NaN, action: "tick" }]).ok).toBe(false);
    // Zero is legal: "now" is a delay, not an error.
    expect(plan([], [{ delayMs: 0, action: "tick" }]).ok).toBe(true);
  });

  it("carries a RECURRENCE's interval into the stored event (#127)", () => {
    // The whole shape change. Without the interval on the row the parent holds
    // one due time and cannot tell a tick that fell three days behind from 73
    // unrelated one-shots, which is why the catch-up had no caller.
    const result = plan([], [
      { delayMs: 1000, everyMs: 60_000, key: "tick", action: "collectIncome" },
      { delayMs: 1000, action: "resolveRaid" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]!.everyMs).toBe(60_000);
    // A one-shot carries no interval at all rather than a zero one: absent is
    // the shape `occurrencesDue` branches on.
    expect(result.events[1]!.everyMs).toBeUndefined();
    expect("everyMs" in result.events[1]!).toBe(false);
  });

  it("REFUSES a non-positive or non-finite interval (#127)", () => {
    // A recurrence with no gap is a wake that re-arms instantly, forever. It is
    // refused here so it lands in the handler like every other schedule
    // refusal, rather than as a throw out of `catchUpPlan` on some later drain
    // -- which would be a platform-owned failure climbing the park ladder for a
    // bundle's typo.
    const bad = plan([], [{ delayMs: 1000, everyMs: 0, action: "tick" }]);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.refusal.code).toBe("invalid-schedule-interval");
    expect(bad.refusal.owner).toBe("game");
    expect(bad.refusal.message).toContain("positive number of");
    expect(plan([], [{ delayMs: 1000, everyMs: -1, action: "tick" }]).ok).toBe(false);
    expect(plan([], [{ delayMs: 1000, everyMs: Number.NaN, action: "tick" }]).ok).toBe(false);
  });

  it("gives every event a distinct seq, so ties within a millisecond are ordered", () => {
    // `nextDueBatch` orders on (due, seq) precisely so a world's behaviour does
    // not depend on how storage returns ties. Two events scheduled with the
    // same delay in one command must therefore differ.
    const result = plan([], [
      { delayMs: 10, action: "tick", args: { tag: "a" } },
      { delayMs: 10, action: "tick", args: { tag: "b" } },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [a, b] = result.events;
    expect(a!.due).toBe(b!.due);
    expect(a!.seq).not.toBe(b!.seq);
  });

  it("leaves the queue untouched when a command schedules nothing", () => {
    const existing = unkeyed("p1", 3);
    const result = plan(existing, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([]);
    expect(result.replaced).toEqual([]);
    expect(applied(existing, result)).toEqual(existing);
  });

  it("NAMES the row a keyed upsert displaces, so the queue cannot hold two", () => {
    // "Its count never grows" is what exempts a keyed schedule from the cap. A
    // plan that added beside its predecessor instead of naming it for deletion
    // would make that exemption a lie -- and the caller cannot work the row out
    // for itself, because the old event is under a key built from the `due` it
    // no longer has.
    const first = plan([], [{ delayMs: 1, key: "respawn", action: "tick", args: { tag: "old" } }]);
    const queue = applied([], first);
    const second = plan(queue, [{ delayMs: 9, key: "respawn", action: "tick", args: { tag: "new" } }]);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replaced).toEqual([queue[0]!.id]);
    expect(applied(queue, second)).toHaveLength(1);
  });

  it("upserts a key against ITSELF within one command", () => {
    // Two requests under one key in a single handler. The second replaces the
    // first, which has not been written yet -- an append would leave the world
    // holding two events for a key that promises one.
    const result = plan([], [
      { delayMs: 1, key: "respawn", action: "tick", args: { tag: "first" } },
      { delayMs: 2, key: "respawn", action: "tick", args: { tag: "second" } },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.args).toEqual({ tag: "second" });
  });
});

/**
 * Issue #89: THE ENVELOPE IS NAMED ON THE REQUEST, and `payload` is gone.
 *
 * `ScheduleRequest.payload` documented itself as "the game's own payload, the
 * platform never parses inside it" while `world-session.ts:runEvent` read
 * `payload.command` and `payload.args` out of it. A payload that named no
 * command bought a wake and did nothing at all -- no refusal, no log, and the
 * queue advanced. The type now says what the platform always decided.
 *
 * THE FIELD IS `action` SINCE #169, and that is a rename rather than a concept:
 * what a scheduled event names is a verb in the game's ONE registry of things
 * this world can be told to do, and since #169 that registry is the game's own
 * action registry. What must not change -- and does not -- is that the clock
 * and a player reach the same place.
 */
describe("#89 — a scheduled event names its action on the request", () => {
  it("carries the action and its args as named fields", () => {
    const result = plan([], [{ delayMs: 5_000, action: "resolveRaid", args: { raid: "north" } }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]!.action).toBe("resolveRaid");
    expect(result.events[0]!.args).toEqual({ raid: "north" });
  });

  it("REFUSES a request that names no action, at the offending line", () => {
    // The Pit of Success half. A game author who writes
    // `schedule({ delayMs, raid: raid.name })` used to buy a wake that did
    // nothing; now `ctx.schedule()` throws inside the handler, the command
    // unwinds, and the player is told over a world that did not change.
    const result = plan(
      [],
      [{ delayMs: 1 } as unknown as ScheduleRequest],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("invalid-schedule-command");
    // The sentence names the FIELD an author has to write, which is the whole
    // of the Pit of Success here: a refusal that said "invalid request" would
    // send them back to the type rather than to the line.
    expect(result.refusal.message).toContain("action");
  });

  it("refuses an empty action name too", () => {
    const result = plan([], [{ delayMs: 1, action: "" }]);
    expect(result.ok).toBe(false);
  });

  it("REFUSES an argument a schedule row could not survive (#169)", () => {
    // A SCHEDULE ROW OUTLIVES EVICTION AND REHYDRATION, which is the whole of
    // why this rule exists. An element reference stored in a row names an
    // element that may not be resident when the event comes due, and in the
    // worst case one that has been RE-MINTED since -- so the wake would run
    // against whatever now holds that id. Pass the partition's NAME and let the
    // action read inside it, which is what every clock verb in the catalogue
    // already does.
    //
    // Refused beside the other shape refusals, so it lands inside the action
    // and unwinds it, rather than being discovered on a drain days later with
    // nobody to tell.
    for (const args of [
      { room: { id: 7 } },
      { rooms: ["a", "b"] },
      { at: new Date(0) },
    ]) {
      const result = plan([], [{ delayMs: 1, action: "tick", args } as ScheduleRequest]);
      expect(result.ok, JSON.stringify(args)).toBe(false);
      if (result.ok) return;
      expect(result.refusal.message).toContain("is not a JSON scalar");
    }
  });

  it("takes every JSON scalar, because that is what a row can hold", () => {
    // The other half, and it has to be stated: a rule that refused too much
    // would push authors into encoding their own arguments as strings, which
    // is the same hazard with a manual step in front of it.
    const result = plan(
      [],
      [{ delayMs: 1, action: "tick", args: { name: "north", size: 4, on: true, none: null } }],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]!.args).toEqual({ name: "north", size: 4, on: true, none: null });
  });

  it("defaults absent args to an empty object rather than leaving them undefined", () => {
    // A command that takes no arguments is the common case, and a handler must
    // not have to tell "no args" from "args I could not see".
    const result = plan([], [{ delayMs: 1, action: "tick" }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]!.args).toEqual({});
  });
});

/** `n` distinct KEYED events already pending for `owner`, keyed `k-0`.. */
function keyed(owner: string, n: number): PlannedEvent[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `key-${owner}-${i}`,
    due: ARRIVED,
    seq: i,
    attempts: 0,
    action: "tick",
    args: {},
    owner,
    key: `k-${i}`,
  }));
}

describe("#105 — a key is not a way around the cap", () => {
  it("REFUSES a NEW key past the per-owner keyed cap", () => {
    // The hole this issue is about: `admitSchedule` returned early for every
    // request carrying a key, so a handler minting `raid-1`, `raid-2`,
    // `raid-3` grew the queue forever. "Its count never grows" is true per
    // key and false per owner.
    const full = keyed("p1", WORLD_MAX_KEYED_PENDING_PER_PLAYER);
    const result = plan(full, [{ delayMs: 1, key: "brand-new", action: "tick" }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("schedule-key-cap");
    // GAME-owned: a bundle's own doing, so it dead-letters rather than
    // climbing the park ladder and killing a 500-player world.
    expect(result.refusal.owner).toBe("game");
    expect(result.refusal.message).toContain(String(WORLD_MAX_KEYED_PENDING_PER_PLAYER));
    expect(result.refusal.message).toContain("REUSE a key you already hold");
  });

  it("admits the LAST key under the cap, so the cap is the 65th and not the 64th", () => {
    const nearlyFull = keyed("p1", WORLD_MAX_KEYED_PENDING_PER_PLAYER - 1);
    expect(plan(nearlyFull, [{ delayMs: 1, key: "one-more", action: "tick" }]).ok).toBe(true);
  });

  it("still admits an UPSERT of a key already pending, at the cap", () => {
    // The whole point of the exemption, kept: a keyed schedule under a key the
    // owner already holds replaces rather than adds, so it cannot grow
    // anything and must never be refused. A cap that refused it would break
    // every game the docs steer toward keys.
    const full = keyed("p1", WORLD_MAX_KEYED_PENDING_PER_PLAYER);
    const result = plan(full, [{ delayMs: 5, key: "k-0", action: "tick", args: { again: true } }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replaced).toEqual(["key-p1-0"]);
    expect(applied(full, result)).toHaveLength(WORLD_MAX_KEYED_PENDING_PER_PLAYER);
  });

  it("counts distinct keys PER OWNER, so one player cannot exhaust another's", () => {
    const full = keyed("p2", WORLD_MAX_KEYED_PENDING_PER_PLAYER);
    expect(plan(full, [{ delayMs: 1, key: "mine", action: "tick" }], "p1").ok).toBe(true);
  });

  it("counts the keys THIS COMMAND has already minted, not just the durable ones", () => {
    // Requests are not durable until the parent writes them, so a command that
    // asked for the cap's worth in one breath would otherwise land the lot.
    const one = keyed("p1", WORLD_MAX_KEYED_PENDING_PER_PLAYER - 1);
    const result = plan(one, [
      { delayMs: 1, key: "new-a", action: "tick" },
      { delayMs: 2, key: "new-b", action: "tick" },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("schedule-key-cap");
  });
});

describe("#105 — a command may not ask for an unbounded number of events", () => {
  it("REFUSES a batch past the per-command cap, which only UPSERTS can reach (#170)", () => {
    // `applySchedules` wrote every request in one loop with no ceiling: a
    // command answering 50,000 requests was 100,000 storage puts inside one
    // message. The batch cap is the bound on that WALK, and upserts are what
    // make it its own cap rather than a restatement of the holding caps: an
    // upsert grows nothing the depth caps measure, so a handler looping
    // thousands of times over one held key is bounded by this and nothing
    // else.
    const held = keyed("p1", 1);
    const requests = Array.from({ length: WORLD_MAX_SCHEDULES_PER_COMMAND + 1 }, () => ({
      delayMs: 1,
      key: "k-0",
      action: "tick",
    }));
    const result = plan(held, requests);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("schedule-batch-cap");
    expect(result.refusal.owner).toBe("game");
    expect(result.refusal.message).toContain(String(WORLD_MAX_SCHEDULES_PER_COMMAND));
  });

  it("admits a batch exactly AT the per-command cap", () => {
    const held = keyed("p1", 1);
    const requests = Array.from({ length: WORLD_MAX_SCHEDULES_PER_COMMAND }, () => ({
      delayMs: 1,
      key: "k-0",
      action: "tick",
    }));
    expect(plan(held, requests).ok).toBe(true);
  });

  it("admits the ENCOURAGED shape whole: a keyed setup batch past the unkeyed cap (#170)", () => {
    // The cap used to be derived from the unkeyed holding cap (32), so a setup
    // command arming 40 named building timers -- one key per NAMED thing, the
    // exact shape the platform steers authors to -- was refused at request 33
    // with advice to use stable keys: what its author had already done. The
    // batch cap now agrees with the keyed holding cap the requests are checked
    // against anyway.
    const requests = Array.from({ length: 40 }, (_, i) => ({
      delayMs: 1,
      key: `building-${i}`,
      action: "tick",
    }));
    expect(plan([], requests).ok).toBe(true);
  });
});

describe("#105 — the per-world ceiling is the backstop", () => {
  it("REFUSES an event once the WORLD is at its ceiling, whoever asks", () => {
    // Below the sum of the per-owner caps deliberately: a ceiling only a
    // fully-seated world of maxed-out players could reach is a ceiling that
    // never trips.
    const result = plan([], [{ delayMs: 1, action: "tick" }], "p1", {
      worldPending: WORLD_MAX_PENDING_EVENTS,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("schedule-world-cap");
    expect(result.refusal.owner).toBe("game");
    expect(result.refusal.message).toContain(String(WORLD_MAX_PENDING_EVENTS));
  });

  it("still admits an UPSERT at the ceiling, because it replaces rather than adds", () => {
    // The ceiling counts the queue, and an upsert leaves it exactly as deep as
    // it was. Refusing it would strand a full world with no way to re-arm the
    // timers it already holds.
    const held = keyed("p1", 1);
    const result = plan(held, [{ delayMs: 5, key: "k-0", action: "tick" }], "p1", {
      worldPending: WORLD_MAX_PENDING_EVENTS,
    });

    expect(result.ok).toBe(true);
  });

  it("admits the event that brings the world exactly TO the ceiling", () => {
    const result = plan([], [{ delayMs: 1, action: "tick" }], "p1", {
      worldPending: WORLD_MAX_PENDING_EVENTS - 1,
    });
    expect(result.ok).toBe(true);
  });
});

/**
 * Issue #177: A SCHEDULE REQUEST CAN CANCEL.
 *
 * `schedule.ts`'s two cap refusals have told an author to "cancel a pending
 * timer you no longer need" since the caps existed, and there was no way to do
 * it -- a refusal naming a remedy the API did not offer, which is the trap this
 * repo's own rule forbids.
 *
 * A cancel is KEYED THE WAY ARMING IS KEYED: `(owner, key)`, with the owner
 * stamped from the acting seat rather than named by the request. That is the
 * same sentence the arm side rests on -- a bundle cannot charge its events to
 * somebody else's budget -- read backwards: a bundle cannot forget somebody
 * else's timer either, because it has no way to address one.
 */
describe("#177 — a keyed timer can be taken back", () => {
  it("NAMES the pending row for deletion and plans no event in its place", () => {
    const held = plan([], [{ delayMs: 60_000, key: "raid", action: "resolveRaid" }]);
    const queue = applied([], held);

    const result = plan(queue, [{ cancel: "raid" }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([]);
    expect(result.replaced).toEqual([queue[0]!.id]);
    expect(applied(queue, result)).toEqual([]);
  });

  it("is IDEMPOTENT: cancelling a key nothing holds changes nothing", () => {
    // A wake can always be late, and the queue is not readable from a handler.
    // "Whoever arrives first clears the field, the loser finds it cleared and
    // returns" is the pattern a keyed deadline is for, and the loser is exactly
    // the caller whose timer already fired. Refusing here would unwind a seat's
    // perfectly good answer over a race it cannot observe or avoid.
    const held = unkeyed("p1", 2);
    const result = plan(held, [{ cancel: "never-armed" }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([]);
    expect(result.replaced).toEqual([]);
    expect(applied(held, result)).toEqual(held);
  });

  it("reaches only THIS owner's key, so one player cannot forget another's timer", () => {
    const theirs = plan([], [{ delayMs: 60_000, key: "raid", action: "resolveRaid" }], "p2");
    const queue = applied([], theirs);

    const result = plan(queue, [{ cancel: "raid" }], "p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replaced).toEqual([]);
    expect(applied(queue, result)).toEqual(queue);
  });

  it("FREES the keyed budget, which is what makes the cap's advice true", () => {
    // `keyedScheduleRefusal` tells an author at the cap to cancel a timer they
    // no longer need. If a cancel did not release the key it named, that
    // sentence would still be false -- the author would do exactly as told and
    // be refused again in the same breath.
    const full = keyed("p1", WORLD_MAX_KEYED_PENDING_PER_PLAYER);
    const refused = plan(full, [{ delayMs: 5, key: "fresh", action: "tick" }]);
    expect(refused.ok).toBe(false);

    const result = plan(full, [
      { cancel: "k-0" },
      { delayMs: 5, key: "fresh", action: "tick" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replaced).toEqual([full[0]!.id]);
    expect(result.events.map((e) => e.key)).toEqual(["fresh"]);
  });

  it("FREES the world's own ceiling too, so a full queue is not a dead end", () => {
    const held = keyed("p1", 1);
    const refused = plan(held, [{ delayMs: 5, key: "fresh", action: "tick" }], "p1", {
      worldPending: WORLD_MAX_PENDING_EVENTS,
    });
    expect(refused.ok).toBe(false);

    const result = plan(
      held,
      [{ cancel: "k-0" }, { delayMs: 5, key: "fresh", action: "tick" }],
      "p1",
      { worldPending: WORLD_MAX_PENDING_EVENTS },
    );
    expect(result.ok).toBe(true);
  });

  it("takes back an event THIS SAME COMMAND armed, rather than planning a ghost", () => {
    // Arm-then-cancel in one handler. The planned event must not survive, and
    // the durable row it displaced must still be named once -- naming it twice
    // would ask the host to delete a key it has already deleted.
    const held = plan([], [{ delayMs: 1, key: "raid", action: "resolveRaid" }]);
    const queue = applied([], held);

    const result = plan(queue, [
      { delayMs: 60_000, key: "raid", action: "resolveRaid" },
      { cancel: "raid" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([]);
    expect(result.replaced).toEqual([queue[0]!.id]);
    expect(applied(queue, result)).toEqual([]);
  });

  it("re-arming after a cancel in one command leaves exactly one event", () => {
    const held = plan([], [{ delayMs: 1, key: "raid", action: "resolveRaid" }]);
    const queue = applied([], held);

    const result = plan(queue, [
      { cancel: "raid" },
      { delayMs: 60_000, key: "raid", action: "resolveRaid" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    expect(result.replaced).toEqual([queue[0]!.id]);
    expect(applied(queue, result)).toHaveLength(1);
  });

  it("charges a clock action's cancel to the WORLD, like its schedules", () => {
    const world = plan([], [{ delayMs: 1, key: "tick", action: "settle" }], null);
    const queue = applied([], world);
    expect(queue[0]!.owner).toBe(WORLD_OWNER);

    const result = plan(queue, [{ cancel: "tick" }], null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replaced).toEqual([queue[0]!.id]);
  });

  it("COUNTS AGAINST THE BATCH CAP, because the host still has to carry it", () => {
    // The batch cap bounds the ASKING rather than the queue -- a handler
    // looping a million times over one key writes no row and still hands the
    // host a million requests to walk. A cancel is one of those.
    const result = plan(
      [],
      Array.from({ length: WORLD_MAX_SCHEDULES_PER_COMMAND + 1 }, () => ({
        cancel: "raid",
      })),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("schedule-batch-cap");
  });

  it("REFUSES a cancel that names no key, at the offending line", () => {
    const result = plan([], [{ cancel: "" }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal.code).toBe("invalid-schedule-cancel");
    expect(result.refusal.message).toMatch(/name the key/i);
  });
});

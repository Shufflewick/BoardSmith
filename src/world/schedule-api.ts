/**
 * Issue #37 item 3: `ctx.schedule()` -- THE BUNDLE-FACING SCHEDULING API.
 *
 * Section 7 is precise about where this runs and why: in the PARENT Durable
 * Object, which "stamps the owner from the acting player, stamps arrival,
 * enforces caps and inserts, so the abusive path cannot reach the queue rather
 * than failing a check". `world-schedule.ts` already holds every decision --
 * the cap, the refusal and its wording. What did not exist was the surface a
 * bundle calls and the parent-side application of it. This is that.
 *
 * ## Why a handler REQUESTS rather than schedules
 *
 * A command runs in the child isolate (`world-runner.ts`), which has no
 * bindings and cannot reach the queue -- the queue is a key in the parent's
 * storage. So `ctx.schedule()` inside a handler records a REQUEST, the request
 * rides back with the command's result, and the parent applies it.
 *
 * That is not a workaround for the boundary; it is what section 7 asked for.
 * "The abusive path cannot reach the queue rather than failing a check" is a
 * statement that the parent is the only writer, and a child that can only ask
 * is exactly that property rather than a check it might forget to run.
 *
 * ## The owner is STAMPED, never claimed
 *
 * A request carries no owner. `planSchedules` stamps the acting player, so a
 * bundle cannot charge its events to somebody else's budget -- the whole cap
 * would be decorative if it could. A scheduled event that came due has no
 * acting player, so those are charged to the world itself under a reserved
 * owner, which closes the hole a self-re-arming unkeyed event would otherwise
 * open: it is the one path that can grow a queue with nobody to bill.
 *
 * ## Keyed upserts, and the cap they DO obey (#105)
 *
 * A keyed schedule REPLACES the pending event with the same owner and key, so
 * the count under one key never grows. That was read as "a keyed schedule can
 * never hit the cap" and written into this file as an early return for every
 * request carrying a key -- which left the number of DISTINCT keys an owner
 * may hold bounded by nothing, in a queue whose keys are chosen by game code.
 *
 * So there are four caps now, and the shape of them is one budget rather than
 * four conditions in a loop: how many unkeyed events an owner holds, how many
 * distinct keys an owner holds, how many events this world holds, and how many
 * one command may ask for. The upsert exemption survives exactly where it is
 * true -- a request under a key the owner ALREADY holds grows nothing, so it is
 * admitted at every one of those caps.
 */
import {
  keyedScheduleRefusal,
  scheduleBatchRefusal,
  unkeyedScheduleRefusal,
  worldQueueRefusal,
  type ScheduledEvent,
} from "./schedule.js";
import { worldRefusal, type WorldRefusal } from "./refusals.js";
import type { WorldBudgets } from "./budgets.js";

/**
 * The owner charged for an event nobody asked for: one that a DUE event's own
 * handler scheduled.
 *
 * Reserved rather than absent, so the cap has something to count against. An
 * unowned event would be uncapped, and a recurring handler that re-armed
 * itself without a key is precisely the shape that would then grow a queue
 * forever with no player to refuse.
 *
 * The colon is what makes it unforgeable: a platform user id never contains
 * one, so no player can be charged for the world's events and the world can
 * never be charged for theirs.
 */
export const WORLD_OWNER = "world:self";

/**
 * What a handler asks for when it calls `ctx.schedule()`.
 *
 * ## THE ENVELOPE IS NAMED, AND THERE IS NO `payload` (#89)
 *
 * This carried an opaque `payload` until 2026-08-28, documented as "the game's
 * own payload -- the platform never parses inside it", while
 * `world-session.ts:runEvent` read `payload.command` and `payload.args` out of
 * it on every drain. So the platform had two required fields inside a blob it
 * claimed not to look at, and a request that did not carry them --
 * `schedule({ delayMs: 8 * HOUR, payload: { raid: raid.name } })`, which is
 * exactly what "the game's own payload" invites -- bought a wake and did
 * nothing at all. No refusal, no log, and the queue advanced.
 *
 * The fields are named here instead, because the platform is the side that
 * decides them. A world's drain runs a COMMAND, the same dispatch a player's
 * frame reaches, and the only thing that was ever opaque is `args`.
 */
export interface ScheduleArm {
  /**
   * How far in the future, in milliseconds. Measured from the command's
   * ARRIVAL rather than from wall clock at application time, so a world that
   * drained late schedules the same instant a punctual one would.
   *
   * IT IS THE DELAY THE EVENT FIRES AT (#344). On a world somebody is
   * watching, the alarm is armed at this instant, however soon it is:
   * `delayMs: 30_000` lands at thirty seconds. There used to be a forty second
   * floor on every arm, and a thirty second raid landed at forty-four.
   *
   * `planSchedules` turns away a negative or non-finite delay and nothing
   * else.
   */
  readonly delayMs: number;
  /** Present for a keyed (upserting) schedule; absent for a one-shot. */
  readonly key?: string;
  /**
   * WHAT THE WORLD RUNS WHEN THIS COMES DUE: a name in the game's ONE registry
   * of things this world can be told to do.
   *
   * The same registry a player's frame reaches, and that is the whole design --
   * a scheduled event is the clock issuing one of the world's verbs, not a
   * second kind of thing a world can be told. Since #169 that registry is the
   * game's own action registry, which is why the field is `action` and no
   * longer `command`: a rename and not a concept, because what must not change
   * is that the clock and a player reach the same place.
   *
   * The action it names must be SEATLESS. A scheduled event has nobody acting,
   * and the drain refuses a name that belongs to a seat's verb rather than
   * inventing a player for it.
   */
  readonly action: string;
  /**
   * The action's own arguments, opaque to the platform. Absent means none.
   *
   * JSON SCALARS ONLY, AND NEVER AN ELEMENT REFERENCE (#169). A schedule row
   * outlives eviction and rehydration: a stored element id names an element
   * that may not be resident when the event comes due, or in the worst case one
   * that has been re-minted since. Pass the PARTITION NAME and let the action
   * look inside it, which is what every clock verb in the catalogue already
   * does -- so this codifies existing practice rather than constraining
   * anybody. Refused in `planSchedules`, beside the other shape refusals, so it
   * lands in the action and unwinds it.
   */
  readonly args?: Readonly<Record<string, unknown>>;
  /**
   * HOW OFTEN TO REPEAT, in milliseconds. Absent asks for a one-shot.
   *
   * `delayMs` is when the FIRST occurrence is due; `everyMs` is the gap between
   * every occurrence after it. The platform re-arms the recurrence itself, in
   * the same write that settles the occurrence it just ran, so a handler never
   * writes the re-arm and can never forget it -- which is the difference #127
   * is about. A handler that re-armed itself gave the parent one due time and
   * no interval, so a tick that fell three days behind could only be REPLAYED,
   * 72 handler calls and 72 rounds of notifications.
   *
   * IT COSTS ONE ROW, FOREVER, not one per occurrence: the drain replaces the
   * recurrence's own event rather than adding beside it, so a recurrence is
   * exactly one thing against every one of the four caps.
   *
   * EACH OCCURRENCE FIRES ON ITS OWN BEAT, because the re-arm that settles one
   * goes through the same `rearmAt` a fresh `delayMs` does and is armed at the
   * next occurrence's due. A world that was away for longer than the interval
   * is caught up in one wake -- `catchUpPlan` folds every occurrence that came
   * due, each still carrying its own `due`.
   */
  readonly everyMs?: number;
}

/**
 * TAKE BACK A KEYED TIMER THIS OWNER HOLDS (#177).
 *
 * ## Why this exists at all
 *
 * `keyedScheduleRefusal` and `unkeyedScheduleRefusal` have told an author to
 * "cancel a pending timer you no longer need" since the caps existed, and no
 * such verb was on this type. A refusal naming a remedy the API does not offer
 * is the trap this repo's own rule forbids, and it is the whole reason a
 * catalogue game hand-rolled a scheduler: a request could arm and re-arm and
 * never forget.
 *
 * ## KEYED THE WAY ARMING IS KEYED, and that is the anti-abuse property
 *
 * A pending event is addressed by `(owner, key)`, and the owner is STAMPED from
 * the acting seat rather than named by the request -- exactly as it is for an
 * arm. Read forwards that sentence says a bundle cannot charge its events to
 * somebody else's budget; read backwards it says a bundle cannot forget
 * somebody else's timer either, because it has no way to write one down.
 *
 * An UNKEYED event therefore cannot be cancelled, and that is not an omission:
 * it has no name, so there is nothing to address it by. It is also why the
 * unkeyed cap's first suggestion has always been to use a key -- a keyed timer
 * is the one you can take back.
 *
 * ## IDEMPOTENT, and it must be
 *
 * Cancelling a key nothing holds is a no-op rather than a refusal. The pattern
 * a keyed deadline exists for is "whoever arrives first clears the obligation;
 * the loser finds it cleared and returns", and the loser is precisely the
 * caller whose timer has already fired. A handler cannot read the queue -- the
 * queue is the host's -- so refusing here would unwind a seat's perfectly good
 * answer over a race it can neither observe nor avoid.
 */
export interface ScheduleCancel {
  /** The key the timer was armed under. This owner's; there is no other. */
  readonly cancel: string;
}

/**
 * What one handler asked the host to do to the queue: arm something, or forget
 * something.
 *
 * ONE ORDERED LIST AND NOT TWO, because the order is load-bearing within a
 * single command: cancel-then-arm under one key leaves a timer, and
 * arm-then-cancel leaves none. Two lists would make that depend on which the
 * host walked first, which is the kind of difference that shows up as one world
 * diverging from another months later.
 */
export type ScheduleRequest = ScheduleArm | ScheduleCancel;

/** Whether this request forgets a timer rather than arming one. */
function isCancel(request: ScheduleRequest): request is ScheduleCancel {
  return "cancel" in request;
}

/**
 * One queued event, as `world-session.ts` stores it.
 *
 * `args` is always present and never `undefined`, so a drain never has to tell
 * "no arguments" from "arguments I could not see".
 */
export interface PlannedEvent extends ScheduledEvent {
  id: string;
  attempts: number;
  action: string;
  args: Readonly<Record<string, unknown>>;
  /**
   * WHOSE BUDGET THIS EVENT IS CHARGED TO, and it is never absent.
   *
   * `ScheduledEvent` leaves it optional because the pure policy is asked about
   * events that have not been planned yet. A PLANNED one always has an owner:
   * the acting player, or `WORLD_OWNER` for the clock's own work. An unowned
   * event is an event no cap counts, and this narrowing is what makes that
   * unrepresentable rather than merely avoided (#142).
   */
  owner: string;
}

/**
 * What the parent should do with a command's schedule requests.
 *
 * A refusal REPLACES the whole batch rather than applying some of it. A
 * command whose third schedule was refused must not leave the first two
 * behind: the handler ran to completion believing all three were taken, and a
 * world holding two of them is a state the bundle never anticipated.
 *
 * `replaced` are the STORAGE KEYS a keyed upsert displaced. They are answered
 * rather than left for the caller to work out, because a keyed schedule that
 * added beside its predecessor instead of replacing it would make "its count
 * never grows" -- the exemption the whole cap rests on -- a lie.
 */
// Reachable without being exported: a caller gets one back from
// `planSchedules` and TypeScript checks it structurally, the same way
// `world-engine-boardsmith.ts` keeps its handler types unexported. A name
// nothing imports is a public surface larger than its callers.
type SchedulePlan =
  | {
      readonly ok: true;
      readonly events: readonly PlannedEvent[];
      readonly replaced: readonly string[];
    }
  | { readonly ok: false; readonly refusal: WorldRefusal };

/**
 * Apply one command's schedule requests to the queue.
 *
 * Pure, and every input is explicit -- `arrivedAt`, `nextSeq`, the id minter,
 * the allowance and the keyed lookup are all passed rather than read, because a
 * scheduling decision that depended on the wall clock, a random id or a storage
 * read could not be tested for the property that matters: that the same command
 * against the same queue plans the same events.
 *
 * ## It is told ABOUT the queue rather than handed it (#74)
 *
 * The queue is one storage key per event, so there is no whole-queue value to
 * pass and reading one would be O(queue) per scheduling command -- in a world
 * whose players each hold dozens of pending events, that is thousands of rows
 * to insert one. So the caller supplies the facts a plan actually needs: the
 * `ScheduleAllowance` below, and where the pending event for a given key
 * lives. Every one of them is a bounded list or a point read on the caller's
 * side -- including the world's own depth, which is a counter for the one
 * reason the per-owner counts are not: at the world's ceiling, counting rows
 * would be the O(queue) read this layout exists to remove.
 *
 * ## `arrivedAt` and not `Date.now()`
 *
 * The same reason a drained event's handler receives its scheduled `due`: a
 * world that woke late must not schedule everything late in turn, or a parked
 * world drifts a little further from its own clock at every wake. It is the
 * same instant the bundle read as `ctx.now` (#57), so both halves of a timer
 * are measured from one clock.
 */
export function planSchedules(
  requests: readonly ScheduleRequest[],
  context: {
    readonly owner: string | null;
    readonly arrivedAt: number;
    readonly nextSeq: number;
    readonly mintId: (index: number) => string;
    /** What this owner, and this world, already hold pending. */
    readonly allowance: ScheduleAllowance;
    /** THE CEILINGS THIS HOST RUNS. Passed rather than read, so a laptop and a
     *  hosting platform cannot silently disagree about what a world admits. */
    readonly budgets: WorldBudgets;
    /** The storage key of this owner's pending event under `key`, if any. */
    readonly replaces: (key: string) => string | undefined;
  },
): SchedulePlan {
  // A player's events are charged to them; a due event's own schedules are
  // charged to the world. Never to whoever happened to act last.
  const owner = context.owner ?? WORLD_OWNER;

  // A HOLE FOR AN EVENT THIS BATCH TOOK BACK. `plannedByKey` indexes into this
  // list, so a cancel blanks its entry rather than splicing it out and sliding
  // every later key's index one to the left.
  const planned: Array<PlannedEvent | null> = [];
  // The durable rows this batch displaces, as a SET: an arm and a later cancel
  // under one key both name the same row, and asking the host twice to delete
  // one key is asking it to delete a key it has already deleted.
  const replaced = new Set<string>();
  // Which planned event this batch has already made for a key, so two requests
  // under one key upsert against each other rather than both landing.
  const plannedByKey = new Map<string, number>();
  let seq = context.nextSeq;
  const budget = scheduleBudget(owner, context.allowance, context.budgets);

  for (const [index, request] of requests.entries()) {
    const refusal = budget.admit(request);
    if (refusal !== null) return { ok: false, refusal };

    if (isCancel(request)) forget(request.cancel);
    else arm(request, index);
  }

  return {
    ok: true,
    events: planned.filter((event): event is PlannedEvent => event !== null),
    replaced: [...replaced],
  };

  /** Mint one event and put it where a later request under its key can find
   *  it. */
  function arm(request: ScheduleArm, index: number): void {
    const armed: PlannedEvent = {
      id: context.mintId(index),
      due: context.arrivedAt + request.delayMs,
      seq: seq++,
      attempts: 0,
      action: request.action,
      args: request.args ?? {},
      owner,
      ...(request.key === undefined ? {} : { key: request.key }),
      // THE INTERVAL TRAVELS WITH THE EVENT (#127). It is what the drain reads
      // to tell a recurrence that fell behind from a pile of unrelated
      // one-shots, and the only thing `catchUpPlan` cannot be computed without.
      ...(request.everyMs === undefined ? {} : { everyMs: request.everyMs }),
    };

    if (request.key === undefined) {
      planned.push(armed);
      return;
    }

    // A KEYED schedule UPSERTS. Against this batch it replaces in place;
    // against the queue it names the storage key the caller must delete. Two
    // events with one key is what "its count never grows" forbids.
    const already = plannedByKey.get(request.key);
    if (already !== undefined) {
      planned[already] = armed;
      return;
    }
    const durable = context.replaces(request.key);
    if (durable !== undefined) replaced.add(durable);
    plannedByKey.set(request.key, planned.length);
    planned.push(armed);
  }

  /**
   * Take back what this batch armed under `key`, and name what the queue holds
   * under it.
   *
   * BOTH, because a command may have armed under this key a line ago: the
   * planned event has to go, and so does the durable row that arming already
   * displaced.
   */
  function forget(key: string): void {
    const mine = plannedByKey.get(key);
    if (mine !== undefined) {
      planned[mine] = null;
      plannedByKey.delete(key);
    }
    const durable = context.replaces(key);
    if (durable !== undefined) replaced.add(durable);
  }
}

/**
 * WHAT THE QUEUE ALREADY HOLDS, as the caps need to see it (#56, #105).
 *
 * DATA AND NOT A QUERY, because this crosses the isolate boundary: the parent
 * reads it out of the queue's two index prefixes and its own depth counter,
 * and sends it down with the command so `ctx.schedule()` can refuse AT THE
 * OFFENDING LINE, where #68's rollback then leaves the world unchanged. The
 * parent re-plans everything the child returns before it writes a single event
 * -- the child is game code and is not believed about a quota, it is merely
 * told the numbers so it can fail early and honestly.
 *
 * `keys` is a LIST rather than a count because the caps turn on a question a
 * count cannot answer: whether a request under this key REPLACES something the
 * owner already holds, which is admitted at the cap, or adds a new one, which
 * is not. It is bounded by the keyed cap plus one, which is what the parent
 * lists.
 */
export interface ScheduleAllowance {
  /** How many UNKEYED events this owner already has pending. */
  readonly unkeyed: number;
  /** The KEYS this owner already has pending. */
  readonly keys: readonly string[];
  /** How many events this WORLD holds pending, across every owner. */
  readonly worldPending: number;
}

/**
 * One command's schedule budget: what it may still ask for, given what the
 * queue already holds.
 *
 * ADMITTING RECORDS THE TAKE, which is the whole reason this is an object and
 * not four comparisons. Requests are not durable until the parent writes them,
 * so a command that asked for the cap's worth twice in one breath would land
 * the lot if each request were judged against the same starting numbers -- and
 * both sides of the isolate boundary would have to remember to count for
 * themselves, in the same way, forever. One of them forgetting is exactly the
 * bug #105 is.
 */
// Reachable without being exported: a caller gets one back from
// `scheduleBudget` and TypeScript checks it structurally, the same way
// `SchedulePlan` above is reached. A name nothing imports is a public surface
// larger than its callers.
interface ScheduleBudget {
  /** Whether one more request may be admitted, or the refusal explaining it.
   *  An admitted request is charged to the budget before this returns. */
  admit(request: ScheduleRequest): WorldRefusal | null;
}

/**
 * Open a budget for one command, over what this owner and this world hold.
 *
 * Used by BOTH sides of the isolate boundary, and for different reasons.
 * `planSchedules` in the PARENT is the authority -- the parent is the only
 * writer, which is section 7's "the abusive path cannot reach the queue rather
 * than failing a check". `ctx.schedule()` in the CHILD opens one per command so
 * the refusal is raised inside the handler, where the rollback unwinds it: the
 * player is told no and the world is unchanged. Refusing only in the parent
 * would leave a command that ran, changed the world, and had its timers
 * dropped.
 */
export function scheduleBudget(
  owner: string,
  allowance: ScheduleAllowance,
  budgets: WorldBudgets,
): ScheduleBudget {
  // The owner's pending keys, plus the ones this command has minted so far. A
  // set, because the only question asked of it is membership -- does this
  // request REPLACE something, or add to the queue?
  const keys = new Set(allowance.keys);
  let unkeyed = allowance.unkeyed;
  let worldPending = allowance.worldPending;
  let requested = 0;

  return {
    admit(request: ScheduleRequest): WorldRefusal | null {
      const refusal = refuse(request);
      if (refusal !== null) return refusal;

      requested += 1;
      // A CANCEL RELEASES, WHICH IS WHAT MAKES THE CAPS' ADVICE TRUE. Both cap
      // refusals tell an author to cancel a timer they no longer need; a cancel
      // that did not give the key back would leave them refused again in the
      // same breath, having done exactly as they were told.
      if (isCancel(request)) {
        if (keys.delete(request.cancel)) worldPending -= 1;
        return null;
      }
      // AN UPSERT COSTS NOTHING. A request under a key the owner already holds
      // replaces the pending event, so neither the owner's count nor the
      // world's depth moves -- which is the exemption keys are worth having
      // for, kept exactly where it is true.
      if (request.key === undefined) {
        unkeyed += 1;
        worldPending += 1;
      } else if (!keys.has(request.key)) {
        keys.add(request.key);
        worldPending += 1;
      }
      return null;
    },
  };

  function refuse(request: ScheduleRequest): WorldRefusal | null {
    const malformed = shapeRefusal(request);
    if (malformed !== null) return malformed;

    // A CANCEL PASSES EVERY DEPTH CAP, because it only ever makes the queue
    // shallower. It still reaches the batch cap: that one bounds the ASKING,
    // and a handler looping a million times over one cancel writes no row and
    // still hands the host a million requests to carry and walk.
    if (isCancel(request)) return batchRefusal();

    // AN UPSERT IS ADMITTED BY EVERY DEPTH CAP. It replaces a pending event
    // rather than adding one, so nothing those caps measure moves -- and a cap
    // that refused it would strand a full world with no way to re-arm the
    // timers it already holds.
    const upsert = request.key !== undefined && keys.has(request.key);
    const deep = upsert ? null : depthRefusal(request);
    if (deep !== null) return deep;

    // THE BATCH CAP LAST, AND IT BINDS UPSERTS TOO -- it is the only one that
    // does, because it bounds the ASKING rather than the queue: a handler
    // looping a million times over one key writes a single row and still hands
    // the parent a million requests to carry and walk.
    //
    // Last, because it is the least specific thing that can be wrong. A command
    // asking for 33 one-shots is over the batch cap AND over the player's
    // unkeyed cap at the same request, and "you already hold 32 unkeyed events,
    // use a key" is the sentence that tells its author what to change -- #35's
    // single refusal has to stay reachable from one command.
    return batchRefusal();
  }

  /** The one cap every request reaches, arm or cancel. */
  function batchRefusal(): WorldRefusal | null {
    const batched = scheduleBatchRefusal(requested, budgets.maxSchedulesPerCommand);
    return batched === null ? null : worldRefusal("schedule-batch-cap", batched);
  }

  /** The three caps that are about how deep a queue is, asked only of a request
   *  that would actually make it deeper. */
  function depthRefusal(request: ScheduleArm): WorldRefusal | null {
    const full = worldQueueRefusal(worldPending, budgets.maxPendingEvents);
    if (full !== null) return worldRefusal("schedule-world-cap", full);

    if (request.key !== undefined) {
      const capped = keyedScheduleRefusal(keys.size, owner, budgets.maxKeyedPendingPerPlayer);
      return capped === null ? null : worldRefusal("schedule-key-cap", capped);
    }
    const capped = unkeyedScheduleRefusal(unkeyed, owner, budgets.maxUnkeyedPendingPerPlayer);
    return capped === null ? null : worldRefusal("schedule-cap", capped);
  }
}

/**
 * What is wrong with the REQUEST ITSELF, before any cap is consulted.
 *
 * Refused here rather than discovered on the drain, so the handler unwinds and
 * the world is unchanged -- the same place and the same moment a cap is
 * refused, for the same reason.
 */
function shapeRefusal(request: ScheduleRequest): WorldRefusal | null {
  if (isCancel(request)) return cancelShapeRefusal(request);
  return (
    actionRefusal(request) ??
    argumentRefusal(request) ??
    intervalRefusal(request) ??
    delayRefusal(request)
  );
}

/** A WAKE THAT RUNS NOTHING IS THE ONE THING A SCHEDULE MUST NOT BUY (#89). */
function actionRefusal(request: ScheduleArm): WorldRefusal | null {
  if (typeof request.action === "string" && request.action.length > 0) return null;
  return worldRefusal(
    "invalid-schedule-command",
    "A scheduled event must name the action the world runs when it comes due, and this one " +
      `named ${JSON.stringify((request as { action?: unknown }).action)}. Write ` +
      "`schedule({ delayMs, action: \"resolveRaid\", args: { raid: raid.name } })` -- the " +
      "arguments are yours, the action name is how the world knows what to do with them.",
  );
}

/** ARGUMENTS THAT SURVIVE A HIBERNATION, AND NOTHING ELSE (#169). */
function argumentRefusal(request: ScheduleArm): WorldRefusal | null {
  const unstorable = unstorableArg(request.args);
  if (unstorable === null) return null;
  return worldRefusal(
    "invalid-schedule-command",
    `A scheduled event's "${unstorable}" argument is not a JSON scalar. A schedule row ` +
      "outlives eviction and rehydration, so an element -- or anything holding one -- names " +
      "something that may not be resident when the event comes due, and may have been " +
      "re-minted since. Pass the partition's NAME and let the action read inside it.",
  );
}

/**
 * A RECURRENCE WITH NO GAP IS A WAKE THAT RE-ARMS INSTANTLY, FOREVER (#127).
 *
 * Refused here so it lands in the handler like every other schedule refusal,
 * rather than as a throw out of `catchUpPlan` on some later drain -- which is a
 * platform-owned failure, and would climb the park ladder for a bundle's typo.
 */
function intervalRefusal(request: ScheduleArm): WorldRefusal | null {
  if (request.everyMs === undefined) return null;
  if (Number.isFinite(request.everyMs) && request.everyMs > 0) return null;
  return worldRefusal(
    "invalid-schedule-interval",
    `A recurring schedule repeats every \`everyMs\` milliseconds, and this one asked for ` +
      `${JSON.stringify(request.everyMs)}. An interval must be a positive number of ` +
      `milliseconds: write \`schedule({ delayMs: HOUR, everyMs: HOUR, key: "tick", ` +
      `action: "collectIncome" })\` for an hourly tick, or leave \`everyMs\` off entirely ` +
      `for a one-shot.`,
  );
}

/** A delay the clock cannot reach forwards. */
function delayRefusal(request: ScheduleArm): WorldRefusal | null {
  if (Number.isFinite(request.delayMs) && request.delayMs >= 0) return null;
  return worldRefusal(
    "invalid-schedule-delay",
    `A schedule needs a delay of zero or more milliseconds, and got ` +
      `${JSON.stringify(request.delayMs)}. To make something happen now, do it now; ` +
      `to make it happen in the past, it already did.`,
  );
}

/**
 * What is wrong with a CANCEL, which addresses exactly one thing: a key.
 *
 * There is nothing else on it to be wrong. A cancel of a key nothing holds is
 * NOT refused here -- that is a no-op, deliberately, because the queue is the
 * host's and a handler cannot read it to know whether its timer has already
 * fired.
 */
function cancelShapeRefusal(request: ScheduleCancel): WorldRefusal | null {
  if (typeof request.cancel === "string" && request.cancel.length > 0) return null;
  return worldRefusal(
    "invalid-schedule-cancel",
    "A cancel must name the key its timer was armed under, and this one named " +
      `${JSON.stringify(request.cancel)}. A cancel is keyed the way arming is keyed -- ` +
      'write `cancel("raid")` for the timer you armed as ' +
      '`schedule({ delayMs, key: "raid", action: "resolveRaid" })`. An UNKEYED event ' +
      "cannot be cancelled, because it has no name to address it by.",
  );
}

/**
 * The name of the first argument a schedule row could not survive, or null.
 *
 * Scalars and null are storable; everything else -- an element, an array, a
 * nested object, a function, a `Date` -- either loses its identity through
 * `JSON.stringify` or names something whose residency is a fact about a
 * different moment. Nested containers are refused rather than walked, because
 * an argument list a person has to reason about recursively is one they will
 * eventually get wrong.
 */
function unstorableArg(args: Readonly<Record<string, unknown>> | undefined): string | null {
  if (args === undefined) return null;
  for (const [name, value] of Object.entries(args)) {
    if (value === null) continue;
    const type = typeof value;
    if (type === "string" || type === "boolean") continue;
    if (type === "number" && Number.isFinite(value as number)) continue;
    return name;
  }
  return null;
}

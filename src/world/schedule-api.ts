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
export interface ScheduleRequest {
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
   * second kind of thing a world can be told. Today the registry is
   * `world.commands`; under Actions it is the game's action registry and this
   * field is named `action` (#169). A rename, deliberately, and not a concept:
   * what must not change is that the clock and a player reach the same table.
   */
  readonly command: string;
  /** The command's own arguments, opaque to the platform. Absent means none. */
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
 * One queued event, as `world-session.ts` stores it.
 *
 * `args` is always present and never `undefined`, so a drain never has to tell
 * "no arguments" from "arguments I could not see".
 */
export interface PlannedEvent extends ScheduledEvent {
  id: string;
  attempts: number;
  command: string;
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

  const events: PlannedEvent[] = [];
  const replaced: string[] = [];
  // Which planned event this batch has already made for a key, so two requests
  // under one key upsert against each other rather than both landing.
  const plannedByKey = new Map<string, number>();
  let seq = context.nextSeq;
  const budget = scheduleBudget(owner, context.allowance, context.budgets);

  for (const [index, request] of requests.entries()) {
    const refusal = budget.admit(request);
    if (refusal !== null) return { ok: false, refusal };

    const planned: PlannedEvent = {
      id: context.mintId(index),
      due: context.arrivedAt + request.delayMs,
      seq: seq++,
      attempts: 0,
      command: request.command,
      args: request.args ?? {},
      owner,
      ...(request.key === undefined ? {} : { key: request.key }),
      // THE INTERVAL TRAVELS WITH THE EVENT (#127). It is what the drain reads
      // to tell a recurrence that fell behind from a pile of unrelated
      // one-shots, and the only thing `catchUpPlan` cannot be computed without.
      ...(request.everyMs === undefined ? {} : { everyMs: request.everyMs }),
    };

    if (request.key === undefined) {
      events.push(planned);
      continue;
    }

    // A KEYED schedule UPSERTS. Against this batch it replaces in place;
    // against the queue it names the storage key the caller must delete. Two
    // events with one key is what "its count never grows" forbids.
    const already = plannedByKey.get(request.key);
    if (already !== undefined) {
      events[already] = planned;
      continue;
    }
    const durable = context.replaces(request.key);
    if (durable !== undefined) replaced.push(durable);
    plannedByKey.set(request.key, events.length);
    events.push(planned);
  }

  return { ok: true, events, replaced };
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
    const batched = scheduleBatchRefusal(requested, budgets.maxSchedulesPerCommand);
    return batched === null ? null : worldRefusal("schedule-batch-cap", batched);
  }

  /** The three caps that are about how deep a queue is, asked only of a request
   *  that would actually make it deeper. */
  function depthRefusal(request: ScheduleRequest): WorldRefusal | null {
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
  // A WAKE THAT RUNS NOTHING IS THE ONE THING A SCHEDULE MUST NOT BUY (#89).
  if (typeof request.command !== "string" || request.command.length === 0) {
    return worldRefusal(
      "invalid-schedule-command",
      "A scheduled event must name the command the world runs when it comes due, and this one " +
        `named ${JSON.stringify((request as { command?: unknown }).command)}. Write ` +
        "`schedule({ delayMs, command: \"resolveRaid\", args: { raid: raid.name } })` -- the " +
        "arguments are yours, the command name is how the world knows what to do with them.",
    );
  }
  // A RECURRENCE WITH NO GAP IS A WAKE THAT RE-ARMS INSTANTLY, FOREVER (#127).
  // Refused here so it lands in the handler like every other schedule refusal,
  // rather than as a throw out of `catchUpPlan` on some later drain -- which is
  // a platform-owned failure, and would climb the park ladder for a bundle's
  // typo.
  if (
    request.everyMs !== undefined &&
    (!Number.isFinite(request.everyMs) || request.everyMs <= 0)
  ) {
    return worldRefusal(
      "invalid-schedule-interval",
      `A recurring schedule repeats every \`everyMs\` milliseconds, and this one asked for ` +
        `${JSON.stringify(request.everyMs)}. An interval must be a positive number of ` +
        `milliseconds: write \`schedule({ delayMs: HOUR, everyMs: HOUR, key: "tick", ` +
        `command: "collectIncome" })\` for an hourly tick, or leave \`everyMs\` off entirely ` +
        `for a one-shot.`,
    );
  }
  if (!Number.isFinite(request.delayMs) || request.delayMs < 0) {
    return worldRefusal(
      "invalid-schedule-delay",
      `A schedule needs a delay of zero or more milliseconds, and got ` +
        `${JSON.stringify(request.delayMs)}. To make something happen now, do it now; ` +
        `to make it happen in the past, it already did.`,
    );
  }
  return null;
}

/**
 * THE SCHEDULING POLICY OF A RESIDENT WORLD.
 *
 * The primitive is the SCHEDULED EVENT. There is no tick: a recurring tick is
 * ONE event carrying its own interval, drift-free because every occurrence is
 * computed from the scheduled `due` rather than from `now`. It was a handler
 * that re-scheduled itself once, which left the host holding one due time and
 * no interval -- so a tick that fell three days behind could only be replayed,
 * and `catchUpPlan` below had nothing to compute a plan from.
 *
 * This module is the DECISION half: which events drain, in what order, when the
 * next wake is armed, what happens to a recurrence that missed three days, and
 * what a bundle can be refused for. The STORAGE half -- the due-time index, the
 * alarm or timer that actually fires, the same-transaction delete -- is the
 * host's, and is deliberately not here. So is the CPU budget one drain may
 * spend: how long a host may hold its world lock is a fact about that host's
 * runtime, not about the game.
 *
 * ## Every function here is pure
 *
 * Driving this policy needs no Durable Object, no alarm and no wall clock, and
 * that is what lets one set of tests hold the same behaviour true of a laptop
 * host and a hosting platform. Every ceiling arrives as an argument from
 * `WorldBudgets` rather than as a module constant, for the same reason: a
 * ceiling that could be read without being passed is one two hosts can silently
 * disagree about.
 *
 * ## What is deliberately NOT decided here
 *
 * Whether an effect should be a scheduled event at all. That is the lazy/eager
 * rule, and no host can classify it, because no host parses game data. What the
 * library does instead is make lazy the easy path: lazy needs no API, while
 * eager takes an explicit budgeted call. So there is no `shouldSchedule` in
 * this file, and there must not be one.
 */

/** One scheduled event, as the queue orders it. */
export interface ScheduledEvent {
  /** When it became due, in epoch ms. Handlers receive THIS, never `now`. */
  due: number;
  /** Monotonic insertion order, breaking ties within one millisecond. */
  seq: number;
  /** Present for a keyed (upserting) schedule; absent for a one-shot. */
  key?: string;
  /** The player whose budget this event is charged to, if any. */
  owner?: string;
  /**
   * HOW OFTEN THIS EVENT REPEATS, in milliseconds. Absent for a one-shot.
   *
   * RECURRENCE IS A SCHEDULE SHAPE AND NOT A HANDLER PATTERN (#127). The
   * documented tick used to be "one event whose handler re-schedules itself",
   * and the parent therefore held one due time and nothing else -- so it could
   * not tell a tick that fell three days behind from 73 unrelated events, and
   * `catchUpPlan` below had no input to compute a plan from. It ran every
   * missed iteration, one handler call and one round of notifications each.
   *
   * The interval lives in the stored event instead, which is what lets the
   * drain integrate. The parent re-arms the recurrence itself, in the same
   * write that settles the occurrence it just ran, so a handler never has to
   * re-arm and can never forget to.
   */
  everyMs?: number;
}

/**
 * The next batch to run, and whether the queue is still behind afterwards.
 *
 * ORDER IS `(due, seq)` AND NOT `due` ALONE. Two events scheduled in the same
 * millisecond are ordered by insertion, so a world's behaviour does not depend
 * on how a storage engine happens to return ties -- which is the kind of
 * difference that shows up as one world diverging from another months later.
 *
 * `behind` is what the caller re-arms on: #35 says "if more remain due, re-arm
 * to now -- overload degrades to latency, never refusal". It is returned
 * rather than re-derived so the caller cannot forget to ask.
 *
 * An event exactly AT `now` is due. A due time is the moment it becomes true,
 * not the moment after.
 */
export function nextDueBatch<E extends ScheduledEvent>(
  events: readonly E[],
  now: number,
  batchSize: number,
): { batch: E[]; behind: boolean } {
  const due = events
    .filter((e) => e.due <= now)
    .sort((a, b) => (a.due === b.due ? a.seq - b.seq : a.due - b.due));
  return { batch: due.slice(0, batchSize), behind: due.length > batchSize };
}

/**
 * When the next alarm should fire, given what is queued.
 *
 * `events` is what the caller can cheaply know about the queue: its earliest
 * event, and the earliest event due after `now` when the first is already
 * past. Handing the whole queue is equivalent and is not a point read.
 *
 *   NOTHING QUEUED -> null. There is nothing to arm FOR, and #35's wake-abuse
 *     guard depends on this: an unoccupied world "deletes its Cloudflare alarm
 *     entirely" so there is nothing armed to fire.
 *   A TIMER STILL TO COME -> its own due, however soon that is (#344). This is
 *     the whole of the timer contract: `ctx.schedule({ delayMs: 30_000 })`
 *     lands at thirty seconds. There used to be a forty second floor on every
 *     arm, quoted from #35 section 7's minimum re-arm, and it bound this first
 *     arm exactly as hard as a re-arm after a busy drain -- so the platform's
 *     own reference game promised a thirty second march to the player and
 *     delivered it at forty-four. The floor is gone rather than documented.
 *   OVERDUE WORK -> now, or `retryAt` if the drain named one. Due work that a
 *     drain stopped short of on its budget is armed for now: "overload
 *     degrades to latency, never refusal". Due work that a drain TRIED and
 *     could not run -- a quarantined event staying queued with its attempt
 *     count raised, or one the bundle store did not answer for (#278) -- stays
 *     at its own due, already past, and arming now for it would attempt it as
 *     fast as the runtime delivers alarms. The drain says when it may next be
 *     tried, and only the overdue work waits for that: a fresh timer beside a
 *     retry is armed at its own due, because the wait is the failing event's
 *     and nobody else's.
 *
 * `retryAt` is never before `now`: a wait the clock has already passed is now.
 *
 * A RECURRENCE THAT FELL BEHIND DOES NOT GRIND THROUGH RETRIES ONE OCCURRENCE
 * AT A TIME (#135): `catchUpPlan` is wired into the drain, so a behind
 * recurrence is spent in ONE wake.
 */
export function rearmAt(
  events: readonly ScheduledEvent[],
  now: number,
  retryAt: number = now,
): number | null {
  if (events.length === 0) return null;
  const overdueAt = Math.max(now, retryAt);
  return Math.min(...events.map((e) => (e.due > now ? e.due : overdueAt)));
}

/**
 * How a RECURRING event that fell behind should be run: some real iterations,
 * then one coalesced call carrying how many were folded into it.
 *
 * DRIFT-FREE BY CONSTRUCTION. Each iteration's `due` is computed from the
 * FIRST scheduled due plus a whole number of intervals, never from `now` --
 * which is #35's stated reason a tick needs no special machinery: it re-arms
 * from its scheduled `due` rather than from `now`.
 *
 * A host's drain is the caller, through `occurrencesDue` below.
 *
 * The coalesced call carries `missedCount` so the game can integrate rather
 * than replay -- a resource that accrues per hour multiplies, where replaying
 * would run the handler 72 times for three missed days.
 *
 * `missedCount` IS HOW MANY OCCURRENCES GOT NO CALL OF THEIR OWN, and the
 * coalesced call is NOT one of them -- it is an occurrence that ran, carrying
 * the ones that did not. So a handler integrates with `1 + timing.missedCount`
 * and the arithmetic closes: `maxReal` real iterations, plus the coalesced one,
 * plus its `missedCount`, is every occurrence that was due.
 *
 * That reading is the field's own name, and it is why the count is not simply
 * "everything past the real iterations": a handler written as `1 + missedCount`
 * against that would have charged one hour twice.
 *
 * `missedCount` is 0 on every real iteration, so a handler that ignores the
 * field entirely still behaves correctly for the common case of nothing having
 * been missed -- and for a world that came back only one occurrence late, which
 * is folded into nothing because there is nothing to fold.
 */
export function catchUpPlan(
  firstDue: number,
  intervalMs: number,
  now: number,
  maxReal: number,
): Array<{ due: number; missedCount: number }> {
  if (intervalMs <= 0) throw new Error("A recurring event's interval must be positive.");
  if (firstDue > now) return [];

  // How many occurrences are due, counting the first.
  const total = Math.floor((now - firstDue) / intervalMs) + 1;
  const real = Math.min(total, maxReal);

  const plan = Array.from({ length: real }, (_, i) => ({
    due: firstDue + i * intervalMs,
    missedCount: 0,
  }));
  if (total <= maxReal) return plan;

  // Everything past the real iterations becomes ONE call, stamped with the due
  // time of the LAST occurrence it stands for -- the world's clock is where the
  // world actually is, not where the catch-up started.
  //
  // MINUS ONE, because that call IS the last occurrence rather than a summary
  // of it. What it carries is how many got no call at all.
  const folded = total - real - 1;
  plan.push({ due: firstDue + (total - 1) * intervalMs, missedCount: folded });
  return plan;
}

/**
 * THE DUE A RETRY MUST CARRY so the fold is not lost (#155, #178).
 *
 * The INVERSE of `catchUpPlan`'s fold. That function turns a stored due into
 * occurrences; this turns one of those occurrences back into the due a host
 * must stamp its retry row with, when the occurrence failed and the host means
 * to try it again.
 *
 * ## Why the answer is not simply the occurrence's own due
 *
 * A coalesced call's `missedCount` exists nowhere but in the in-memory plan
 * that produced it, and a retry recomputes its plan from the stored row. So a
 * retry stamped at the coalesced call's own due -- the LAST occurrence it
 * stands for -- recomputes to one occurrence carrying nothing, and one
 * transient failure durably erases everything the call was carrying, with no
 * error anywhere.
 *
 * Stamped at the FIRST occurrence it stood for, recomputation regenerates
 * exactly what is still owed: the real occurrences before it ran atomically and
 * stand, and every folded one is at or after the recovered instant.
 *
 * ## It lives here rather than in a host
 *
 * Both hosts retry, and recurrence arithmetic in two places is precisely the
 * drift that made a world's local behaviour a poor guide to its published
 * behaviour. This is the one rule on the retry path that is a fact about the
 * SCHEDULE rather than about a host's lifecycle policy, and it has to agree
 * with `catchUpPlan` -- so it is compiled against it rather than held beside it
 * by a comment.
 *
 * `intervalMs` is the event's own `everyMs`, absent for a one-shot. A one-shot
 * cannot fold, so its answer is its own due and needs no interval; a fold
 * WITHOUT an interval is a contradiction and throws rather than guessing one.
 */
export function resumeDueOf(
  occurrence: { readonly due: number; readonly missedCount: number },
  intervalMs: number | undefined,
): number {
  if (occurrence.missedCount === 0) return occurrence.due;
  if (intervalMs === undefined) {
    throw new Error(
      "A one-shot event cannot fold, so it cannot be resumed from a folded occurrence: " +
        `only a recurrence can fold, and this occurrence claims ${occurrence.missedCount} ` +
        "missed with no interval to unwind them.",
    );
  }
  if (intervalMs <= 0) throw new Error("A recurring event's interval must be positive.");
  return occurrence.due - occurrence.missedCount * intervalMs;
}

/**
 * HOW ONE DUE EVENT SHOULD ACTUALLY BE RUN, and where its recurrence goes next.
 *
 * The drain's whole view of the difference between a one-shot and a recurrence
 * (#127). A one-shot is one call at its own `due` and then it is gone; a
 * recurrence is `catchUpPlan`'s schedule, and a `nextDue` for the parent to
 * re-arm in the same write that settles what it just ran.
 *
 * `nextDue` is the occurrence AFTER the last one this plan runs -- including
 * the ones the coalesced call stood for -- so a world 73 hours behind comes out
 * of one wake armed for hour 74 and not for hour 5. That is the difference
 * between a wake and 69 of them.
 *
 * A recurrence whose `due` is still in the future is answered as ONE call at
 * that due, which the drain cannot reach (it only ever runs what `nextDueBatch`
 * returned) but which keeps this total: a function that answered an empty plan
 * for an event the caller is holding would make "run every occurrence this
 * returns" silently wrong at the one input nobody tests.
 */
export function occurrencesDue(
  event: ScheduledEvent,
  now: number,
  maxReal: number,
): { occurrences: Array<{ due: number; missedCount: number }>; nextDue: number | null } {
  const interval = event.everyMs;
  if (interval === undefined) {
    return { occurrences: [{ due: event.due, missedCount: 0 }], nextDue: null };
  }
  const plan = catchUpPlan(event.due, interval, now, maxReal);
  const last = plan.at(-1);
  if (last === undefined) {
    return { occurrences: [{ due: event.due, missedCount: 0 }], nextDue: event.due + interval };
  }
  return { occurrences: plan, nextDue: last.due + interval };
}

/**
 * Whether one more UNKEYED event may be scheduled for this player, or the
 * refusal that names the three ways forward.
 *
 * THE ONLY REFUSAL IN THE DESIGN, and it is shaped so that a bundle doing
 * anything reasonable can never see it. #35 is precise about the alternatives
 * it must name -- "use a key (upsert, count never grows), cancel one, or make
 * it lazy" -- because a refusal that does not leave a way forward is the trap
 * this repo's own rule forbids.
 *
 * Returns `null` when the schedule may proceed, so the caller branches once.
 */
export function unkeyedScheduleRefusal(
  pendingUnkeyed: number,
  owner: string,
  cap: number,
): string | null {
  if (pendingUnkeyed < cap) return null;
  return (
    `Player ${owner} already has ${pendingUnkeyed} unkeyed events pending, which is this world's limit. ` +
    `Three ways forward, and the first is almost always the right one: ` +
    `(1) give the schedule a KEY -- a keyed schedule upserts, so its count never grows; ` +
    `(2) cancel a timer you no longer need with \`ctx.world.cancel(key)\` -- which is another ` +
    `reason for (1), because a key is the only handle a cancel has; ` +
    `(3) make the effect LAZY -- if it is only visible when someone next looks, write a ` +
    `completesAt timestamp into state and compute it on read, which costs no wake at all.`
  );
}

/**
 * Whether one more DISTINCT KEY may be scheduled for this owner (#105).
 *
 * Only a NEW key is ever offered here: an upsert of a key the owner already
 * holds replaces the pending event and grows nothing, so it is admitted at the
 * cap and always will be. That exemption is the reason keys are the encouraged
 * shape, and this refusal exists so the exemption stays true of what it
 * actually claims -- the queue, not one key in it.
 *
 * The ways forward are the same three, reordered for what is actually wrong:
 * a game at this cap is minting key names, so REUSING one comes first.
 */
export function keyedScheduleRefusal(
  pendingKeyed: number,
  owner: string,
  cap: number,
): string | null {
  if (pendingKeyed < cap) return null;
  return (
    `Player ${owner} already holds ${pendingKeyed} pending keyed timers, which is this world's ` +
    `limit per player. A key that is never used twice is a one-shot wearing a key, and this ` +
    `world just refused the ${pendingKeyed + 1}th of them. Three ways forward: ` +
    `(1) REUSE a key you already hold -- scheduling under it replaces the pending timer and ` +
    `costs nothing new, which is what keys are for; ` +
    `(2) call \`ctx.world.cancel(key)\` on a pending timer you no longer need; ` +
    `(3) make the effect LAZY -- if it is only visible when someone next looks, write a ` +
    `completesAt timestamp into state and compute it on read, which costs no wake at all.`
  );
}

/**
 * Whether one command may ask for another event (#105).
 *
 * Counted as the command goes rather than checked once on the batch, so the
 * refusal lands at the offending line inside the handler -- the same place and
 * the same moment as every other schedule refusal.
 *
 * THE MESSAGE MUST NOT ADVISE WHAT THE AUTHOR ALREADY DID (#170). This
 * refusal used to say "give each thing a stable key", and a keyed batch is
 * exactly the shape that reaches it -- advice its author had already taken,
 * which is the trap this file's own rule forbids. The way forward for an
 * oversized ask is to SPLIT it across commands, or to stop asking at all
 * (lazy), and those are what the sentence names.
 */
export function scheduleBatchRefusal(
  requested: number,
  cap: number,
): string | null {
  if (requested < cap) return null;
  return (
    `One command asked to schedule ${requested + 1} events, and a command may ask for at most ` +
    `${cap} -- everything one owner may hold pending at once, keyed and unkeyed together, so a ` +
    `bigger ask could never all be admitted for one owner anyway. Two ways forward: (1) SPLIT ` +
    `the batch across ` +
    `commands -- arm what this command is about now and let a later command, or a keyed timer ` +
    `that fires next, arm the rest; (2) make some of the effects LAZY -- if an effect is only ` +
    `visible when someone next looks, write a completesAt timestamp into state and compute it ` +
    `on read, which costs no event at all.`
  );
}

/**
 * Whether this WORLD may hold another pending event (#105).
 *
 * The backstop under both per-owner caps, and the one refusal here that is not
 * about the asking player: it is the world saying its queue is full. It stays
 * GAME-owned all the same, because a queue only ever fills with events bundles
 * asked for, and parking the world over it would kill a live world for one
 * bundle's doing -- exactly what `refusals.ts` splits owners to prevent.
 */
export function worldQueueRefusal(
  worldPending: number,
  cap: number,
): string | null {
  if (worldPending < cap) return null;
  return (
    `This world already holds ${worldPending} pending scheduled events, which is its whole ` +
    `queue's limit of ${cap}. Nothing new can be scheduled until some of them come due. This ` +
    `is a world being filled rather than played: look for a handler that schedules on every ` +
    `command instead of re-arming one keyed timer, and for effects that could be LAZY -- a ` +
    `completesAt timestamp computed on read costs no queue at all.`
  );
}

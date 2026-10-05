/**
 * THE ONE DISPATCH ORDER EVERY WORLD HOST RUNS (#539).
 *
 * A command or a due event reaches a world through the same four steps, in
 * this order, on every host: walk the action's declaration until it names
 * nothing more, read the owner's schedule allowance ONCE, apply the command
 * with it, and plan what the command asked to schedule against that same
 * allowance. Two hosts that each wrote this order out drifted -- one read the
 * allowance twice (#539) -- so it lives here, and a host supplies only its
 * readers and its runner.
 *
 * WHAT STAYS WITH THE HOST is everything after the plan: when the effects are
 * made durable (per command on `boardsmith dev`, per batch on a hosting
 * platform), the dirty set, receipts, activity watermarks, notice boxes and
 * what a vacated chair means. Those differ between hosts for real reasons; the
 * order above does not.
 */
import { walkDeclaration } from "./declaration.js";
import { planSchedules, WORLD_OWNER } from "./schedule-api.js";
import type { PlannedEvent, ScheduleAllowance, ScheduleRequest } from "./schedule-api.js";
import type { WorldBudgets } from "./budgets.js";
import type {
  DeclaredSeatActivityStamp,
  StoredPartition,
  WorldCommand,
  WorldDispatchNeeds,
  WorldDispatchWhen,
  WorldWalkAnswers,
} from "./contract.js";
import type { DeclaredNoticeBox } from "./notices.js";
import type { WorldTiming } from "./runner.js";

/** What one dispatch is: who, which command, and when. */
export interface WorldDispatchRequest {
  /** The acting player, or null for the clock's own dispatch. */
  readonly player: string | null;
  readonly command: WorldCommand;
  /** The occurrence on the clock's road, null on a seat's. */
  readonly timing: WorldTiming;
  /** The command's instant: its stamped arrival, or a due event's own `due`. */
  readonly arrivedAt: number;
}

/**
 * WHAT A HOST HANDS `dispatchStep`: its runner's two calls and its readers.
 *
 * `R` is whatever the host's `apply` answers -- a `WorldCommandResult` from a
 * resident runner, or the decoded reply of a child isolate -- so long as it
 * carries the schedule requests the plan is made from.
 */
export interface WorldDispatchHost<R extends { readonly schedules?: readonly ScheduleRequest[] }> {
  /** One round of the declaration walk: what this round still needs. */
  declare(
    supplied: Record<string, StoredPartition>,
    when: WorldDispatchWhen,
    declared: WorldWalkAnswers,
  ): Promise<WorldDispatchNeeds>;
  /** A partition's stored bytes, for a round that named it. */
  readPartition(name: string): Promise<StoredPartition>;
  /** One chair's watermark, for a round that named it. */
  readActivity(seat: number): Promise<DeclaredSeatActivityStamp>;
  /** One seat's notice box, for a round that named it. */
  readNoticeBox(seat: number): Promise<DeclaredNoticeBox>;
  /**
   * WHAT THE OWNER AND THE WORLD ALREADY HOLD PENDING. Called EXACTLY ONCE per
   * dispatch: the apply and the plan both judge against this one answer, so a
   * handler is never told it may schedule what the plan then refuses, or the
   * other way round.
   */
  allowance(owner: string): Promise<ScheduleAllowance>;
  /** Run the command with the allowance and everything the walk collected. */
  apply(input: { readonly allowance: ScheduleAllowance; readonly answers: WorldWalkAnswers }): Promise<R>;
  /**
   * The host's half of planning, after the command ran: the sequence the
   * planned events start at, how their ids are minted, and the pending event
   * a key would replace. Handed the requests so a host that reserves sequence
   * numbers reserves exactly as many as it needs.
   */
  planning(
    owner: string,
    requests: readonly ScheduleRequest[],
  ): Promise<{
    readonly nextSeq: number;
    readonly mintId: (index: number) => string;
    readonly replaces: (key: string) => string | undefined;
  }>;
}

/** What the command did, and the queue writes its schedules come to. */
export interface WorldDispatchStepResult<R> {
  readonly result: R;
  /** Events to insert and pending event ids they displace. A refused plan is
   *  thrown, never returned. */
  readonly plan: { readonly events: readonly PlannedEvent[]; readonly replaced: readonly string[] };
}

/**
 * RUN ONE DISPATCH IN THE ORDER EVERY HOST SHARES: walk, one allowance read,
 * apply, plan.
 *
 * Throws what the walk or the apply throws, and the plan's refusal when the
 * command asked for more than the allowance admits. Nothing here writes: the
 * host makes the result and the plan durable, and decides when.
 */
export async function dispatchStep<R extends { readonly schedules?: readonly ScheduleRequest[] }>(
  request: WorldDispatchRequest,
  host: WorldDispatchHost<R>,
  budgets: WorldBudgets,
): Promise<WorldDispatchStepResult<R>> {
  const { player, timing, arrivedAt } = request;
  // THE SAME INSTANT THE APPLY IS STAMPED WITH (#375), and the whole
  // occurrence on the clock's road (#271), so the declaration and the handler
  // it precedes agree about what time it is and how much was folded.
  const when: WorldDispatchWhen =
    timing === null ? { kind: "arrival", now: arrivedAt } : { kind: "scheduled", timing };
  const answers = await walkDeclaration(
    (supplied, declared) => host.declare(supplied, when, declared),
    (name) => host.readPartition(name),
    (seat) => host.readActivity(seat),
    (seat) => host.readNoticeBox(seat),
  );

  const owner = player ?? WORLD_OWNER;
  // ONE ALLOWANCE, read once and used by both the apply and the plan. Two
  // reads either side of a command that scheduled something would let the
  // plan judge against numbers the handler never saw.
  const allowance = await host.allowance(owner);
  const result = await host.apply({ allowance, answers });

  // THE PARENT IS THE ONLY WRITER. `ctx.world.schedule()` refused inside the
  // handler at the offending line, where the rollback unwinds it; this is the
  // authority that actually mints the events.
  const requests = result.schedules ?? [];
  const planning = await host.planning(owner, requests);
  const plan = planSchedules(requests, {
    owner: player,
    arrivedAt,
    nextSeq: planning.nextSeq,
    mintId: planning.mintId,
    allowance,
    budgets,
    replaces: planning.replaces,
  });
  if (!plan.ok) throw plan.refusal;
  return { result, plan: { events: plan.events, replaced: plan.replaced } };
}

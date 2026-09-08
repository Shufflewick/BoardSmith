/**
 * THE BUDGETS A WORLD IS RUN AGAINST, OWNED HERE AND CONFIGURED BY THE HOST.
 *
 * Every number below used to be a constant inside ShufflewickPub -- the seat
 * ceiling in a 966-line manifest schema, the partition byte cap in a file about
 * Durable Object storage walls, the schedule caps in the queue module. That was
 * survivable while the platform was the only host. It is not survivable now:
 * `boardsmith dev` runs the same world on a laptop, and a laptop that ran
 * DIFFERENT budgets from production would make the phase-1 gate -- the same
 * spec green against both -- a statement about two different games.
 *
 * So the library owns the numbers and the host chooses them. `worldBudgets()`
 * with no argument is what both hosts get unless they say otherwise, and every
 * function that enforces a budget takes it as an argument rather than reading a
 * module constant. A budget that could be read without being passed is a budget
 * a second host can silently disagree about.
 *
 * ## Two of them are DERIVED, and the derivation is re-run on every override
 *
 * `maxSchedulesPerCommand` is the sum of the two per-owner holding caps, and
 * `maxPendingEvents` is the seat ceiling times the unkeyed cap. Both
 * derivations are arguments rather than conveniences (see each field), and both
 * are recomputed from whatever overrides arrive -- so a host that raises
 * `maxPlayers` gets a world queue sized for it, and one that raises a holding
 * cap gets a batch cap that still admits everything one owner may hold. Naming
 * either derived field explicitly overrides the derivation, which is the one
 * way to get the two out of step and therefore the one way that has to be
 * deliberate.
 */

import { MAX_FLAT_CHOICE_CANDIDATES } from "../engine/element/action-metadata.js";

/** Every budget a world runs against. Complete, so nothing reads a default at
 *  the point of enforcement. */
export interface WorldBudgets {
  /**
   * THE MOST SEATS ANY WORLD THIS HOST RUNS MAY HOLD.
   *
   * A ceiling on the bundle's own `maxPlayers`, not a substitute for it: the
   * game says how many players its world holds and this says how large a world
   * the host is prepared to keep resident. `assertWorldSeatCount` is where the
   * two meet.
   *
   * It also bounds the per-seat colour spread: hues are rounded to whole
   * degrees over two lightnesses, which yields 720 distinct colours, so a host
   * raising this past 720 gives two seats the same colour.
   */
  readonly maxPlayers: number;
  /**
   * HOW MANY SERIALIZED BYTES ONE PARTITION MAY HOLD.
   *
   * A partition is written as one storage value on every host that exists, so
   * this is a real wall rather than a preference -- but where the wall sits is
   * the host's fact. The default is half of the smallest value a partition
   * store this library has been run against will take.
   *
   * Enforced at genesis AND at checkpoint, so a world cannot be born over
   * budget and discover it on the first write.
   */
  readonly partitionMaxBytes: number;
  /** How many UNKEYED events one owner may hold pending. Bounds the one way a
   *  queue grows that nothing else bounds. */
  readonly maxUnkeyedPendingPerPlayer: number;
  /**
   * How many DISTINCT KEYS one owner may hold pending.
   *
   * Deliberately larger than the unkeyed cap: a keyed timer is the shape a
   * world author should be writing -- one key per named thing, re-armable and
   * self-limiting -- so the encouraged shape must have more room than the
   * discouraged one.
   */
  readonly maxKeyedPendingPerPlayer: number;
  /**
   * How many schedule requests ONE COMMAND may ask for.
   *
   * DERIVED as the sum of the two holding caps, and the invariant is what
   * forces the sum: the holding caps bound the QUEUE, this one bounds the
   * ASKING, and an asking bound below a holding bound refuses batches the queue
   * would have admitted whole. The largest fully admissible ask one owner can
   * make is everything they may hold in both classes at once.
   */
  readonly maxSchedulesPerCommand: number;
  /**
   * How many events one WORLD may hold pending, across every owner.
   *
   * DERIVED as `maxPlayers * maxUnkeyedPendingPerPlayer`, and deliberately
   * BELOW the sum of the per-owner caps -- those permit every seat to be full
   * and maxed at once, which is to say never, and a ceiling that never trips is
   * not a backstop.
   */
  readonly maxPendingEvents: number;
  /**
   * How many REAL iterations a recurrence that fell behind runs before the rest
   * are folded into one coalesced call.
   *
   * Integrating rather than replaying is what stops a world that was away for a
   * week from spending a week of handler calls -- and, more importantly, from
   * delivering a week of notifications at once.
   */
  readonly catchUpMaxRealIterations: number;
  /**
   * HOW MANY CANDIDATES ONE SELECTION MAY OFFER A PLAYER.
   *
   * The third budget, beside the seat ceiling and the partition byte cap, and
   * it is here now because #169 is what makes it reachable: a world's verbs
   * become Actions, and an Action's selection is ENUMERATED -- the shell asks
   * "which of these can this seat choose?" and the engine answers by evaluating
   * every candidate.
   *
   * A TABLE CAN AFFORD THAT AND A WORLD CANNOT. A table's whole tree is
   * resident, so enumerating a choice costs what the board holds; a world holds
   * only the partitions its declaration named, and a selection over "every room
   * in the world" is the O(world) read the entire partitioned model exists to
   * delete. An unbounded enumeration would reintroduce it through the one door
   * left open, and it would do so on the READ path, where it is paid by every
   * watcher rather than by whoever acted.
   *
   * So a selection that would offer more than this is refused, and the refusal
   * is the author's signal to narrow it -- offer the exits of the room the
   * player is in, not the rooms of the world. It is a budget rather than a
   * constant for the same reason the other two are: a host that keeps its
   * worlds small may allow a wider choice, and one running 500-seat worlds may
   * not, and neither may discover that silently.
   *
   * Nothing enforces it yet. It is declared here so #169 configures a budget
   * rather than inventing one, and so the number is the host's from the first
   * line of code that reads it.
   */
  readonly maxCandidatesPerSelection: number;
  /**
   * How many due events one drain may run.
   *
   * The host's CPU budget divided by what it is prepared to spend on one
   * handler. A world still behind after a batch re-arms for now: overload
   * degrades to latency, never refusal.
   */
  readonly drainBatch: number;
  /**
   * HOW MANY DRAIN BATCHES ONE PLAYER'S COMMAND MAY WAIT BEHIND
   * (ShufflewickPub #380).
   *
   * Only a `world.ordering: 'chronological'` world reaches this. Its commands
   * are gated behind the events already due at the player's arrival instant,
   * and the queue is drained in `drainBatch`-sized batches with a yield between
   * them -- so the host stays responsive and a defective handler that re-arms
   * itself at zero delay makes a slow world rather than a wedged one.
   *
   * When the ceiling is reached with events still due, the command is applied
   * ANYWAY, over a world that is still behind. Degradation by latency, never
   * refusal: a refusal would make the player press the button again, which
   * loses the ordering the gate exists to keep.
   */
  readonly catchUpRounds: number;
  /**
   * HOW LONG A COMMITTED ORDER'S RECEIPT IS KEPT (#195).
   *
   * Every player command carries an order id, and a host records a receipt for
   * every order it commits so a repeat is answered from the receipt instead of
   * being run a second time. A world runs for months and its ledger cannot, so
   * receipts are swept once they are this old.
   *
   * The default is a fortnight: comfortably longer than any interruption a page
   * recovers from by itself -- a closed laptop, a holiday, a phone that lost
   * its network in a tunnel -- and short enough that the ledger stays a
   * recovery window rather than a second copy of the world's history. Past it a
   * repeat is refused by name (`order-outcome-unknown`) rather than risking the
   * second spend.
   */
  readonly receiptRetentionMs: number;
}

/**
 * The budgets a host gets unless it says otherwise.
 *
 * Not exported as an object anybody can reach past `worldBudgets` -- reading a
 * default is exactly the habit that made these numbers a platform's private
 * business in the first place. Use `worldBudgets()`.
 */
const BASE = {
  maxPlayers: 500,
  partitionMaxBytes: 512 * 1024,
  maxUnkeyedPendingPerPlayer: 32,
  maxKeyedPendingPerPlayer: 64,
  catchUpMaxRealIterations: 4,
  drainBatch: 200,
  // Eight batches of `drainBatch` is a long catch-up for one command to sit
  // behind and a short one for a world that has been asleep for a week, which
  // is the pair this number has to sit between.
  catchUpRounds: 8,
  // Wide enough that no hand-written world reaches it by describing a real
  // place -- a room with 200 exits is not a room -- and narrow enough that a
  // selection over "everything in the world" is refused rather than paid for.
  maxCandidatesPerSelection: 200,
  receiptRetentionMs: 14 * 24 * 60 * 60 * 1000,
} as const;

/** What a host may say about its budgets. Everything is optional; the two
 *  derived fields are recomputed from whatever is not named. */
export type WorldBudgetOverrides = Partial<WorldBudgets>;

/**
 * The budgets to run a world against.
 *
 * Every override is validated, because a budget that is zero, negative or
 * fractional does not refuse anything sensibly -- it either admits everything
 * or refuses everything, and both look like a world that is broken rather than
 * a host that is misconfigured.
 */
export function worldBudgets(overrides: WorldBudgetOverrides = {}): WorldBudgets {
  const maxPlayers = positive(overrides.maxPlayers ?? BASE.maxPlayers, "maxPlayers");
  const partitionMaxBytes = positive(
    overrides.partitionMaxBytes ?? BASE.partitionMaxBytes,
    "partitionMaxBytes",
  );
  const maxUnkeyedPendingPerPlayer = positive(
    overrides.maxUnkeyedPendingPerPlayer ?? BASE.maxUnkeyedPendingPerPlayer,
    "maxUnkeyedPendingPerPlayer",
  );
  const maxKeyedPendingPerPlayer = positive(
    overrides.maxKeyedPendingPerPlayer ?? BASE.maxKeyedPendingPerPlayer,
    "maxKeyedPendingPerPlayer",
  );
  return {
    maxPlayers,
    partitionMaxBytes,
    maxUnkeyedPendingPerPlayer,
    maxKeyedPendingPerPlayer,
    // DERIVED FROM WHAT ARRIVED, not from the defaults: a host that raised a
    // holding cap and got the default batch cap would be refused batches its
    // own queue would have admitted whole.
    maxSchedulesPerCommand: positive(
      overrides.maxSchedulesPerCommand ?? maxUnkeyedPendingPerPlayer + maxKeyedPendingPerPlayer,
      "maxSchedulesPerCommand",
    ),
    maxPendingEvents: positive(
      overrides.maxPendingEvents ?? maxPlayers * maxUnkeyedPendingPerPlayer,
      "maxPendingEvents",
    ),
    maxCandidatesPerSelection: aboveReadingThreshold(
      positive(
        overrides.maxCandidatesPerSelection ?? BASE.maxCandidatesPerSelection,
        "maxCandidatesPerSelection",
      ),
    ),
    catchUpRounds: positive(overrides.catchUpRounds ?? BASE.catchUpRounds, "catchUpRounds"),
    catchUpMaxRealIterations: positive(
      overrides.catchUpMaxRealIterations ?? BASE.catchUpMaxRealIterations,
      "catchUpMaxRealIterations",
    ),
    drainBatch: positive(overrides.drainBatch ?? BASE.drainBatch, "drainBatch"),
    receiptRetentionMs: positive(
      overrides.receiptRetentionMs ?? BASE.receiptRetentionMs,
      "receiptRetentionMs",
    ),
  };
}

/**
 * THE TWO CANDIDATE NUMBERS, RECONCILED IN ONE PLACE (#170 R2).
 *
 * `MAX_FLAT_CHOICE_CANDIDATES` is the Action Panel's READING threshold: past it
 * a wrapping row of pills stops being a sentence and becomes an unlabelled grid,
 * so the panel renders the prompt and one control that hands focus to the board
 * (`shouldDeferElementPickToBoard`). `maxCandidatesPerSelection` is the host's
 * SAFETY NET: past it the offer's size is a function of the resident tree rather
 * than of the declaration, which is the O(world) read the partitioned model
 * exists to delete, so the world is refused when it is built.
 *
 * They describe one phenomenon and were set by two tickets (#172 and #169), so
 * the relationship is stated once, here, and enforced: the safety net is
 * STRICTLY ABOVE the reading threshold. A host that set it lower would make the
 * panel's board handoff unreachable for worlds -- every set the engine admitted
 * would already fit in the panel -- and #172's keyboard rule would have nothing
 * to land on, silently, with no test able to catch it.
 */
function aboveReadingThreshold(value: number): number {
  if (value > MAX_FLAT_CHOICE_CANDIDATES) return value;
  throw new Error(
    `\`maxCandidatesPerSelection\` is ${value}, which is not above the Action Panel's ` +
    `reading threshold of ${MAX_FLAT_CHOICE_CANDIDATES}.\n` +
    `  The two are one phenomenon: the panel hands a pick wider than ${MAX_FLAT_CHOICE_CANDIDATES} ` +
    `candidates to the board, and this budget refuses a selection so wide that its size ` +
    `is a function of the world rather than of the declaration.\n` +
    `  Set it above ${MAX_FLAT_CHOICE_CANDIDATES} (the shipped default is ` +
    `${BASE.maxCandidatesPerSelection}). To narrow what a world OFFERS, narrow the action's ` +
    `\`from\`/\`filter\` -- offer the exits of the room the player is in, not the rooms of the world.`,
  );
}

function positive(value: number, field: string): number {
  if (Number.isInteger(value) && value > 0) return value;
  throw new Error(
    `A world budget must be a whole number greater than zero, and \`${field}\` was ` +
      `${JSON.stringify(value)}. A budget of zero or less refuses everything and a fractional ` +
      `one refuses inconsistently; both look like a broken world rather than a misconfigured host.`,
  );
}

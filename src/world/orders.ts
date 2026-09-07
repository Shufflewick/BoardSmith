/**
 * A PAID ORDER'S IDENTITY, AND WHAT A HOST DOES WITH A REPEAT OF ONE (#195).
 *
 * ## The problem, in one sentence
 *
 * A player presses "found a colony", the command commits, and the reply is lost
 * on the way back -- a socket dropped, a tab reloaded, a laptop lid closed. The
 * page now cannot tell "it never arrived" from "it arrived and I did not hear",
 * and both of the things it can do are wrong: pressing again founds a second
 * colony, and not pressing again loses one the player already paid for.
 *
 * No amount of care in the game fixes this. The uncertainty is in the
 * TRANSPORT, so the answer is too.
 *
 * ## The answer: the page names the order, the host remembers the answer
 *
 * Every command a player sends carries a `WorldOrder` -- an id the PAGE minted
 * and wrote down durably before the command left, and the instant it did so.
 * The host records a RECEIPT for every order it commits, in the same durable
 * write as the command's own effects, so "the world changed" and "this order
 * changed it" become true together or not at all.
 *
 * A repeat of an order the host has a receipt for is answered FROM THE RECEIPT.
 * The handler does not run, the offer is not re-enumerated and the candidates
 * are not revalidated -- which matters, because the first attempt is exactly
 * what consumed them. A retry of an order that never committed simply runs, and
 * cannot double-spend, because a first attempt that had spent anything would
 * have left a receipt.
 *
 * ## Receipts are bounded, and running out is said out loud
 *
 * A world runs for months; its ledger of answered orders cannot. Receipts are
 * kept for `budgets.receiptRetentionMs` and swept after that, and the host
 * keeps the instant it swept to. An order minted BEFORE that instant with no
 * receipt is the one case nothing can answer: it may have committed and had its
 * receipt swept, or it may never have arrived. So it is refused, by name, with
 * the only honest sentence there is -- rather than being run and risking the
 * second spend this whole mechanism exists to prevent.
 *
 * ## What a GAME does about all this: nothing
 *
 * That is the point. A game does not declare a sequence number as a selection,
 * does not keep its own ledger, and is never asked about retries -- the player
 * is never shown a transport question in the middle of a gameplay one. A
 * handler runs exactly once per order, and the receipt that says so is written
 * with its effects.
 */
import { worldRefusal, type WorldRefusal } from "./refusals.js";
import type { WorldBudgets } from "./budgets.js";

/**
 * WHAT A PAGE NAMES ITS ORDER, minted before the command is sent and written
 * down durably before it is sent, or the identity is not durable at all.
 *
 * `at` is when the PAGE minted it, and it is used for exactly one decision: an
 * order older than the host's receipt floor cannot be answered (see
 * `resolveOrder`). It buys a lying client nothing -- the worst it can do is get
 * its own order refused, or re-run an order it can prove nothing about.
 */
export interface WorldOrder {
  readonly id: string;
  readonly at: number;
}

/**
 * WHAT A HOST WROTE DOWN WHEN AN ORDER COMMITTED.
 *
 * Only committed orders have one. A refused command changed nothing, so a
 * repeat of it may simply run again; a receipt for it would freeze one moment's
 * "your holding is bare" into the answer to every later attempt.
 */
export interface WorldReceipt {
  readonly orderId: string;
  /** The seat's durable player id, so one seat cannot replay another's order. */
  readonly player: string;
  /** When the host committed it, on the world's clock. */
  readonly at: number;
  /** The sentence the world answered with, if it gave one. */
  readonly message?: string;
}

/** The longest an order id may be. Long enough for a UUID and a prefix, short
 *  enough that a client cannot use the ledger as storage. */
export const MAX_ORDER_ID_LENGTH = 128;

/**
 * REFUSE AN ORDER THAT IS NOT ONE, before anything durable is touched.
 *
 * A command whose identity is unusable cannot be made exactly-once by anything
 * downstream, so it is refused at the door rather than run without the
 * guarantee it was supposed to carry.
 */
export function assertWorldOrder(order: unknown): asserts order is WorldOrder {
  // `unknown`, because the caller is a HOST reading a frame off a wire: a
  // command that arrived with no order at all is the commonest way for one to
  // be unusable, and a signature that could not be handed it would push that
  // check out to every host to write again -- differently.
  const candidate = (typeof order === "object" && order !== null ? order : {}) as Partial<WorldOrder>;
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    candidate.id.length > MAX_ORDER_ID_LENGTH
  ) {
    throw worldRefusal(
      "invalid-order",
      `This command's order id is not usable: an order id is a non-empty string of at most ` +
        `${MAX_ORDER_ID_LENGTH} characters, minted by the page and written down before the ` +
        "command is sent. It is what lets a repeat of an uncertain order be answered from its " +
        "receipt instead of spending twice.",
    );
  }
  if (typeof candidate.at !== "number" || !Number.isFinite(candidate.at)) {
    throw worldRefusal(
      "invalid-order",
      "This command's order carries no usable timestamp. `at` is the instant the page minted " +
        "the order, and it is what says whether an order with no receipt is one that never " +
        "committed or one whose receipt has been swept.",
    );
  }
}

/** What a host should do with a command that carries an order. */
export type OrderDecision =
  /** Run it: this order has never committed. */
  | { readonly kind: "run" }
  /** Answer from the receipt: it committed already, and must not run again. */
  | { readonly kind: "replay"; readonly receipt: WorldReceipt }
  /** Refuse: nothing can say whether it committed. */
  | { readonly kind: "unanswerable"; readonly refusal: WorldRefusal };

/**
 * THE ONE DECISION, MADE THE SAME WAY BY EVERY HOST.
 *
 * `receipt` is what the host's ledger holds for this player and order, if
 * anything. `floorAt` is the instant before which this world's receipts have
 * been swept -- everything at or after it is still on file, so an order minted
 * at or after it and holding no receipt provably never committed.
 */
export function resolveOrder(args: {
  readonly order: WorldOrder;
  readonly receipt: WorldReceipt | undefined;
  readonly floorAt: number;
}): OrderDecision {
  const { order, receipt, floorAt } = args;
  if (receipt !== undefined) return { kind: "replay", receipt };
  if (order.at >= floorAt) return { kind: "run" };
  return {
    kind: "unanswerable",
    refusal: worldRefusal(
      "order-outcome-unknown",
      "This world can no longer say whether that order went through. It was sent long enough " +
        "ago that its receipt has been swept, so repeating it might do it a second time and " +
        "abandoning it might lose something already paid for. Nothing was changed. Look at what " +
        "you hold before deciding whether to issue it again.",
    ),
  };
}

/**
 * THE INSTANT A HOST'S RECEIPTS REACH BACK TO, given the clock it is asking on.
 *
 * A host sweeps to this floor and records it; the floor only ever moves
 * forward, because a floor that went backwards would claim receipts a sweep
 * has already deleted.
 */
export function receiptFloor(now: number, budgets: WorldBudgets, previousFloor: number): number {
  return Math.max(previousFloor, now - budgets.receiptRetentionMs);
}

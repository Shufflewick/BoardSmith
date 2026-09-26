/**
 * A SEAT'S NOTICE BOX: a lasting line left for a seat without loading that
 * seat's partition (ShufflewickPub #521, BoardSmith #420).
 *
 * ## Why the platform keeps it, and not the game
 *
 * A command can reach another seat's state only by declaring that seat's
 * partition, and a partition is loaded and written back WHOLE -- up to
 * `partitionMaxBytes` -- to add one line to it. A clan alert to forty members
 * declared forty partitions. sotf worked around it with a queue on one shared
 * partition and a clock sweep that copied lines out sixty-four seats a wake, so
 * a notice took about eighty minutes to arrive and the queue grew with the
 * population. Every world with mail, alerts or "while you were away" lines would
 * have rebuilt that.
 *
 * So the host keeps one small, bounded box per seat BESIDE the partitions:
 *
 *   `ctx.world.notify(seat, ...)` appends to it. Nothing is declared or loaded;
 *     the send rides home on the result and the host applies it in the same
 *     write as the command's checkpoint.
 *   `.noticeBox(...)` declares a read of ONE seat's box on the declaration walk,
 *     and the host answers that box and nothing else. `ctx.world.takeNotices`
 *     then hands the entries to the game and empties the box, which is how the
 *     game moves them into its own state.
 *
 * ## A full box is the sender's choice, every time
 *
 * `whenFull` has no default, because both answers are right for somebody. A
 * clan alert must never be refused because one member has not logged in for a
 * month -- `dropOldest` evicts the oldest entry and counts it in `dropped`, so
 * the reader can say how many were lost. A letter must never vanish -- `refuse`
 * refuses the whole command, by name, at the line.
 *
 * `refuse` needs the recipient's box DECLARED, and that is forced rather than
 * chosen: the engine refuses at the line only if it knows how full the box is,
 * and the only way it can know is for the host to have answered that box before
 * the handler ran. A refusal discovered later, at the host's write, would take
 * every command sharing that write down with it.
 *
 * ## What a box costs
 *
 * One storage row per seat that has anything waiting, bounded by
 * `perSeat x noticeMaxBytes` -- `perSeat` is the world's own declaration and
 * `maxNoticesPerSeat` the host's ceiling on it. A send is one point read and one
 * write of the recipient's row, and a command may send at most
 * `maxNoticesPerCommand`.
 *
 * PURE, like the rest of `boardsmith/world`: the host supplies the read.
 */
import type { WorldBudgets } from "./budgets.js";
import { worldRefusal } from "./refusals.js";

/**
 * THE SCOPE A NOTICE IS DELIVERED LIVE ON.
 *
 * A notice to a seat that is connected reaches it at once, as a narrated event
 * addressed to that seat alone. This is that event's scope, and it is reserved:
 * `assertStorablePartitionName` refuses a partition by this name, so an event on
 * this scope can only ever be a notice.
 */
export const NOTICE_SCOPE = "notice";

/** What a full box means for one notice. No default: see this file's header. */
export type NoticeWhenFull = "refuse" | "dropOldest";

/** One notice as a game writes it. */
export interface WorldNoticeRequest {
  /** The game's own shape, read by nothing between the rules and the UI. */
  readonly payload: unknown;
  /** The sentence, in the shape `emit`'s narration takes. Absent is silence. */
  readonly line?: string | { readonly text: string; readonly type?: string };
  /** What a full box means for THIS notice. Required. */
  readonly whenFull: NoticeWhenFull;
}

/** One notice as the box holds it: what the game wrote, stamped with when. */
export interface WorldNotice {
  /** The dispatch's `world.now` when it was sent. */
  readonly at: number;
  readonly payload: unknown;
  readonly text?: string;
  readonly type?: string;
}

/**
 * ONE SEAT'S BOX.
 *
 * `entries` oldest first. `dropped` counts entries a `dropOldest` send evicted
 * since the box was last taken, so a reader can say how many it will never see.
 */
export interface WorldNoticeBox {
  readonly entries: readonly WorldNotice[];
  readonly dropped: number;
}

/** The box a seat with nothing waiting has. A host stores no row for it. */
export const EMPTY_NOTICE_BOX: WorldNoticeBox = Object.freeze({
  entries: Object.freeze([]) as readonly WorldNotice[],
  dropped: 0,
});

/** Whether a box holds nothing a reader could be told about. A host stores no
 *  row for such a box, and deletes the row it had. */
export function isEmptyNoticeBox(box: WorldNoticeBox): boolean {
  return box.entries.length === 0 && box.dropped === 0;
}

/** A host's answer to one `.noticeBox()` round: which seat, and its box. */
export interface DeclaredNoticeBox {
  readonly seat: number;
  readonly box: WorldNoticeBox;
}

/** One change a dispatch made to a box, in the order the handler made it. */
export type WorldNoticeWrite =
  | {
      readonly kind: "send";
      readonly seat: number;
      readonly notice: WorldNotice;
      readonly whenFull: NoticeWhenFull;
    }
  | { readonly kind: "take"; readonly seat: number };

/**
 * WHAT A DISPATCH DID TO NOTICE BOXES, as it rides home on the result.
 *
 * `perSeat` travels with the writes so a host needs nothing but the result to
 * apply them: the limit is the bundle's declaration and the engine already
 * validated it against the host's own budget.
 */
export interface WorldNoticeWrites {
  readonly perSeat: number;
  readonly writes: readonly WorldNoticeWrite[];
}

/** A box after a dispatch's writes, for the host to store. An empty box is a
 *  row to delete. */
export interface SettledNoticeBox {
  readonly seat: number;
  readonly box: WorldNoticeBox;
}

/**
 * APPLY ONE WRITE TO ONE BOX. The single rule every host and the engine's own
 * running model apply, so they cannot disagree about what a full box does.
 */
export function applyNoticeWrite(
  box: WorldNoticeBox,
  write: WorldNoticeWrite,
  perSeat: number,
): WorldNoticeBox {
  if (write.kind === "take") return EMPTY_NOTICE_BOX;
  if (box.entries.length < perSeat) {
    return { entries: [...box.entries, write.notice], dropped: box.dropped };
  }
  if (write.whenFull === "refuse") throw boxFull(write.seat, perSeat);
  const overflow = box.entries.length - perSeat + 1;
  return {
    entries: [...box.entries.slice(overflow), write.notice],
    dropped: box.dropped + overflow,
  };
}

/**
 * WHAT EVERY BOX A DISPATCH TOUCHED HOLDS AFTER IT, for a host to write in the
 * same transaction as the dispatch's checkpoint.
 *
 * Each touched seat's box is read ONCE, through `read` -- the host's own point
 * read, which must answer from anything this host has applied but not yet
 * written -- and the writes are applied in the order the handler made them.
 * Answers one entry per touched seat, in the order the seats were first
 * touched.
 */
export async function applyNoticeWrites(
  notices: WorldNoticeWrites,
  read: (seat: number) => WorldNoticeBox | Promise<WorldNoticeBox>,
): Promise<readonly SettledNoticeBox[]> {
  const boxes = new Map<number, WorldNoticeBox>();
  for (const write of notices.writes) {
    const before = boxes.get(write.seat) ?? (await read(write.seat));
    boxes.set(write.seat, applyNoticeWrite(before, write, notices.perSeat));
  }
  return [...boxes].map(([seat, box]) => ({ seat, box }));
}

/**
 * THE NOTICE A GAME WROTE, CHECKED AND STAMPED, or the refusal saying why not.
 *
 * Every check is about the notice itself, so it is the same on every host:
 * which seat, what a full box means, and whether it fits in `noticeMaxBytes`
 * measured as storage measures it.
 */
export function stampNotice(
  action: string,
  seat: unknown,
  request: unknown,
  context: { readonly now: number; readonly seatCount: number; readonly budgets: WorldBudgets },
): { readonly seat: number; readonly notice: WorldNotice; readonly whenFull: NoticeWhenFull } {
  if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 1 || seat > context.seatCount) {
    throw invalidNotice(
      action,
      `names seat ${JSON.stringify(seat)}, and this world's seats are 1 to ${context.seatCount}.`,
    );
  }
  if (typeof request !== "object" || request === null) {
    throw invalidNotice(action, "was not given a notice. Pass `{ payload, line?, whenFull }`.");
  }
  const { payload, line, whenFull } = request as Partial<WorldNoticeRequest>;
  if (whenFull !== "refuse" && whenFull !== "dropOldest") {
    throw invalidNotice(
      action,
      `says whenFull is ${JSON.stringify(whenFull)}. Every notice says what a full box means for ` +
        'it, and there is no default: "dropOldest" evicts the oldest waiting notice (right for ' +
        'an alert), "refuse" refuses this command (right for a letter that must not be lost).',
    );
  }
  const narration = typeof line === "string" ? { text: line } : line;
  const notice: WorldNotice = {
    at: context.now,
    payload,
    ...(narration?.text === undefined ? {} : { text: narration.text }),
    ...(narration?.type === undefined ? {} : { type: narration.type }),
  };
  const json = payload === undefined ? undefined : JSON.stringify(notice);
  if (json === undefined) {
    throw invalidNotice(
      action,
      "has a payload JSON cannot carry. A notice is stored until its seat reads it, so it has to " +
        "be made of plain values: objects, arrays, numbers, strings, booleans and null.",
    );
  }
  // MEASURED AS STORAGE MEASURES IT, in UTF-8 bytes.
  const bytes = encoder.encode(json).length;
  if (bytes > context.budgets.noticeMaxBytes) {
    throw invalidNotice(
      action,
      `is ${bytes} bytes, over the ${context.budgets.noticeMaxBytes}-byte limit one notice may ` +
        "be. A notice is a line and a small payload; put anything larger in a partition and send " +
        "a notice that points at it.",
    );
  }
  return { seat, notice, whenFull };
}

/** One encoder for the module, as `partition-store.ts` keeps one. Not imported
 *  from there: that module reserves `NOTICE_SCOPE` from this one. */
const encoder = new TextEncoder();

function invalidNotice(action: string, why: string) {
  return worldRefusal("invalid-notice", `Action "${action}" sent a notice that ${why}`);
}

/** The refusal a `refuse` notice meets at a full box, on every host. */
export function boxFull(seat: number, perSeat: number) {
  return worldRefusal(
    "notice-box-full",
    `Seat ${seat}'s notice box already holds ${perSeat} notices, the most this world keeps for one ` +
      'seat, and this notice said to refuse rather than drop one. Nothing was changed. Read ' +
      "`ctx.world.notices(seat)` first and tell the player in your own words, or send with " +
      '`whenFull: "dropOldest"` if losing the oldest notice is acceptable.',
  );
}

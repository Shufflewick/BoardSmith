/**
 * #195: A PAID ORDER SURVIVES A LOST REPLY.
 *
 * Every fact below is one sentence of that ticket, asserted on the policy both
 * hosts run: a repeat of a committed order is answered from its receipt, a
 * repeat of one that never committed simply runs, and the one case nothing can
 * answer is refused by name rather than guessed at.
 */
import { describe, expect, it } from "vitest";

import { worldBudgets } from "./budgets.js";
import { WorldRefusal } from "./refusals.js";
import {
  MAX_ORDER_ID_LENGTH,
  assertWorldOrder,
  receiptFloor,
  resolveOrder,
  type WorldReceipt,
} from "./orders.js";

const BUDGETS = worldBudgets();
const RECEIPT: WorldReceipt = {
  orderId: "order-1",
  player: "seat-3",
  at: 1_000,
  message: "Colony founded.",
};

describe("an order's identity", () => {
  it("accepts an id and a mint instant", () => {
    expect(() => assertWorldOrder({ id: "order-1", at: 1 })).not.toThrow();
  });

  it.each([
    ["", "empty"],
    ["x".repeat(MAX_ORDER_ID_LENGTH + 1), "over-long"],
  ])("refuses an %s id, because an unusable identity cannot be made exactly-once", (id) => {
    expect(() => assertWorldOrder({ id, at: 1 })).toThrow(/order id/);
  });

  it("refuses an order with no usable mint instant", () => {
    expect(() => assertWorldOrder({ id: "order-1", at: Number.NaN })).toThrow(/timestamp/);
  });

  it("classifies both as the CALLER's, so one bad request cannot park a world", () => {
    try {
      assertWorldOrder({ id: "", at: 1 });
      expect.unreachable("an empty order id was accepted");
    } catch (error) {
      expect((error as WorldRefusal).code).toBe("invalid-order");
      expect((error as WorldRefusal).owner).toBe("caller");
    }
  });
});

describe("what a host does with a command that carries an order", () => {
  it("RUNS one it has never committed", () => {
    expect(
      resolveOrder({ order: { id: "order-1", at: 5_000 }, receipt: undefined, floorAt: 0 }),
    ).toEqual({ kind: "run" });
  });

  it("REPLAYS one it has a receipt for, rather than running the handler again", () => {
    // The lost-reply case, after commit. The candidates the first attempt
    // consumed are never revalidated, because the first attempt is what
    // consumed them.
    const decision = resolveOrder({
      order: { id: "order-1", at: 5_000 },
      receipt: RECEIPT,
      floorAt: 0,
    });
    expect(decision).toEqual({ kind: "replay", receipt: RECEIPT });
  });

  it("replays whatever the world said the first time, sentence and all", () => {
    const decision = resolveOrder({
      order: { id: "order-1", at: 5_000 },
      receipt: RECEIPT,
      floorAt: 0,
    });
    expect(decision.kind === "replay" && decision.receipt.message).toBe("Colony founded.");
  });

  it("runs an order minted exactly at the floor: the floor is what is still on file", () => {
    expect(
      resolveOrder({ order: { id: "order-1", at: 900 }, receipt: undefined, floorAt: 900 }),
    ).toEqual({ kind: "run" });
  });

  it("REFUSES a repeat older than the floor, because nothing can say what became of it", () => {
    const decision = resolveOrder({
      order: { id: "order-1", at: 899 },
      receipt: undefined,
      floorAt: 900,
    });
    expect(decision.kind).toBe("unanswerable");
    if (decision.kind !== "unanswerable") return;
    expect(decision.refusal.code).toBe("order-outcome-unknown");
    expect(decision.refusal.owner).toBe("caller");
    expect(decision.refusal.message).toMatch(/Nothing was changed/);
  });

  it("a receipt still answers an order older than the floor", () => {
    // Sweeping is what removes a receipt. While one is on file it is the
    // answer, whatever the floor says.
    expect(
      resolveOrder({ order: { id: "order-1", at: 1 }, receipt: RECEIPT, floorAt: 900 }).kind,
    ).toBe("replay");
  });
});

describe("the receipt floor", () => {
  it("is the retention window behind the clock", () => {
    expect(receiptFloor(BUDGETS.receiptRetentionMs + 5_000, BUDGETS, 0)).toBe(5_000);
  });

  it("never moves backwards, because a sweep cannot be un-swept", () => {
    expect(receiptFloor(0, BUDGETS, 9_000)).toBe(9_000);
  });

  it("is zero for a world younger than its retention window", () => {
    expect(receiptFloor(1_000, BUDGETS, 0)).toBe(0);
  });
});

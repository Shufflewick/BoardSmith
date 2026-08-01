// GENERATED FILE — do not hand-edit. Regenerate with:
//   boardsmith verify-example-emit --chunk punch
// One example test file per chunk (178-CONTEXT.md decision 8) — re-running this command for this chunk regenerates ONLY this file, never another chunk's.

import { describe, it, expect } from 'vitest';
import { ACTION_TYPES, ACTION_TIMING } from "../../src/rules/action-cards.js";
import { Guard, GuardRow, GUARD_STATES } from "../../src/rules/elements.js";
import { computeResolutionOrder } from "../../src/rules/resolution.js";
import { readyGuards, exhaustedGuards, exhaustGuard } from "../../src/rules/guards.js";

describe('punch — worked examples', () => {
  // UNEXECUTABLE — rulebook/01-setup-and-round-structure.md:52: Translator declined (verdictHint=unexecutable, unexecutableReason=unmodeled-component-state).

  // UNEXECUTABLE — rulebook/02-action-cards-and-resolution.md:37: Translator declined (verdictHint=unexecutable, unexecutableReason=unmodeled-component-state).

  // UNEXECUTABLE — rulebook/02-action-cards-and-resolution.md:66: Translator declined (verdictHint=unexecutable, unexecutableReason=no-matching-symbol).

  // UNEXECUTABLE — rulebook/02-action-cards-and-resolution.md:87: Translator declined (verdictHint=unexecutable, unexecutableReason=no-matching-symbol).

  // UNEXECUTABLE — rulebook/02-action-cards-and-resolution.md:113: Translator declined (verdictHint=unexecutable, unexecutableReason=no-matching-symbol).

  // UNEXECUTABLE — rulebook/02-action-cards-and-resolution.md:114: Translator declined (verdictHint=unexecutable, unexecutableReason=no-matching-symbol).

  // UNEXECUTABLE — rulebook/02-action-cards-and-resolution.md:115: Translator declined (verdictHint=unexecutable, unexecutableReason=unmodeled-component-state).

  // rulebook/01-setup-and-round-structure.md:79 (p.2)
  // Source: (verbatim source recorded in the CHECK-06 ledger for this exampleId)
  describe("example: p.1 action timing resolution order", () => {
    it("resolves the lower-timing action first when Jab (timing 1) is compared to Retreat (timing 2)", () => {
      const redPlan = { seat: "red", actionType: ACTION_TYPES.JAB, timing: ACTION_TIMING[ACTION_TYPES.JAB] };
      const bluePlan = { seat: "blue", actionType: ACTION_TYPES.RETREAT, timing: ACTION_TIMING[ACTION_TYPES.RETREAT] };

      const order = computeResolutionOrder([redPlan, bluePlan]);

      expect(order[0].seat).toBe("red");
      expect(order[0].actionType).toBe(ACTION_TYPES.JAB);
      expect(order[1].seat).toBe("blue");
      expect(order[1].actionType).toBe(ACTION_TYPES.RETREAT);
    });
  });

  // rulebook/02-action-cards-and-resolution.md:92 (p.2)
  // Source: (verbatim source recorded in the CHECK-06 ledger for this exampleId)
  it("exhausts one ready Guard when punched with three ready Guards", () => {
    const guardRow = new GuardRow([
      new Guard(GUARD_STATES.READY),
      new Guard(GUARD_STATES.READY),
      new Guard(GUARD_STATES.READY),
    ]);

    expect(readyGuards(guardRow).length).toBe(3);
    expect(exhaustedGuards(guardRow).length).toBe(0);

    exhaustGuard(guardRow);

    expect(readyGuards(guardRow).length).toBe(2);
    expect(exhaustedGuards(guardRow).length).toBe(1);
  });

});

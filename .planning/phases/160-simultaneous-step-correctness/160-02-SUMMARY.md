---
requirements-completed: [SIM-02, PROC-01]
---

# Plan 160-02 Summary — Per-seat simultaneous undo (SIM-02, PROC-01)

**Plan:** 160-02 (execute — D4: any-seat simultaneous undo, no `currentPlayer` pin)
**Completed:** 2026-07-20
**Result:** PASS — a shared `computeUndoEligibility` helper makes simultaneous undo work for ANY
awaiting seat (not just seat-1), rewinding ONLY that seat's own current-step action, bounded to the
current step's `moveCount` window, with Phase 155's fences intact and both executors in parity.

> **Note:** the executor process died mid-Task-3 (API connection closed) AFTER Task 3's tests were
> written and passing but BEFORE they were committed. The orchestrator verified the full suite green,
> confirmed the cross-phase adversarial assertion matched the plan's WARNING, committed Task 3
> (`4f14eb4e`), and authored this SUMMARY. No work was lost; nothing was re-run against stale code.

## What was done

1. **Task 1 (RED)** — `src/session/testing/simultaneous-undo.test.ts` drives the shared
   `simultaneous-fixture.ts` (Plan 01) through both executors: both seats commit independently, then
   seat-2 sends `{type:'undo', player:2}` → **REFUSED "It's not your turn"** because `handleUndo` /
   `undoToTurnStart` were pinned to `flowState.currentPlayer` (which resolves to seat-1 and never
   advances during a simultaneous step). Seat-1's own undo already passed (it IS `currentPlayer`) —
   included as a negative control, not part of the RED signal. Committed `892c897c`.

2. **Task 2 (GREEN)** — added a shared `computeUndoEligibility` (`src/session/utils.ts:302`) consumed
   by BOTH executors (`state-history.ts` `undoToTurnStart`, `stateless-ops.ts` `handleUndo`) AND
   `buildPlayerState`'s advisory `canUndo` — the parity contract:
   - **Sequential steps** keep the EXACT existing `computeUndoInfo` / `currentPlayer` contract
     (UNDO-03) — zero behavior change; the awaiting-aware branch only fires when
     `flowState.awaitingPlayers?.length > 0`.
   - **Simultaneous steps** allow any seat that participates in the current step; the per-seat rewind
     boundary is that seat's own committed action within the current step's `moveCount`-derived window
     (NOT the turn-wide moveCount as a boundary, and NOT a scan of all history — the step-window bound
     from the plan-check WARNING).
   - Phase 155's `assertUndoAllowed` (`.notUndoable()` / `finished` / `executeBarrierIndex`) is layered
     on the per-seat boundary and never bypassed.
   - Prep commit `e18d8bdc` tracks per-step `moveCount` for simultaneous frames; GREEN `f94db669`.

3. **Task 3 (parity + adversarial)** — extended `parity-contract.test.ts` (+ a new
   `simultaneous-cross-phase-fixture.ts`): both executors agree on seat-2 simultaneous undo
   (allowed / notUndoable-refused / finished-refused, message equality); adversarial proves seat-2
   cannot cross into seat-1's action, the debug-rewind twins don't bypass the fence, and the
   **CROSS-PHASE** case (line 508) proves seat-2's undo rewinds ONLY its current-step action and never
   reaches an earlier step where the same seat also acted. Committed `4f14eb4e`.

## Verification

- RED proven behavioral (refusal, not missing-symbol); GREEN + adversarial all pass.
- Parity enforced via `parity-contract.test.ts` (25 tests incl. the new simultaneous block).
- Phase 155 undo-authoritative tests stayed green (the awaiting-aware branch did not leak into the
  sequential path).
- Full suite: **201 files / 2862 tests green** (baseline after 160-01 was 200/2850; +2 files/+12 tests,
  zero regressions).

## Files

- `src/session/utils.ts` — new shared `computeUndoEligibility` (+ sequential `computeUndoInfo` kept)
- `src/session/state-history.ts`, `src/session/stateless-ops.ts` — both consume the shared helper
- `src/session/testing/simultaneous-undo.test.ts` (new)
- `src/session/testing/parity-contract.test.ts` (extended)
- `src/session/testing/fixtures/simultaneous-fixture.ts` (helper), `simultaneous-cross-phase-fixture.ts` (new)
</content>

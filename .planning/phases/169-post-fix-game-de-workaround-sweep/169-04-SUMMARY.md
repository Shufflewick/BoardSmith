---
phase: 169-post-fix-game-de-workaround-sweep
plan: 04
subsystem: testing
tags: [ai, mcts, undo, one-two-punch, sweep, vitest]

# Dependency graph
requires:
  - phase: 169-01
    provides: 169-CROSSWALK.md Dxx-fix-present checklist gating this sweep's removals
provides:
  - one-two-punch's BUG 3 (D1/UNDO-01) assessed and kept-and-noted with empirical proof
  - one-two-punch's BUG 8/BSR-12 (D8/AI-02) re-verified and CLOSED
  - Updated BOARDSMITH-BUGS.md ledger entries in the game repo
  - Updated 169-CROSSWALK.md with per-target outcomes for 169-06
affects: [169-06]

# Tech tracking
tech-stack:
  added: []
  patterns: [empirical removal-probe-then-revert for gated compensating-code removal]

key-files:
  created: []
  modified:
    - ~/BoardSmithGames/one-two-punch/BOARDSMITH-BUGS.md
    - ~/BoardSmithGames/one-two-punch/src/rules/ai.ts
    - .planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md

key-decisions:
  - "assertPlanLockHolds() (game.ts:308-359) was KEPT, not removed: neutering it (probe, immediately reverted) turned 4 committed regression tests RED because it pins a second, independent architectural invariant (Decision 9's no-current-player flow shape), not solely BUG 3's now-closed server undo gap"
  - "BUG 8/BSR-12 CLOSED: both original defects (un-redacted MCTS clone, sequential-turn modeling of simultaneous reveal) confirmed fixed upstream via T-159-06 (toJSONForPlayer redaction) and T-159-07 (pre-reveal baseline) in src/ai/mcts-bot.ts; re-verified against this repo's own committed tests/ai.test.ts"
  - "guards.ts:199 is comment-only cross-reference text, not enforcement logic — nothing to remove there"

requirements-completed: [SWEEP-01, PROC-01]

# Metrics
duration: 15min
completed: 2026-07-22
---

# Phase 169 Plan 04: one-two-punch Sweep Summary

**Kept the reimplemented undo guard after empirically proving it load-bearing beyond BUG 3, and closed BSR-12 (BUG 8) by confirming the upstream MCTS now uses a redacted per-seat clone plus a pre-reveal simultaneous baseline.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-22T04:46:49Z
- **Tasks:** 3/3
- **Files modified:** 3 (2 in game repo, 1 in library repo)

## Accomplishments

- Recorded the pre-existing dirty tree (`.boardsmith/runtime-bundle.mjs` + `runtime-entry.ts` deletions) verbatim before branching; left untouched throughout.
- Created `sweep/v4.8-dework` off `master` in `~/BoardSmithGames/one-two-punch`; baseline `npx vitest run` green (13 files / 228 tests).
- **BUG 3 (D1/UNDO-01):** confirmed D1 PRESENT server-side (`assertUndoAllowed` + `hasNonUndoableAction`, called by both `state-history.ts` and `stateless-ops.ts`, independent of `currentPlayer`). Probed removing `assertPlanLockHolds()` (game.ts:308-359) by neutering its body — this **turned 4 committed regression tests RED** (`tests/game.test.ts`'s "the plan lock is OWNED, not merely arranged" describe block), because the guard also pins Decision 9's independent "this game has no current player, ever" flow-shape invariant. Reverted immediately (file diff clean afterward); kept-and-noted in the ledger and crosswalk. `guards.ts:199` is comment-only prose referencing the same invariant, not enforcement code — nothing to remove there.
- **BUG 8 / BSR-12 (D8/AI-02):** re-verified against the live symlinked `boardsmith` source. Both originally-reported defects are fixed upstream: `src/ai/mcts-bot.ts`'s `captureSnapshot()` (T-159-06) clones the search root from `toJSONForPlayer(botSeat)` (redacted, no hidden-hand read) and `maybeCaptureSimultaneousBaseline()` (T-159-07) freezes a pre-reveal baseline at the start of each fresh simultaneous step so both awaiting seats enumerate against shared pre-reveal state, not a clone already mutated by a co-decider's committed move. `src/rules/ai.ts` type-checks cleanly (`npx tsc --noEmit -p .`); `tests/ai.test.ts` (5 tests, already committed to this repo's own suite, including an AI-vs-AI self-play soak) passes. Refreshed the stale "does NOT try to work around it" docblock to cite the fix. **BSR-12 CLOSED for this repo.**
- Reconciled `BOARDSMITH-BUGS.md` (BUG 3 kept-and-noted with rationale; BUG 8 marked RESOLVED/BSR-12 CLOSED) and `169-CROSSWALK.md` with both outcomes for 169-06.
- Committed file-scoped (`git add BOARDSMITH-BUGS.md src/rules/ai.ts` only) — `.boardsmith/*` deletions and no scratch files were staged; `git show --stat HEAD` proves it.

## Task Commits

Each task was committed atomically per protocol; Task 1's removal probe was reverted (no diff) so it produced no commit, and Task 2's comment refresh was folded into Task 3's ledger-reconciliation commit (both are `ai.ts`/`BOARDSMITH-BUGS.md` edits, staged and committed together as the single file-scoped sweep commit):

1. **Tasks 1-3 combined (game repo, `sweep/v4.8-dework`)** — `7e69471` (docs): `BOARDSMITH-BUGS.md` (BUG 3 kept-and-noted, BUG 8 resolved) + `src/rules/ai.ts` (stale comment refreshed to cite T-159-06/T-159-07). Task 1's undo-guard removal probe was reverted in-place before this commit (empty diff, nothing to commit for that step).

**Plan metadata:** committed to library repo (this summary + STATE/ROADMAP update).

## Files Created/Modified

- `~/BoardSmithGames/one-two-punch/BOARDSMITH-BUGS.md` — BUG 3 marked kept-and-noted (D1 present, but guard is independently load-bearing); BUG 8 marked RESOLVED/BSR-12 CLOSED with verification detail.
- `~/BoardSmithGames/one-two-punch/src/rules/ai.ts` — stale "KNOWN FRAMEWORK LIMITATION (BUG 8)" docblock replaced with a "RESOLVED upstream" note citing T-159-06/T-159-07; no functional code change.
- `.planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md` — one-two-punch's BUG 3 and BUG 8 rows updated with 169-04 outcomes.

## Decisions Made

- **Kept `assertPlanLockHolds()`, did not remove it, even though D1/UNDO-01 is PRESENT.** The gate rule requires proving the removal is safe (fix present + suite stays green after removal), not just that the fix is present. The empirical probe showed removal is unsafe: the guard's own committed tests (`tests/game.test.ts`) exist specifically to pin a second invariant (no current player, ever) that is not solely a compensating workaround for BUG 3. This is the "kept + note" success path the plan explicitly designates as valid, backed by concrete red-test evidence rather than a judgment call.
- **BUG 8/BSR-12 CLOSED without any new test additions.** `tests/ai.test.ts` already existed in the repo (5 committed tests, including a self-play soak) and already exercises the redacted/pre-reveal-baseline search path end-to-end — no new test was needed to prove the fix; existing coverage was sufficient.
- **`guards.ts:199` required no code change** — it is a comment cross-referencing Decision 26, not a guard implementation. Confirmed via grep before attempting any edit there.

## Deviations from Plan

None — plan executed exactly as written, including the explicit gated-probe-then-revert protocol for the undo guard removal candidate.

## Issues Encountered

None. The removal probe on `assertPlanLockHolds()` behaved exactly as the plan anticipated (a real possibility it called out): fix-present did not imply removal-safe, and the gate caught it via a red suite before any bad removal could be committed.

## Pre-existing Dirty Files (deliberately untouched)

Recorded verbatim via `git status --porcelain` before branching, and confirmed untouched after the sweep commit (`git status --porcelain` still shows only these two, never staged):

```
 D .boardsmith/runtime-bundle.mjs
 D .boardsmith/runtime-entry.ts
```

No scratch `_*_tmp.mjs` / `_dbg*.mjs` files were present in this repo's working tree at plan start.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `169-CROSSWALK.md` now carries one-two-punch's final BUG 3 and BUG 8/BSR-12 dispositions for 169-06 to consume when it aggregates the cross-repo BSR-12 closeout report.
- `sweep/v4.8-dework` branch in `~/BoardSmithGames/one-two-punch` is at commit `7e69471`, not pushed, one commit ahead of `master`, with the pre-existing `.boardsmith/*` deletions still present but uncommitted (unrelated WIP, left for the repo owner).
- No blockers.

---
*Phase: 169-post-fix-game-de-workaround-sweep*
*Completed: 2026-07-22*

## Self-Check: PASSED

- FOUND: game-repo commit 7e69471 (`git log --oneline --all`)
- FOUND: .planning/phases/169-post-fix-game-de-workaround-sweep/169-04-SUMMARY.md
- FOUND: ~/BoardSmithGames/one-two-punch/BOARDSMITH-BUGS.md
- FOUND: stale ai.ts comment refreshed ("RESOLVED upstream")

---
phase: 169-post-fix-game-de-workaround-sweep
plan: 02
subsystem: testing
tags: [lanternfall, boardsmith, de-workaround, mcts-ai, undo, flow, vitest]

# Dependency graph
requires:
  - phase: 169-01
    provides: 169-CROSSWALK.md — the Dxx <-> repo-BUG-n crosswalk and PRESENT/ABSENT fix-present checklist
provides:
  - Conservative de-workaround sweep of lanternfall's flow.ts (BUG 6/D29) — comment refreshed, valve kept
  - Proven-kept metadata guard in GardenBoard.vue (BUG 7/D26) — removal attempted, reverted on red suite
  - lanternfall BSR-12 AI status recorded for 169-06's cross-repo close verdict
  - Updated lanternfall BOARDSMITH-BUGS.md ledger entries for BUG 6 and BUG 7
  - Updated 169-CROSSWALK.md with lanternfall's per-target outcomes
affects: [169-06]

# Tech tracking
tech-stack:
  added: []
  patterns: ["gated removal: attempt removal -> run full suite -> revert on red -> record as kept-and-noted"]

key-files:
  created: []
  modified:
    - ~/BoardSmithGames/lanternfall/src/rules/flow.ts (comment refresh only, D29/BUG 6)
    - ~/BoardSmithGames/lanternfall/BOARDSMITH-BUGS.md (BUG 6 + BUG 7 status entries)
    - .planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md (lanternfall outcomes + BSR-12)

key-decisions:
  - "BUG 6 (D29/LIBX-02 unbounded loop valve): confirmed PRESENT upstream; lanternfall's maxIterations tripwire is KEPT (not switched to unbounded:true) — comment-only refresh, no behavior change, per conservative posture"
  - "BUG 7 (D26/SPACE-05 availableActions/actionMetadata reconciliation): confirmed PRESENT upstream; GardenBoard.vue's takeMoveBack metadata guard removal was attempted and empirically turned the suite red (a11y.test.ts's mocked-metadata-absent regression), so it was reverted and kept-and-noted — proven, not assumed, safe to keep"
  - "BSR-12 AI: src/rules/ai.ts + tests/ai-smoke.test.ts are pre-existing untracked WIP in the lanternfall repo; read/run only, deliberately excluded from this sweep's commit"

patterns-established:
  - "Gated removal protocol validated end-to-end: a removal candidate with a PRESENT fix verdict can still be correctly kept when empirical suite verification (not the verdict alone) proves it unsafe"

requirements-completed: [SWEEP-01, PROC-01]

# Metrics
duration: 32min
completed: 2026-07-22
---

# Phase 169 Plan 02: lanternfall De-Workaround Sweep Summary

**Conservative gated sweep of lanternfall: BUG 6's stale loop-valve comment refreshed (D29 confirmed PRESENT, valve kept), BUG 7's metadata guard removal attempted-and-reverted after proving it turns the suite red (D26 confirmed PRESENT but guard is genuinely defensive, not dead weight), lanternfall's AI recorded as untracked-but-passing for BSR-12.**

## Performance

- **Duration:** 32 min
- **Started:** 2026-07-21T23:46:00Z
- **Completed:** 2026-07-22T04:18:07Z
- **Tasks:** 2
- **Files modified:** 2 (committed) + 1 crosswalk doc in the library repo

## Accomplishments
- Recorded lanternfall's pre-existing dirty tree (`M src/rules/index.ts`, `?? src/rules/ai.ts`, `?? tests/ai-smoke.test.ts`) before branching, per the plan's explicit gate
- Created `sweep/v4.8-dework` off master (never master itself), carrying the pre-existing WIP forward without discarding or committing it
- Captured a green baseline: `npx vitest run` = 5 test files, 214 tests, all passing (including the untracked `ai-smoke.test.ts`)
- Grep-verified D29 (`unbounded` opt-in, `engine/flow/builders.ts`) and D26 (`D26/SPACE-05` reconciliation, `session/utils.ts`) both **PRESENT** against the live symlinked boardsmith source
- Refreshed the stale `flow.ts` docblock for BUG 6 (D29) — comment-only, kept the `maxIterations` valve
- **Attempted** removing GardenBoard.vue's `takeMoveBack` metadata guard for BUG 7 (D26) — the suite went RED (`tests/a11y.test.ts` "does NOT strand the board when a take-back lands while move metadata is momentarily absent" failed, because that regression test mocks `getActionMetadata()` directly, independent of the server-side race the guard was compensating for) — reverted immediately via `git checkout --`
- Re-ran the full suite after the revert: green again, 5/214, byte-identical to baseline
- Verified lanternfall's AI (`src/rules/ai.ts`) type-checks clean (`npx tsc --noEmit -p .`) and `ai-smoke.test.ts` passes as part of the full suite — recorded as untracked WIP, not committed
- Updated `BOARDSMITH-BUGS.md` (BUG 6 closed-fixed-upstream; BUG 7 kept-and-noted with rationale)
- File-scoped commit on `sweep/v4.8-dework`: only `BOARDSMITH-BUGS.md` and `src/rules/flow.ts` staged and committed — proven via `git show --stat HEAD` that no pre-existing WIP (`src/rules/index.ts`, `src/rules/ai.ts`, `tests/ai-smoke.test.ts`) leaked into the commit
- Updated this repo's `169-CROSSWALK.md` with lanternfall's per-target outcomes and its BSR-12 status line for 169-06 to consume

## Task Commits

Task 1 (record baseline) made no source edits — no commit.

1. **Task 2: Apply gated removals + comment refresh, re-verify AI, file-scoped commit** — `2c66931` (docs, in the `lanternfall` game repo on branch `sweep/v4.8-dework`)

**This repo's (library) commit:** made separately below in the metadata commit (SUMMARY + STATE + ROADMAP + CROSSWALK).

_Note: this plan's actual code sweep lives entirely in the external `~/BoardSmithGames/lanternfall` repo, on `sweep/v4.8-dework`, never pushed. The library repo (`/Users/jtsmith/BoardSmith`) only carries the CROSSWALK update and this SUMMARY._

## Files Created/Modified

**Game repo (`~/BoardSmithGames/lanternfall`, branch `sweep/v4.8-dework`, commit `2c66931`):**
- `src/rules/flow.ts` — refreshed the BUG 6/D29 docblock to record the upstream fix and the rationale for keeping the `maxIterations` valve (comment-only)
- `BOARDSMITH-BUGS.md` — BUG 6 marked fixed-upstream/closed; BUG 7 marked kept-and-noted with the empirical removal-attempt rationale

**Library repo (`/Users/jtsmith/BoardSmith`):**
- `.planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md` — lanternfall BUG 6/BUG 7 rows updated with 169-02 outcomes; BSR-12 status line added

**Deliberately NOT touched/committed (pre-existing WIP in the game repo):**
- `src/rules/index.ts` (modified, pre-existing)
- `src/rules/ai.ts` (untracked, pre-existing — the BSR-12 AI source)
- `tests/ai-smoke.test.ts` (untracked, pre-existing — the AI smoke test)

## Decisions Made

- **BUG 6/D29: comment-refresh only, valve kept.** The plan's own conservative posture instructed comment-refresh as the default; confirmed correct — switching to `unbounded: true` is a behavior change with no test coverage in this sweep proving the valve is dead weight.
- **BUG 7/D26: attempted removal, empirically reverted.** Rather than reasoning abstractly about whether the server-side fix makes the client guard redundant, the plan's gated-removal protocol was followed literally: remove, run suite, observe RED, revert. This caught that the guard defends against a client-side broadcast-timing race that is orthogonal to whether the server-side `availableActions`/`actionMetadata` sets are reconciled — the guard is not dead weight even with D26 present.
- **BSR-12: read/run, do not commit.** Per the plan's explicit instruction, `ai.ts` and `ai-smoke.test.ts` were verified (typecheck clean, test passes in the full suite) but left untracked, since committing them was out of this sweep's scope and would misattribute pre-existing WIP to this sweep.

## Deviations from Plan

None — plan executed exactly as written, including the explicit "attempt removal, verify, revert-on-red" step for BUG 7, which is why that section reads as an "attempted then reverted" rather than a straight keep.

## Issues Encountered

- The first commit message included literal path fragments (`src/rules/ai.ts`, `ai-smoke.test.ts`) in explanatory prose, which false-triggered the plan's own `git show --stat HEAD | grep ...` exclusion-verification pattern (the grep matches commit *message* text, not just the file list, since `--stat` output includes the message). Reworded the commit message via `git commit --amend` to describe those files without their literal path strings; re-verified the exclusion check passes. No functional change — this was a wording-only fix to satisfy the verification predicate honestly (the files genuinely were never staged).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- lanternfall's sweep is complete and self-contained on `sweep/v4.8-dework` (not pushed, not merged to master — per the plan's branch-only strategy)
- 169-06 can consume lanternfall's BSR-12 status directly from `169-CROSSWALK.md`: AI type-checks and passes its smoke test, but remains untracked WIP in the game repo (not yet formally committed by any process)
- No blockers for 169-03..05 (other game repos) or 169-06 (phase close)

---
*Phase: 169-post-fix-game-de-workaround-sweep*
*Completed: 2026-07-22*

## Self-Check: PASSED

- FOUND: `.planning/phases/169-post-fix-game-de-workaround-sweep/169-02-SUMMARY.md`
- FOUND: `~/BoardSmithGames/lanternfall/BOARDSMITH-BUGS.md`
- FOUND: commit `2c66931` in `~/BoardSmithGames/lanternfall` (branch `sweep/v4.8-dework`)

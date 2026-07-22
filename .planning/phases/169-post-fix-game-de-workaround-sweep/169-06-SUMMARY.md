---
phase: 169-post-fix-game-de-workaround-sweep
plan: 06
subsystem: testing
tags: [undo, ai, mcts, boardsmithgames2-seven, sweep, vitest, crosswalk, phase-close]

# Dependency graph
requires:
  - phase: 169-01
    provides: 169-CROSSWALK.md Dxx-fix-present checklist gating this sweep's removals
  - phase: 169-02
    provides: lanternfall's recorded BSR-12 status (untracked-WIP AI)
  - phase: 169-03
    provides: seven's recorded BSR-12 status (scratch-repro PASS)
  - phase: 169-04
    provides: one-two-punch's recorded BSR-12 status (committed-suite PASS)
provides:
  - BoardSmithGames2/seven's BOARDSMITH-BUG-02 (D1/UNDO-01) RESOLVED, ledger + tests + docblocks updated
  - BoardSmithGames2/seven's BSR-12 (D9/AI-01 + D8/AI-02) re-verified via scratch repro
  - Final aggregated BSR-12 CLOSED verdict across all four AI-bearing repos
  - Complete cross-repo ledger reconciliation for Phase 169 (all 5 repos' filings, final dispositions)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [scratch-repro-then-delete for AI re-verification with no committed test, pinned-defect-test flip on library fix landing]

key-files:
  created: []
  modified:
    - ~/BoardSmithGames2/seven/src/rules/actions.ts
    - ~/BoardSmithGames2/seven/tests/undo.test.ts
    - ~/BoardSmithGames2/seven/BOARDSMITH-BUG-02-undo-op-ignores-non-undoable-actions.md
    - .planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md
    - .planning/phases/169-post-fix-game-de-workaround-sweep/deferred-items.md

key-decisions:
  - "BOARDSMITH-BUG-02 had NO game-side compensating LOGIC to remove (the game used only the documented .notUndoable() mechanism and filed the request instead, per BoardSmithGames2/CLAUDE.md) — the sweep's real work was flipping tests/undo.test.ts's 4-test pinned-defect block (which asserted the WRONG pre-fix behavior by explicit design) to assert the now-correct refused-undo behavior, plus refreshing 3 stale docblocks"
  - "D1/UNDO-01's fix (assertUndoAllowed refusing undo unconditionally before any checkpoint restore) makes BOARDSMITH-BUG-02's root causes 2 and 3 (simultaneous-step flow desync, unfenced rollback across a round boundary) MOOT for this game, not separately fixed — there is no rollback left for them to corrupt once cause 1 (the missing check) is closed"
  - "BSR-12 CLOSED (final aggregated verdict): all four AI-bearing repos (lanternfall, seven, one-two-punch, BoardSmithGames2/seven) have a recorded PASS status; doom-machine is N/A (solo, excluded from the count, not a missing input)"
  - "4 pre-existing hidden-zone mess childCount/DOM-leak-audit test failures (a11y.example.test.ts, discard.test.ts, leak-audit.test.ts x2) were present on baseline before any sweep edit and are logged to deferred-items.md, unmodified — same family as doom-machine's and seven's own deferred hidden-zone items, out of scope for this undo-gated sweep"

requirements-completed: [SWEEP-01, PROC-01]

# Metrics
duration: 45min
completed: 2026-07-22
---

# Phase 169 Plan 06: BoardSmithGames2/seven Sweep + Final BSR-12 Verdict + Cross-Repo Reconciliation Summary

**Closed BOARDSMITH-BUG-02 (its own repo's `.notUndoable()` filing) by flipping the pinned-defect test block to assert the now-correct refused-undo behavior, verified BSR-12 via a scratch AI repro that plays a full game to completion, and rendered the phase's final aggregated BSR-12 CLOSED verdict plus complete 5-repo ledger reconciliation.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-22
- **Tasks:** 3/3
- **Files modified:** 5 (3 in the game repo, 2 in the library repo)

## Accomplishments

- Recorded the pre-existing dirty tree (`git status --porcelain` — empty, clean) verbatim BEFORE branching `~/BoardSmithGames2/seven`. Created `sweep/v4.8-dework` off `master`.
- Baseline `npx vitest run`: **NOT green** (8 failed / 366 passed of 374) — 4 of those were `tests/undo.test.ts`'s own `BOARDSMITH-BUG-02` pinned-defect block, which the filing itself documents will fail once the library fix lands ("WHEN THE LIBRARY FIX LANDS, THIS BLOCK WILL FAIL — AND THAT IS ITS JOB"). Confirmed D1/UNDO-01 PRESENT in 169-CROSSWALK.md before touching anything.
- **BOARDSMITH-BUG-02 (D1/UNDO-01):** the game had NO compensating re-guard logic to remove — only 3 stale "not enforced server-side" docblocks (`draw`/`discard`/`score` in `actions.ts`) and the 4-test pinned-defect block. Empirically re-verified via an uncommitted scratch repro that `GameSession.undoToTurnStart()` now calls `assertUndoAllowed()` and refuses the request (`errorCode: 'UNDO_NOT_ALLOWED'`/`'NO_ACTIONS_TO_UNDO'`) BEFORE any checkpoint restore — meaning root causes 2 (flow-state desync) and 3 (unfenced rollback across a round boundary) are moot, not separately fixed, since no rollback occurs at all. Rewrote all 4 pinned tests (including the worst-case round-closer ordering) to assert the correct behavior; refreshed the 3 stale docblocks; kept all four `.notUndoable()` calls (legit API). Marked the repo's own `BOARDSMITH-BUG-02-*.md` ledger RESOLVED, original filing preserved for the historical record.
- Re-ran `npx vitest run` after the edit: **4 failed / 370 passed of 374** — exactly the 4 pre-existing unrelated hidden-zone failures, confirmed present on baseline too. No new failures.
- **BSR-12 (D9/AI-01 + D8/AI-02):** `src/rules/ai.ts` has no workaround language at all and type-checks cleanly (`npx tsc --noEmit -p .`). No committed AI test exists in this repo's suite, so re-verified behaviorally via an uncommitted scratch repro (`createBot(game, SevenGame, 'seven', seat, actionHistory, 'easy', sevenAIConfig)` driven turn-by-turn through both seats): the bot played a full 2-player, 7-round game to `isFinished() === true` in 22 iterations with zero thrown errors, correctly resolving `score`'s function-valued `multiSelect: { min: 7, max: 7 }` pick every round. Scratch test file deleted after use (never committed; `git status --porcelain` clean before the real commit).
- Committed file-scoped (`git add src/rules/actions.ts tests/undo.test.ts BOARDSMITH-BUG-02-*.md`) — `git show --stat HEAD` confirms exactly 3 files, no deletions, no stray scratch files.
- **Final BSR-12 verdict (169-CROSSWALK.md Section 1a, new):** aggregated all four AI-bearing repos' recorded statuses (lanternfall untracked-WIP PASS, seven scratch-repro PASS, one-two-punch committed-suite PASS, BoardSmithGames2/seven scratch-repro PASS). All four present and passing → **BSR-12 CLOSED**, with lanternfall's untracked-WIP caveat carried forward (not a blocker). doom-machine correctly excluded as N/A (solo, no AI), not treated as a missing input.
- **Cross-repo ledger reconciliation (169-CROSSWALK.md Section 1b, new):** every filing across all 5 repos' own ledgers listed with its final disposition (removed / kept-and-noted / blocked-fix-absent / deferred / reclassified / no-op / withdrawn / out-of-scope) — nothing silently dropped. No BLOCKER (fix-absent) removals occurred anywhere in the phase; every gating `Dxx` for every touched removal candidate was PRESENT per Section 2.
- Logged BoardSmithGames2/seven's 4 pre-existing unrelated failures to `deferred-items.md` alongside the earlier doom-machine and seven entries — same hidden-zone `mess` DOM-rendering family, not investigated further (out of scope for this undo-gated sweep).

## Task Commits

1. **Task 1+2 combined (game repo, `sweep/v4.8-dework`)** — `51be171` (fix): `src/rules/actions.ts` (3 stale docblocks refreshed), `tests/undo.test.ts` (4-test pinned-defect block rewritten to assert correct refused-undo behavior), `BOARDSMITH-BUG-02-undo-op-ignores-non-undoable-actions.md` (marked RESOLVED). File-scoped; `.notUndoable()` calls kept on all 4 actions.
2. **Task 3 (library repo, this repo)** — doc-only edit to `169-CROSSWALK.md` (BOARDSMITH-BUG-02 row outcome, BSR-12 status note, new Section 1a final verdict, new Section 1b full reconciliation) and `deferred-items.md` (BoardSmithGames2/seven's 4 pre-existing failures). Committed as part of this plan's final metadata commit alongside SUMMARY/STATE/ROADMAP.

**Plan metadata:** committed to library repo (this summary + STATE/ROADMAP/CROSSWALK/deferred-items update).

## Files Created/Modified

- `~/BoardSmithGames2/seven/src/rules/actions.ts` — 3 stale docblocks (draw/discard/score) refreshed to cite `assertUndoAllowed()` and D1/UNDO-01, BOARDSMITH-BUG-02 marked RESOLVED in-comment; `.notUndoable()` calls unchanged.
- `~/BoardSmithGames2/seven/tests/undo.test.ts` — the 4-test `BOARDSMITH-BUG-02` pinned-defect block (and its header comment, and the `discard` section's cross-reference comment) rewritten to assert the correct behavior: undo refused, game/flow state untouched, every seat still live, including the round-closer ordering that used to freeze the table silently.
- `~/BoardSmithGames2/seven/BOARDSMITH-BUG-02-undo-op-ignores-non-undoable-actions.md` — marked RESOLVED with fix-verification detail; original filing preserved below for the historical record.
- `.planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md` — BoardSmithGames2/seven's BOARDSMITH-BUG-02 row updated with the 169-06 outcome and BSR-12 status note; new Section 1a (final aggregated BSR-12 verdict: CLOSED) and Section 1b (full 5-repo ledger reconciliation) added.
- `.planning/phases/169-post-fix-game-de-workaround-sweep/deferred-items.md` — BoardSmithGames2/seven's 4 pre-existing, unrelated hidden-zone test failures logged.

## Decisions Made

- **No compensating LOGIC existed to remove for BOARDSMITH-BUG-02** — the repo's own `CLAUDE.md` forbids working around a BoardSmith bug, so the game used only the documented `.notUndoable()` mechanism and filed the request instead. The sweep's actual work was therefore test-and-doc reconciliation (flip the pinned-wrong-behavior tests, refresh the stale "not enforced" comments), not code deletion — this is exactly the shape the filing's own comments anticipated ("re-verify against the fixed engine, then rewrite these expectations... and close BOARDSMITH-BUG-02").
- **Root causes 2 and 3 are MOOT, not separately verified fixed** — since `assertUndoAllowed()` refuses the undo unconditionally before any checkpoint restore for a turn containing a non-undoable action, and this game marks BOTH of its state-mutating actions (`draw`, `discard`) `.notUndoable()`, there is no code path left in this game where a checkpoint restore (and therefore a flow-state desync or an unfenced rollback) could occur. This is documented explicitly in both the ledger update and the test-block header rather than silently assumed.
- **BSR-12 verified via scratch repro, not a new committed test** — consistent with 169-03's precedent for `seven` (the other repo), a full-game `createBot`-driven playthrough is sufficient behavioral evidence; adding a permanent AI test to this repo's suite was judged out of scope for a conservative sweep plan (a repo-owner decision, not a library gap).
- **BSR-12 CLOSED (final verdict)** — all four required per-repo statuses were present and passing; no repo forced a KEPT-OPEN via a missing status, so the verdict is CLOSED per PROC-01's evidence-for-every-repo rule.

## Deviations from Plan

None — plan executed exactly as written. The docblock-only removal gate (no compensating logic present) matched the plan's own anticipation that BoardSmithGames2/seven might have "same UNDO-01 gating as the other seven" with a smaller removable surface; the plan's Task 1 wording ("run npx vitest run; record the green baseline") was not literally satisfied (baseline was 8 failed, not green) but this is the SAME situation 169-05 documented for doom-machine's baseline — recorded honestly rather than mis-stated, per the Rule-1/Rule-2 "fail loud, not silently" discipline.

## Issues Encountered

None blocking. The baseline non-green surprised the literal plan wording but was expected once the `BOARDSMITH-BUG-02` filing's own comments were read closely — its 4 tests exist specifically to fail once the library fix lands, and that is precisely what a green D1 fix produces.

## Pre-existing Dirty Files (deliberately untouched)

`git status --porcelain` was **empty** before branching — no pre-existing dirty tree in `~/BoardSmithGames2/seven` at plan start. Nothing to exclude.

## Deferred / Known Issues (not fixed by this plan, logged for future work)

- 4 pre-existing hidden-zone `mess` childCount/DOM-leak-audit failures (`tests/a11y.example.test.ts`, `tests/discard.test.ts`, `tests/leak-audit.test.ts` x2) — present on baseline before any edit, confirmed identical after; logged to `deferred-items.md`. Recommend a future plan investigate this hidden-zone DOM-rendering path against the library's D24 serializer branch, independent of this sweep (same recommendation already on file for doom-machine's analogous failures).
- Lanternfall's `ai.ts`/`ai-smoke.test.ts` remain untracked WIP in that repo, not committed by any BoardSmith-repo process — a lanternfall housekeeping item, not a library defect, carried forward as a caveat on the BSR-12 CLOSED verdict rather than reopening it.

## User Setup Required

None — no external service configuration required.

## Phase 169 Closeout

This is the final plan of Phase 169. With this plan complete:
- All five game repos (lanternfall, seven, one-two-punch, doom-machine, BoardSmithGames2/seven) have been swept per the conservative/gated protocol; every removal candidate's own-repo ledger is reconciled.
- **BSR-12 (D9/AI-01 + D8/AI-02) is CLOSED** across all four AI-bearing repos.
- BS-10 (doom-machine art-path filing) is reclassified as already handled, folded into a scaffold-default recommendation for a future plan.
- The full cross-repo ledger reconciliation (169-CROSSWALK.md Section 1b) confirms every filing across all 5 repos has a final, justified disposition — no silent drops, no unevidenced closures.
- No blockers remain open for this phase.

---
*Phase: 169-post-fix-game-de-workaround-sweep*
*Completed: 2026-07-22*

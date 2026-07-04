---
phase: 137-testing-utilities
verified: 2026-07-04T00:13:44Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 137: Testing Utilities Verification Report

**Phase Goal:** `TestGame`'s default behavior matches the library's own deterministic, fail-loud doctrine.
**Verified:** 2026-07-04T00:13:44Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | PROC-01 gate: F36/TST-01 and F37/TST-02 both have recorded verdicts (LEGITIMATE, with current file:line trace) written before any fix task ran | ✓ VERIFIED | `.planning/phases/137-testing-utilities/137-FINDINGS-VERIFICATION.md` has exactly 2 `VERDICT:` lines, each citing `src/testing/test-game.ts` line numbers that match current source; call-site classification table for 6 `doAction(` sites recorded. Task 1 (commit `8e7b26e6`) contains no source edits. |
| 2 | `TestGame.doAction` throws by default on action failure, with an actionable message (action/seat named, `debugActionAvailability` trace folded in) | ✓ VERIFIED | `src/testing/test-game.ts:363-398` — `doAction` calls `tryAction`, and on `!result.success` builds a message via `debugActionAvailability`/`getFlowDebugInfo` (falling back to a plain message in a try/catch) and `throw new ActionExecutionError(...)`. |
| 3 | `TestGame.tryAction(seat, action, args)` returns `ActionExecutionResult` without throwing, for tests deliberately expecting failure | ✓ VERIFIED | `src/testing/test-game.ts:332-` — `tryAction` preserves the exact old `doAction` body (`return this.runner.performAction(...)`), documented as the never-throw escape hatch. |
| 4 | The four category-(b) harness call sites migrated to `tryAction`, preserving existing failure-as-a-branch control flow | ✓ VERIFIED | `grep -n '\.doAction('` on `simulate-tutorial.ts`, `random-simulation.ts`, `simulate-action.ts` returns zero runtime call sites — all four now call `.tryAction(` (lines 252, 404, 57, 398 respectively), with comments explaining why. `action-builder.ts:95` delegates a bare `doAction` call with no local `!result.success` throw. `assertions.test.ts:325` unchanged (category a). |
| 5 | `TestGame`'s default seed is a fixed literal (not `test-${Date.now()}`); `testGame.seed` exposes the resolved seed; seed appears in failure messages (doAction's ActionExecutionError, assertActionAvailable, playUntilComplete's GameStuckError) | ✓ VERIFIED | `src/testing/test-game.ts:181` — `const seed = options.seed ?? 'test-seed';` (no `Date.now()` anywhere in the file). `readonly seed: string` field at line 158, threaded through the constructor. `doAction`'s message includes `Seed: ${this.seed}` (both plain and rich-trace branches, lines 373/392). `assertions.ts` and `simulate-action.ts` (`playUntilComplete`'s 4 `GameStuckError` sites) also append seed per the code-review fix (`e549e5d6`). |
| 6 | Full suite is green — no harness loop broke on the throw-flip; code-review fix commits did not regress any of the above | ✓ VERIFIED | `npm run test` run independently during this verification: **175 test files, 2368 tests, all passed.** (Baseline before phase: 175/2358; Plan 02 added 3 tests → 2361; Plan 03 added 3 tests → 2364; review-fix commits WR-03/WR-04 added 4 more tests → 2368 — consistent with the additive test counts documented across SUMMARYs and the REVIEW.md resolution notes.) |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/testing/test-game.ts` | doAction throw-on-failure, tryAction escape hatch, ActionExecutionError class, fixed literal default seed, readonly seed field | ✓ VERIFIED | All present and wired (see truths 2, 3, 5 above). |
| `src/testing/test-game.test.ts` | RED-then-green regression tests for TST-01/TST-02 | ✓ VERIFIED | `doAction throw-on-failure (TST-01)` and `deterministic default seed (TST-02)` describe blocks present; suite green. |
| `src/testing/action-builder.ts` | `execute()` simplified, delegates throw to doAction | ✓ VERIFIED | Line 95: single `this._testGame.doAction(...)` call, no local `!result.success` throw. |
| `src/testing/index.ts` | `ActionExecutionError` exported from testing barrel | ✓ VERIFIED | Line 39: `ActionExecutionError,` exported alongside `TestGame`/`createTestGame` (fixes review CR-01). |
| `docs/api/testing.md`, `docs/agent-control.md` | Examples no longer model ignoring doAction result; determinism section matches shipped contract | ✓ VERIFIED | `grep -n "result.success"` in both docs shows only unrelated (`session.performAction`, `simulateAction`) examples, not doAction-ignore patterns. `docs/agent-control.md` Determinism section rewritten to fixed-literal contract (commit `7a8ad212`). |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `test-game.ts doAction` | `game.debugActionAvailability` | failure-path trace fold into thrown message | ✓ WIRED | Lines 379-391, inside try/catch with plain-message fallback. |
| `action-builder.ts execute` | `test-game.ts doAction` | delegates throw (no local check) | ✓ WIRED | Line 95. |

### Code-Review Fix-Loop Regression Check

Per the task instructions, verified that the 6 fix commits (2 Critical + 4 Warnings) did not regress any must_have:

| Commit | Fix | Regression check |
| --- | --- | --- |
| `afd55be2` | CR-01: export `ActionExecutionError` from barrel | Confirmed present in `src/testing/index.ts:39`; no removal of other exports. |
| `7a8ad212` | CR-02: fix stale `test-${Date.now()}` doc claim in `docs/agent-control.md` | Confirmed section now states fixed literal `'test-seed'` default; matches shipped `test-game.ts:181`. |
| `d0759965` | WR-01: fix `simulateRandomGames` doc example (unrelated API surface) | Scoped to `docs/api/testing.md`; no impact on TST-01/TST-02 must-haves. |
| `acf7b502` | WR-02: fix 1-indexed seat in `diffSnapshots` JSDoc | Scoped to `src/testing/debug.ts`; unrelated to doAction/seed must-haves, but consistent with fail-loud doctrine. |
| `44539a6e` | WR-03: wire `simulateTutorial` seed (was inert) | `src/testing/simulate-tutorial.ts` now records effective `testGame.seed` on the result and fail-loud throws on options.seed mismatch; 2 new tests added and green. Extends (does not regress) TST-02's seed-traceability doctrine. |
| `e549e5d6` | WR-04: report move-selection seed in `GameStuckError` alongside game seed | `src/testing/simulate-action.ts` 4 `GameStuckError` sites now include a combined `seedLine`; 2 new tests added and green. Extends TST-02's "one copy-paste repro" claim to cover the `playUntilComplete` random-strategy case. |

No regressions found — all fixes are additive/corrective within phase scope, and the full suite (175/2368) remains green after all six commits.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| PROC-01 | 137-01 | Verdict recorded before fix work (project-wide gate, this phase's instance) | ✓ SATISFIED | `137-FINDINGS-VERIFICATION.md`, 2 VERDICT: LEGITIMATE lines, no source edits in Plan 01. |
| PROC-02 | 137-02, 137-03 | Regression test fails on pre-fix code (RED-then-green) | ✓ SATISFIED | Both SUMMARYs document explicit RED confirmation before GREEN commits (`ecc2e2e7`→`cf5089da`, `d87dd708`→`e5631577`); review fixes WR-03/WR-04 also documented red-then-green. |
| TST-01 | 137-02 | `doAction` fails loud by default; flagship example no longer models ignoring result | ✓ SATISFIED | See truths 2, 4 above; class-level `@example` (`test-game.ts:126-140`) shows the throwing call with no ignored result. |
| TST-02 | 137-03 | Default seed deterministic (fixed literal, not Date.now()) | ✓ SATISFIED | See truth 5 above. |

No orphaned requirements — REQUIREMENTS.md maps only TST-01/TST-02 (+ PROC-01/PROC-02, phase-agnostic) to Phase 137, and all appear in the plans' `requirements` frontmatter.

### Anti-Patterns Found

None. Scanned all 11 phase-modified files (`test-game.ts`, `test-game.test.ts`, `action-builder.ts`, `simulate-tutorial.ts`, `random-simulation.ts`, `simulate-action.ts`, `assertions.ts`, `index.ts`, `debug.ts`, `docs/api/testing.md`, `docs/agent-control.md`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` — zero matches. Remaining `result.success` references in docs/JSDoc are legitimate `tryAction`/`simulateAction`/unrelated-session-API examples, not doAction-ignore patterns.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Full suite green after all phase + review-fix commits | `npm run test` | 175 files, 2368 tests, all passed | ✓ PASS |
| No `.doAction(` runtime calls remain in the 4 migrated harness files | `grep -n '\.doAction(' src/testing/simulate-tutorial.ts src/testing/random-simulation.ts src/testing/simulate-action.ts` | 0 matches (only `.tryAction(` calls and JSDoc prose mentioning `doAction()`) | ✓ PASS |
| `ActionExecutionError` exported from barrel | `grep -n ActionExecutionError src/testing/index.ts` | line 39 exports it | ✓ PASS |
| No `Date.now()` seed usage remains | `grep -n "Date.now" src/testing/test-game.ts` | 0 matches | ✓ PASS |

### Human Verification Required

None. All must-haves are verifiable via static grep/read + an independently-run full test suite; no visual, real-time, or external-service behavior is in scope for this phase.

### Gaps Summary

No gaps. All 6 derived observable truths (PROC-01 gate, doAction throw, tryAction escape hatch, harness migration, deterministic seed + traceability, full suite green) are verified directly against current source, independent of SUMMARY.md narrative. The 6 code-review fix commits (2 Critical, 4 Warnings) were individually checked against the diff and do not regress any must-have; two of them (WR-03, WR-04) extend the TST-02 seed-traceability doctrine to `simulateTutorial` and `playUntilComplete`'s move-selection seed, which strengthens rather than weakens goal achievement.

---

_Verified: 2026-07-04T00:13:44Z_
_Verifier: Claude (gsd-verifier)_

---
phase: 129-migration-games-merc
verified: 2026-07-02T14:25:00Z
status: passed
score: 9/9 must-haves verified
overrides_applied: 0
---

# Phase 129: Migration — Games & MERC Verification Report

**Phase Goal:** Every example game and MERC build and test green against the full v4.4 API surface, with no lingering references to removed/changed APIs.
**Verified:** 2026-07-02T14:25:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 8 example games' vitest suites pass at/above baseline | ✓ VERIFIED | Independently re-ran: checkers 38/38, cribbage 22/22, go-fish 84/84, hex 19/19, polyhedral-potions 24/24, demo-animation 9/9, demo-complex-ui 4/4 — all pass, no failures. demo-action-panel has no vitest suite (expected). |
| 2 | All 8 game repos `npx tsc --noEmit` clean | ✓ VERIFIED | Re-ran tsc in all 8 repos; zero output (exit 0) in every repo including demo-action-panel. |
| 3 | hex stone element carries a useFLIP-recognized anchor (data-element-id) | ✓ VERIFIED | `grep -n "data-element-id"` present in HexBoard.vue alongside untouched `data-stone-id`; hex suite green. |
| 4 | go-fish DOM-leak test proves opponent card identity never reaches DOM, with a working positive control | ✓ VERIFIED | `tests/no-hidden-info-dom-leak.test.ts` contains `assertNoHiddenInfoLeak(testGame, 2, ...)` natural-pass test plus two POSITIVE CONTROL tests: one injecting a full compound-name leak, one injecting a bare rank-only leak (WR-01 fix) — both assert the matcher throws. Suite green at 84/84 (was 78 baseline + 6 new). |
| 5 | go-fish `allow` predicate is elementId-scoped, not a blanket exemption (REVIEW WR-01 fix applied) | ✓ VERIFIED | `makeIgnoreRedundantRankSuitFields(testGame)` scopes exemption per `ctx.elementId`, proving redundancy against that element's own `name` marker instead of a blanket attribute exemption. Dedicated rank-only positive control added and passing. |
| 6 | cribbage visibility test proves hand/crib visibility semantics | ✓ VERIFIED | `cribbage/tests/visibility.test.ts` exists; cribbage suite green 22/22 (20 baseline + 2 new). |
| 7 | demo-animation trace test proves a real fly-path animation trace (from/to containers) | ✓ VERIFIED | `demo-animation/tests/animation-trace.test.ts` exists, asserts concrete `kind:'fly', from:'zone-a', to:'zone-b'`; suite green 9/9 (8 baseline + 1 new). |
| 8 | MERC re-vendored against a freshly packed v4.4 tarball, suite green at >= baseline | ✓ VERIFIED | `package.json` both `dependencies.boardsmith` and `overrides.boardsmith` point at `file:./vendor/boardsmith-0.0.1-20260702190858.tgz`; re-ran `npx vitest --run` — 28 files, 738 passed \| 7 skipped, exact baseline match. Commit `87cee4a` touches only package.json + package-lock.json; user's pre-existing WIP (version 0.0.28 bump, AssignToSquadPanel.vue) confirmed still uncommitted/untouched via `git diff`/`git status --short`. |
| 9 | Repo-wide grep sweep (all 9 repos) returns zero breakage-surface hits (headless-harness, detached ElementCollection.shuffle, boardsmith-imported playUntilComplete) | ✓ VERIFIED | Independently re-ran `headless-harness` sweep across all 9 repos — zero hits everywhere. `boardsmith simulate --seed test1 --json` re-run against hex and checkers, both complete cleanly with a `winner` field in the JSON output. |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `~/BoardSmithGames/hex/src/ui/components/HexBoard.vue` | stone carries `data-element-id` | ✓ VERIFIED | grep confirms attribute present, `data-stone-id` preserved |
| `~/BoardSmithGames/hex/src/vite-env.d.ts`, `checkers/src/vite-env.d.ts` | vite/client ambient types | ✓ VERIFIED | tsc clean in both repos |
| `~/BoardSmithGames/go-fish/tests/no-hidden-info-dom-leak.test.ts` | DOM-leak proof + positive control | ✓ VERIFIED | contains `assertNoHiddenInfoLeak`, two POSITIVE CONTROL tests |
| `~/BoardSmithGames/cribbage/tests/visibility.test.ts` | hand/crib visibility assertions | ✓ VERIFIED | file exists, suite green |
| `~/BoardSmithGames/demo-animation/tests/animation-trace.test.ts` | animation-trace assertion | ✓ VERIFIED | file exists, asserts `getAnimationTrace()` contents, suite green |
| `~/Dropbox/MERC/BoardSmith/MERC/package.json` | boardsmith ref → new v4.4 tarball | ✓ VERIFIED | both refs point at `boardsmith-0.0.1-20260702190858.tgz` |
| `~/BoardSmith/src/testing/dom-leak.ts` | lazy `@vue/test-utils` import (regression fix found during 129-03) | ✓ VERIFIED | BoardSmith full suite 159 files / 2081/2081 passed independently re-run |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| HexBoard.vue stone `<circle>` | useFLIP `getElementId()` | `data-element-id` attribute | WIRED | attribute present, matches recognized-attribute list |
| go-fish DOM-leak test | `boardsmith/testing` `assertNoHiddenInfoLeak` | import + render as opponent seat | WIRED | import confirmed, test suite green including positive controls |
| demo-animation trace test | `boardsmith/ui` `useFlyingElements`/animation-test-mode | direct composable test | WIRED | trace assertions pass |
| MERC package.json | freshly packed v4.4 tarball | `file:./vendor/boardsmith-0.0.1-...` | WIRED | both dependency + override refs updated, install/build green |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 8 game suites pass | `npx vitest run` per repo | checkers 38, cribbage 22, go-fish 84, hex 19, polyhedral-potions 24, demo-animation 9, demo-complex-ui 4, demo-action-panel (none) | ✓ PASS |
| All 8 game repos tsc clean | `npx tsc --noEmit` per repo | zero output, exit 0 in all 8 | ✓ PASS |
| MERC suite green | `npx vitest --run` | 28 files, 738 passed / 7 skipped | ✓ PASS |
| BoardSmith full suite green | `npm test` | 159 files, 2081/2081 passed | ✓ PASS |
| Repo-wide grep sweep | `grep -rn "headless-harness"` x9 repos | zero hits everywhere | ✓ PASS |
| go-fish positive controls present | grep test file for POSITIVE CONTROL markers | compound-name leak test + rank-only leak test (WR-01) both present | ✓ PASS |
| `boardsmith simulate` smoke | run against hex + checkers | both complete with `winner` field, exit 0 | ✓ PASS |
| MERC WIP untouched | `git diff`/`git status --short` in MERC | only unrelated version bump (0.0.27→0.0.28) + AssignToSquadPanel.vue unstaged, boardsmith refs already committed in `87cee4a` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MIG-03 | 129-01, 129-02, 129-03 | All example games updated to v4.4 API surface, all suites green | ✓ SATISFIED | All 8 games verified green + tsc clean + grep sweep clean (see truths 1–7, 9) |
| MIG-04 | 129-03 | MERC re-vendored and updated, suite green | ✓ SATISFIED | MERC re-vendored to fresh v4.4 tarball, suite 738/7, commit scoped correctly (truth 8) |

### Anti-Patterns Found

None. No TBD/FIXME/XXX/placeholder markers found in the phase's key files. The one genuine regression found mid-phase (eager `@vue/test-utils` import in `dom-leak.ts` breaking MERC's suite) was fixed in BoardSmith `src/` (commit `fb09f4b`), not worked around in MERC — consistent with the phase's "never patch a game to work around a BoardSmith gap" rule. REVIEW.md's two warnings (WR-01 unscoped allow predicate, WR-02 missing doc example) were both fixed post-SUMMARY and independently confirmed present in the current code.

### Human Verification Required

None. All checks are automatable and were independently re-run against the live repos (not taken from SUMMARY claims).

### Gaps Summary

No gaps. All observable truths, artifacts, and key links verified directly against the codebase across all 9 repos (8 games + MERC) plus BoardSmith itself. Numbers match the plan's baselines/targets exactly (e.g., go-fish 84/84 including both the WR-01 rank-only positive control and the original compound-name positive control; MERC 738/7 exact baseline match after the dom-leak.ts lazy-import regression was fixed in BoardSmith src/).

---

_Verified: 2026-07-02T14:25:00Z_
_Verifier: Claude (gsd-verifier)_

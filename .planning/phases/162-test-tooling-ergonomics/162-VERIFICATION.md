---
phase: 162-test-tooling-ergonomics
verified: 2026-07-21T11:05:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 162: Test-Tooling Ergonomics Verification Report

**Phase Goal:** The test/build tooling stops producing false FAILs and jsdom throws, and exposes the
helpers games need — asset-scan ignores `<img` in comments and is exported, `boardsmith/ui` doesn't
read `matchMedia` at module scope, and hidden-info leak assertion works for symmetric decks.

**Verified:** 2026-07-21
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `scanAssetReachability` no longer matches `<img` in comments | ✓ VERIFIED | `src/cli/lib/asset-scan.ts:66-149` — `stripComments()` is a line-oriented state machine tracking `block`/`html` open-state ACROSS lines, blanking comment chars while preserving line length/index. Handles JS `//` (with an explicit `://`-preceded guard so `https://...` inside a live string is NOT misread as a comment opener, `:104-117`), JS `/* */` (single- and multi-line, state carried via `openKind`), and Vue `<!-- -->` (same mechanism). Live markup and string literals are left untouched — confirmed by reading the full `stripComments` implementation; strip is comment-scoped only, not a second/looser detector. `src/cli/lib/asset-scan.test.ts` (9 legacy + 4 adversarial cases) passes, including a same-line-before-comment live `<img>` (still flagged) and an unterminated block comment (no crash, stays stripped to EOF). |
| 2 | `scanAssetReachability` is on the published export surface | ✓ VERIFIED | `src/testing/index.ts:127`: `export { scanAssetReachability, type AssetViolation } from '../cli/lib/asset-scan.js';`. `src/testing/scan-asset-export.test.ts` imports it from `'boardsmith/testing'` and both tests pass. |
| 3 | `boardsmith/ui` no longer reads `matchMedia` at module scope | ✓ VERIFIED | `src/ui/composables/useElementAnimation.ts:60-86` — `matchMedia` read + `change`-listener registration are deferred into `ensureReducedMotionInitialized()`, called only from the `customRef`'s lazy `get()` (first `.value` access), guarded on `typeof window.matchMedia === 'function'` (not just `typeof window !== 'undefined'`). Nothing executes at import time. `src/ui/composables/ui-barrel-import.test.ts` (`@vitest-environment jsdom`, deliberately no matchMedia stub) dynamically imports the `boardsmith/ui` barrel and passes (2/2 tests, confirmed in this session's `npm test` run). Also confirmed the write-before-first-read footgun (`explicitlySet` flag) is real and correctly prevents a lazy re-init from clobbering an explicit test-driven `.value =` write. |
| 4 | `assertNoHiddenInfoLeak` works for symmetric decks (markers not name-based-only) | ✓ VERIFIED — reviewed for security regression, none found | `src/testing/dom-leak.ts:387-465` — every scanned DOM surface is now attributed to its owning `data-element-id` ancestor (`findOwningElementId`/`collectScopedSurfaceStrings`) and matching (`:543`) skips a marker/surface pair only when **both** have a defined, differing owner (`surface.ownerId !== undefined && surface.ownerId !== marker.elementId`). Surfaces with no attributable owner are still checked against every marker (conservative fallback, never silently dropped). Read the full matching loop end-to-end — this is additive precision (fewer false positives on symmetric-name collisions), not a weakened check. |
| 5 | Each has a fail-on-pre-fix / pass-after test (PROC-01) | ✓ VERIFIED | RED commits `3fde2ca0` (D17/D18) and `5a86709c` (D19/D20) exist in `git log` with genuine failing output captured verbatim in both SUMMARYs (real `TypeError`/`AssertionError` output, not narrated). GREEN commits `78876f55`/`beb104d5` follow. Adversarial commits `f3a57746`/`5f36936b` follow those. All 6 commits confirmed present via `git log --oneline`. |

**Score:** 5/5 truths verified

### D20 Security Deep-Dive (critical check, per verification task)

Read `deriveForbiddenMarkers`, `collectScopedSurfaceStrings`, `findOwningElementId`, and the full
matching loop in `assertNoHiddenInfoLeak` (`src/testing/dom-leak.ts:334-557`) end-to-end, plus the
adversarial test cases in `src/testing/dom-leak.test.ts:540-579`.

- **The elementId-keying is a narrowing filter, never a broadening one.** A surface is excluded from
  matching against a given marker ONLY when both the surface and the marker have a *defined* owner and
  those owners differ. An un-attributed surface (no `data-element-id` ancestor — e.g. a bare `Hand`
  container) is still checked against **every** marker.
- **Adversarial test 1** (`dom-leak.test.ts:541-560`): forces the real name of a hidden card back onto
  the DOM node carrying that *same hidden card's own* `data-element-id` (simulating a renderer bug that
  bypasses redaction) — `assertNoHiddenInfoLeak` still throws. This proves elementId-scoping cannot be
  used to smuggle a genuine leak past the assertion by exploiting the owner-match logic; a leak under
  the correct owner is still caught.
- **Adversarial test 2** (`:562-579`): forces a collision between a hidden card's rank and a `Hand`
  container's own (non-`data-element-id`) id — a genuinely un-attributable surface — and confirms the
  conservative fallback still throws.
- **All 6 pre-existing `dom-leak.test.ts` describe blocks** (negative, positive control, playerView
  blind-spot, allowlist, aria/alt/title, outside-jsdom) reconfirmed passing, unmodified, in this
  session's `npm test` run.
- **Conclusion: no blind spot introduced.** The fix trades a false-positive-prone name-substring match
  for an element-identity-scoped match with an explicit, tested, conservative fallback for
  un-attributable surfaces. A real leak — whether under the hidden element's own id or unattributable —
  is still caught.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/lib/asset-scan.ts` | `stripComments()` + wired into scan | ✓ VERIFIED | Present, wired at `:169` before `BARE_IMG_TAG.test()`. |
| `src/testing/index.ts` | re-export `scanAssetReachability`/`AssetViolation` | ✓ VERIFIED | Line 127. |
| `src/ui/composables/useElementAnimation.ts` | lazy `matchMedia` init | ✓ VERIFIED | `customRef` + `ensureReducedMotionInitialized`, guarded on `typeof window.matchMedia === 'function'`. |
| `src/testing/dom-leak.ts` | elementId-keyed matching | ✓ VERIFIED | `ownerId`/`findOwningElementId`/`collectScopedSurfaceStrings`, wired into the match loop. |
| `src/cli/lib/asset-scan.test.ts` | RED+GREEN+adversarial cases | ✓ VERIFIED | 13 tests, all pass. |
| `src/testing/scan-asset-export.test.ts` | export-surface test | ✓ VERIFIED | 2 tests, pass. |
| `src/ui/composables/ui-barrel-import.test.ts` | no-stub barrel import | ✓ VERIFIED | 2 tests, pass. |
| `src/testing/dom-leak.test.ts` | symmetric-deck + adversarial cases | ✓ VERIFIED | 17 tests, pass (including 2 symmetric-deck + 2 Task-3 adversarial). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `asset-scan.ts` scan loop | `stripComments()` | direct call before regex test | ✓ WIRED | `:169-171`. |
| `boardsmith/testing` barrel | `asset-scan.ts` | re-export | ✓ WIRED | `src/testing/index.ts:127`. |
| `customRef` get() | `ensureReducedMotionInitialized` | lazy call on first `.value` read | ✓ WIRED | `useElementAnimation.ts:75-86`. |
| `assertNoHiddenInfoLeak` match loop | `collectScopedSurfaceStrings`/owner check | direct call + `ownerId` comparison | ✓ WIRED | `dom-leak.ts:533-553`. |

### Behavioral Spot-Checks

Full `npm test` run (see below) is the behavioral check for this phase — all new/modified test files
run and pass under the real toolchain (vitest + jsdom), not a narrated claim.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite green at expected count | `npm test` | 209 files / 2937 tests passed | ✓ PASS |
| Comment-stripped asset scan | `npx vitest run src/cli/lib/asset-scan.test.ts` (part of full run) | 9/9 pass | ✓ PASS |
| Export surface | `npx vitest run src/testing/scan-asset-export.test.ts` (part of full run) | 2/2 pass | ✓ PASS |
| No-stub `boardsmith/ui` barrel import | `npx vitest run src/ui/composables/ui-barrel-import.test.ts` (part of full run) | 2/2 pass | ✓ PASS |
| Symmetric-deck + adversarial leak detection | `npx vitest run src/testing/dom-leak.test.ts` (part of full run) | 17/17 pass | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared for this phase; N/A.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| TOOL-01 (D17) | 162-01 | Comment-strip false-FAIL fix | ✓ SATISFIED | `stripComments()` implemented + tested. |
| TOOL-02 (D18) | 162-01 | Export surface | ✓ SATISFIED | `src/testing/index.ts:127`. |
| TOOL-03 (D19) | 162-02 | No module-scope `matchMedia` | ✓ SATISFIED | Lazy `customRef` init, no-stub barrel-import test passes. |
| TOOL-04 (D20) | 162-02 | Symmetric-deck leak detection, elementId-keyed | ✓ SATISFIED | Owner-scoped matching, adversarial tests confirm no blind spot. |
| PROC-01 | both | Fix discipline: fail-on-pre-fix / pass-after + adversarial | ✓ SATISFIED | RED/GREEN/adversarial commit triples confirmed for both plans. |

No orphaned requirements found for this phase.

### Anti-Patterns Found

None. No `TODO`/`FIXME`/`HACK`/`XXX`/`TBD` markers, no placeholder returns, and no hardcoded-empty
stub patterns in any of the files touched by this phase.

### Human Verification Required

None. All 5 success criteria are verifiable via static code review + automated test execution; no
visual, real-time, or external-service behavior is in scope for this phase.

### Gaps Summary

None. All 5 roadmap success criteria verified against actual source (not SUMMARY narration), full test
suite green at the expected count (209 files / 2937 tests, matching both plans' documented final
counts), and the D20 security-sensitive change was independently traced end-to-end with adversarial
tests confirmed to force a real leak that still throws.

---

_Verified: 2026-07-21_
_Verifier: Claude (gsd-verifier)_
